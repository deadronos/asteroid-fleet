// Hangar board facts shared by the sim, the tick context and the Fleet panel.
// Every helper is pure: an optional ship lookup keeps boards O(slots) instead
// of scanning the whole fleet once per item (#250).

import { BASE_STORAGE, HANGAR_TYPES, SHIP_STATS } from './config';
import {
  lvl,
  SCALE_BOARD_CATAPULT,
  SCALE_BOARD_DISPATCH,
  SCALE_BOARD_SENSOR,
  SCALE_REPAIR_FIELD,
} from './research';
import type { Sim, Hangar, Ship, ShipClass } from './types';

/** Slot -> ship id on a hangar board; `null` marks a free slot. */
export type Board = (number | null)[];

/** Slot -> ship id for `h`. A supplied `byId` avoids a scan of `s.ships` per item. */
export function occupancy(s: Sim, h: Hangar, byId?: Map<number, Ship>): Board {
  const occ: Board = Array.from({ length: h.slots }, () => null);
  for (const it of h.items) {
    const ship = byId ? byId.get(it.shipId) : s.ships.find((sh) => sh.id === it.shipId);
    if (!ship) continue;
    const size = SHIP_STATS[ship.cls].slots;
    for (let i = 0; i < size; i++) if (it.start + i < h.slots) occ[it.start + i] = it.shipId;
  }
  return occ;
}

export function fits(s: Sim, h: Hangar, cls: ShipClass, start: number, ignoreShip = -1): boolean {
  const size = SHIP_STATS[cls].slots;
  if (start < 0 || start + size > h.slots) return false;
  const occ = occupancy(s, h);
  for (let i = start; i < start + size; i++)
    if (occ[i] !== null && occ[i] !== ignoreShip) return false;
  return true;
}

export function firstFit(s: Sim, h: Hangar, cls: ShipClass): number {
  for (let i = 0; i < h.slots; i++) if (fits(s, h, cls, i)) return i;
  return -1;
}

/** Find a hangar + slot for a new ship, preferring `preferred`. */
export function findSpace(
  s: Sim,
  cls: ShipClass,
  preferred?: number,
): { hangar: Hangar; start: number } | null {
  const order = [...s.hangars].sort((a, b) =>
    a.id === preferred ? -1 : b.id === preferred ? 1 : 0,
  );
  for (const h of order) {
    const start = firstFit(s, h, cls);
    if (start >= 0) return { hangar: h, start };
  }
  return null;
}

/** Ship ids directly next to a ship's span on a board. */
export function boardNeighbours(occ: readonly (number | null)[], shipId: number): number[] {
  const idx = occ.indexOf(shipId);
  if (idx < 0) return [];
  let end = idx;
  while (end + 1 < occ.length && occ[end + 1] === shipId) end++;
  const out: number[] = [];
  if (idx > 0 && occ[idx - 1] !== null) out.push(occ[idx - 1]!);
  if (end + 1 < occ.length && occ[end + 1] !== null) out.push(occ[end + 1]!);
  return out;
}

/** Ship ids directly next to `shipId` on its hangar board. */
export function neighbours(s: Sim, h: Hangar, shipId: number, byId?: Map<number, Ship>): number[] {
  return boardNeighbours(occupancy(s, h, byId), shipId);
}

export function hangarOf(s: Sim, shipId: number): Hangar | undefined {
  return s.hangars.find((h) => h.items.some((it) => it.shipId === shipId));
}

export function carrierStorage(s: Sim): number {
  return BASE_STORAGE + s.hangars.reduce((a, h) => a + HANGAR_TYPES[h.type].storage, 0);
}

/**
 * Every board rule the sim applies, named once so the panel can show exactly the same set (#250).
 * The first three are dock-repair rules; the rest are positional boosts unlocked by Board mastery (#244).
 */
export type BoardSynergyKind =
  | 'repair'
  | 'bargeBay'
  | 'boosting'
  | 'catapult'
  | 'sensorLink'
  | 'dispatchLink';

/** Kept as the public name used by the Fleet panel's label table. */
export type RepairSynergyKind = BoardSynergyKind;

/** Which stat a synergy scales. `boost` is the reciprocal hint on a repair drone. */
export type BoardSynergyStat = 'repair' | 'speed' | 'cargo' | 'mining' | 'damage' | 'boost';

/** One board rule: its identity, the stat it scales and its multiplier. */
export interface BoardSynergy {
  kind: BoardSynergyKind;
  stat: BoardSynergyStat;
  factor: number;
}

/** One repair-bonus rule: its multiplier and identity, shared by sim and UI (#250). */
export interface RepairSynergy {
  /** Rate multiplier for the docked ship; 1 for the reciprocal hint on a repair drone. */
  factor: number;
  kind: BoardSynergyKind;
}

/**
 * The dock-repair synergy in force for a ship on a board, or null. This is the
 * single source of truth for the rules applied by the sim and shown in the UI (#250).
 */
export function repairSynergy(
  s: Sim,
  occ: readonly (number | null)[],
  ship: Ship,
  byId?: Map<number, Ship>,
): RepairSynergy | null {
  const adjacent = boardNeighbours(occ, ship.id).map(
    (id) => (byId ? byId.get(id) : s.ships.find((x) => x.id === id))?.cls,
  );
  if ((ship.cls === 'fighter' || ship.cls === 'barge') && adjacent.includes('repair'))
    return { factor: 3, kind: 'repair' };
  if (ship.cls === 'drone' && lvl(s, 'bargeBay') > 0 && adjacent.includes('barge'))
    return { factor: 2, kind: 'bargeBay' };
  if (ship.cls === 'repair' && (adjacent.includes('fighter') || adjacent.includes('barge')))
    return { factor: 1, kind: 'boosting' };
  return null;
}

