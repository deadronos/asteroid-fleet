// Hangar board facts shared by the sim, the tick context and the Fleet panel.
// Every helper is pure: an optional ship lookup keeps boards O(slots) instead
// of scanning the whole fleet once per item (#250).

import { BASE_STORAGE, HANGAR_TYPES, SHIP_STATS } from './config';
import { lvl, SCALE_REPAIR_FIELD } from './research';
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

/** Which dock-repair rule fired, for the panel to name without restating the condition. */
export type RepairSynergyKind = 'repair' | 'bargeBay' | 'boosting';

/** One repair-bonus rule: its multiplier and identity, shared by sim and UI (#250). */
export interface RepairSynergy {
  /** Rate multiplier for the docked ship; 1 for the reciprocal hint on a repair drone. */
  factor: number;
  kind: RepairSynergyKind;
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