/** Repair rate for a docked ship, including its board synergy and Field repair. */
export function dockRepairRate(s: Sim, shipId: number, byId?: Map<number, Ship>): number {
  const h = hangarOf(s, shipId);
  if (!h) return 0;
  const ship = byId ? byId.get(shipId) : s.ships.find((x) => x.id === shipId);
  const syn = ship ? repairSynergy(s, occupancy(s, h, byId), ship, byId) : null;
  return (
    HANGAR_TYPES[h.type].repairRate *
    (syn?.factor ?? 1) *
    (1 + SCALE_REPAIR_FIELD * lvl(s, 'repair'))
  );
}

/**
 * Positional board boosts in force for a ship (#244). All require Board mastery, so starter
 * fleets and the golden runs are unchanged. A scout link favours mining drones and harvesters
 * or fighters, a barge dispatch favours haulers, and the lead slot favours any ship in slot 0.
 */
export function boardBoosts(
  s: Sim,
  occ: readonly (number | null)[],
  ship: Ship,
  byId?: Map<number, Ship>,
): BoardSynergy[] {
  const mastery = lvl(s, 'boardMastery');
  if (mastery <= 0) return [];
  const out: BoardSynergy[] = [];
  const adjacent = boardNeighbours(occ, ship.id).map(
    (id) => (byId ? byId.get(id) : s.ships.find((x) => x.id === id))?.cls,
  );
  if (occ[0] === ship.id)
    out.push({ kind: 'catapult', stat: 'speed', factor: 1 + SCALE_BOARD_CATAPULT * mastery });
  if (adjacent.includes('scout')) {
    if (ship.cls === 'drone' || ship.cls === 'harvester')
      out.push({ kind: 'sensorLink', stat: 'mining', factor: 1 + SCALE_BOARD_SENSOR * mastery });
    else if (ship.cls === 'fighter')
      out.push({ kind: 'sensorLink', stat: 'damage', factor: 1 + SCALE_BOARD_SENSOR * mastery });
  }
  if (ship.cls === 'hauler' && adjacent.includes('barge')) {
    const factor = 1 + SCALE_BOARD_DISPATCH * mastery;
    out.push({ kind: 'dispatchLink', stat: 'speed', factor });
    out.push({ kind: 'dispatchLink', stat: 'cargo', factor });
  }
  return out;
}

/** Every board synergy in force for a ship, repair rules first, for the panel (#244, #250). */
export function activeSynergies(
  s: Sim,
  occ: readonly (number | null)[],
  ship: Ship,
  byId?: Map<number, Ship>,
): BoardSynergy[] {
  const out: BoardSynergy[] = [];
  const repair = repairSynergy(s, occ, ship, byId);
  if (repair)
    out.push({
      kind: repair.kind,
      stat: repair.kind === 'boosting' ? 'boost' : 'repair',
      factor: repair.factor,
    });
  out.push(...boardBoosts(s, occ, ship, byId));
  return out;
}

/** Aggregated stat multipliers for one ship, computed once per tick by `buildCtx`. */
export interface BoardEffects {
  speed: number;
  cargo: number;
  mining: number;
  damage: number;
}

const NEUTRAL: BoardEffects = { speed: 1, cargo: 1, mining: 1, damage: 1 };
// Keyed by ship object, never saved. The tick context refills these in place each step.
const effects = new WeakMap<Ship, BoardEffects>();

/** This tick's board multipliers for `ship` (all 1 when the tick has not seen it). */
export function boardEffects(ship: Ship): BoardEffects {
  return effects.get(ship) ?? NEUTRAL;
}

/** Refill a ship's cached multipliers from the synergies that fired this tick. */
export function setBoardEffects(ship: Ship, boosts: readonly BoardSynergy[]): void {
  let e = effects.get(ship);
  if (!e) {
    e = { speed: 1, cargo: 1, mining: 1, damage: 1 };
    effects.set(ship, e);
  }
  e.speed = 1;
  e.cargo = 1;
  e.mining = 1;
  e.damage = 1;
  for (const b of boosts) {
    if (b.stat === 'speed') e.speed *= b.factor;
    else if (b.stat === 'cargo') e.cargo *= b.factor;
    else if (b.stat === 'mining') e.mining *= b.factor;
    else if (b.stat === 'damage') e.damage *= b.factor;
  }
}

/** Take a ship out of every hangar slot it occupies. */
export function removeFromHangars(s: Sim, shipId: number) {
  for (const h of s.hangars) h.items = h.items.filter((it) => it.shipId !== shipId);
}

export function moveShip(s: Sim, shipId: number, toHangar: number, start: number): boolean {
  const ship = s.ships.find((x) => x.id === shipId);
  const target = s.hangars.find((h) => h.id === toHangar);
  if (!ship || !target) return false;
  if (!fits(s, target, ship.cls, start, shipId)) return false;
  removeFromHangars(s, shipId);
  target.items.push({ shipId, start });
  ship.hangarId = target.id;
  return true;
}
