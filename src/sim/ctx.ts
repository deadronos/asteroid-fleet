import { queueRebuild } from './automation';
// Per-tick lookup context and the small helpers every behaviour module shares.
// The context is derived from Sim at the start of each step and never
// saved; its containers are reused between ticks to keep the hot path free of
// allocations.

import {
  COMPRESSOR_CARGO,
  COVER_RADIUS,
  DOCK_RADIUS,
  HANGAR_TYPES,
  LASER_DAMAGE,
  LASER_RATE,
  MINING_RATE,
  SHIELD_TAKEN,
  SHIP_STATS,
  TRACTOR_SPEED,
} from './config';
import { compileCards, firing, type CompiledCards } from './cards';
import { effectiveStance } from './doctrine';
import { carrierStorage, removeFromHangars } from './hangar';
import { copy, dist, dist2, moveToward } from './math';
import { admiraltyEffect } from './admiralty';
import { lvl, repeatEffect } from './research';
import { emit } from './state';
import { PointGrid } from './spatial';
import {
  SHIP_CLASSES,
  type ActionKind,
  type Asteroid,
  type Sim,
  type Hangar,
  type LossCause,
  type ModuleId,
  type Pirate,
  type RuleCard,
  type Ship,
  type ShipClass,
  type Stance,
  type Vec3,
} from './types';

export const SHIELD_HP = 600;
export const CARRIER = -2;

interface HangarInfo {
  /** Slot -> ship id, or -1 when free. */
  occ: number[];
  drones: number;
  allFighters: boolean;
}

export interface Ctx {
  ships: Map<number, Ship>;
  pirates: Map<number, Pirate>;
  asteroids: Map<number, Asteroid>;
  miners: Map<number, number>; // asteroid id -> drones assigned
  escorts: Map<number, number>; // ship id -> fighters escorting
  haulerClaims: Set<number>; // barge ids a hauler is heading to
  /** Ships by class, in `s.ships` order. */
  byClass: Record<ShipClass, Ship[]>;
  /** Escort candidates (barges, haulers, harvesters), in `s.ships` order. */
  wards: Ship[];
  hangarOf: Map<number, Hangar>;
  hangarInfo: Map<Hangar, HangarInfo>;
  stances: Map<number, Stance>;
  asteroidGrid: PointGrid;
  /** Asteroid ids scouts marked as rich veins. */
  veins: Set<number>;
  /** Upper bound on asteroid value this tick (for pruning grid searches). */
  maxValue: number;
  /** Everyone docks: a jump is charging, or a fleet-wide recall card fired. */
  recall: boolean;
  /** Ships a narrower recall card sent home this tick. */
  recalled: Set<number>;
  /** Active rule cards by action, in priority order. */
  cards: CompiledCards;
  /** The energy pool could not cover this tick's upkeep (#60). */
  powerShort: boolean;
  income: number;
  mining: number;
}

const CLASS_INDEX = Object.fromEntries(SHIP_CLASSES.map((c, i) => [c, i])) as Record<
  ShipClass,
  number
>;

const emptyByClass = (): Record<ShipClass, Ship[]> => ({
  drone: [],
  barge: [],
  hauler: [],
  fighter: [],
  scout: [],
  repair: [],
  harvester: [],
});

const ctx: Ctx = {
  ships: new Map(),
  pirates: new Map(),
  asteroids: new Map(),
  miners: new Map(),
  escorts: new Map(),
  haulerClaims: new Set(),
  byClass: emptyByClass(),
  wards: [],
  hangarOf: new Map(),
  hangarInfo: new Map(),
  stances: new Map(),
  asteroidGrid: new PointGrid(16),
  veins: new Set(),
  maxValue: 0,
  recall: false,
  recalled: new Set(),
  // Filled by compileCards; cards.ts imports this module, so nothing from it runs at load.
  cards: {} as CompiledCards,
  powerShort: false,
  income: 0,
  mining: 0,
};

export function buildCtx(s: Sim): Ctx {
  ctx.ships.clear();
  ctx.pirates.clear();
  ctx.asteroids.clear();
  ctx.miners.clear();
  ctx.escorts.clear();
  ctx.haulerClaims.clear();
  for (const k in ctx.byClass) ctx.byClass[k as ShipClass].length = 0;
  ctx.wards.length = 0;
  ctx.hangarOf.clear();
  ctx.hangarInfo.clear();
  ctx.stances.clear();
  ctx.income = 0;
  ctx.mining = 0;
  ctx.powerShort = false;

  for (const sh of s.ships) {
    ctx.ships.set(sh.id, sh);
    ctx.byClass[sh.cls].push(sh);
    if (sh.cls === 'barge' || sh.cls === 'hauler' || sh.cls === 'harvester') ctx.wards.push(sh);
    if (
      sh.cls === 'drone' &&
      sh.targetId >= 0 &&
      (sh.mode === 'toAsteroid' || sh.mode === 'mining')
    )
      ctx.miners.set(sh.targetId, (ctx.miners.get(sh.targetId) ?? 0) + 1);
    if (sh.cls === 'fighter' && sh.escortId >= 0)
      ctx.escorts.set(sh.escortId, (ctx.escorts.get(sh.escortId) ?? 0) + 1);
    if (sh.cls === 'hauler' && sh.mode === 'toBarge') ctx.haulerClaims.add(sh.targetId);
  }
  for (const p of s.pirates) ctx.pirates.set(p.id, p);
  let maxValue = 0;
  for (const a of s.asteroids) {
    ctx.asteroids.set(a.id, a);
    if (a.value > maxValue) maxValue = a.value;
  }
  ctx.maxValue = maxValue;
  ctx.asteroidGrid.build(s.asteroids);
  ctx.veins.clear();
  for (const id of s.recon.veins) ctx.veins.add(id);
  // First hangar listing a ship wins, matching `hangarOf` in hangar.ts.
  for (const h of s.hangars)
    for (const it of h.items) if (!ctx.hangarOf.has(it.shipId)) ctx.hangarOf.set(it.shipId, h);

  compileCards(s, ctx.cards);
  // Recall is decided once, at the start of the tick.
  const recall = ctx.cards.recall;
  ctx.recall = !!s.warp || !!firing(s, recall, null);
  ctx.recalled.clear();
  if (!ctx.recall && recall.length > 0)
    for (const sh of s.ships) if (firing(s, recall, sh)) ctx.recalled.add(sh.id);
  return ctx;
}

/** Hangar board facts, computed once per hangar per tick. Boards only change outside `behave`. */
export function hangarInfo(c: Ctx, h: Hangar): HangarInfo {
  let info = c.hangarInfo.get(h);
  if (info) return info;
  const occ: number[] = Array.from({ length: h.slots }, () => -1);
  let drones = 0;
  let allFighters = true;
  for (const it of h.items) {
    const ship = c.ships.get(it.shipId);
    if (ship?.cls !== 'fighter') allFighters = false;
    if (!ship) continue;
    if (ship.cls === 'drone') drones++;
    const size = SHIP_STATS[ship.cls].slots;
    for (let i = 0; i < size; i++) if (it.start + i < h.slots) occ[it.start + i] = it.shipId;
  }
  info = { occ, drones, allFighters };
  c.hangarInfo.set(h, info);
  return info;
}

function adjacentClass(c: Ctx, occ: number[], shipId: number, cls: ShipClass): boolean {
  const idx = occ.indexOf(shipId);
  if (idx < 0) return false;
  let end = idx;
  while (end + 1 < occ.length && occ[end + 1] === shipId) end++;
  if (idx > 0 && occ[idx - 1] >= 0 && c.ships.get(occ[idx - 1])?.cls === cls) return true;
  return end + 1 < occ.length && occ[end + 1] >= 0 && c.ships.get(occ[end + 1])?.cls === cls;
}

/** Same as `dockRepairRate` in hangar.ts, using the tick's cached boards. */
export function dockRepair(s: Sim, c: Ctx, ship: Ship): number {
  const h = c.hangarOf.get(ship.id);
  if (!h) return 0;
  let rate = HANGAR_TYPES[h.type].repairRate;
  if (ship.cls === 'fighter' || ship.cls === 'barge') {
    if (adjacentClass(c, hangarInfo(c, h).occ, ship.id, 'repair')) rate *= 3;
  }
  if (ship.cls === 'drone' && lvl(s, 'bargeBay') > 0) {
    if (adjacentClass(c, hangarInfo(c, h).occ, ship.id, 'barge')) rate *= 2;
  }
  return rate * (1 + 0.3 * lvl(s, 'repair'));
}

export function recalled(c: Ctx, ship: Ship): boolean {
  return c.recall || c.recalled.has(ship.id);
}

/** The first `action` card that fires for `ship` (or for the carrier when null). */
export function card(s: Sim, c: Ctx, action: ActionKind, ship: Ship | null) {
  const list = c.cards[action];
  return list.length > 0 ? firing(s, list, ship) : null;
}

/** The stance card in force for `ship`; a timed card stays in force through `ship.hold`. */
function stanceCardOf(s: Sim, c: Ctx, ship: Ship): RuleCard | null {
  const list = c.cards.stance;
  if (list.length === 0) return null;
  const hit = firing(s, list, ship);
  if (hit) {
    if (hit.then.seconds) ship.hold = { card: hit.id, until: s.time + hit.then.seconds };
    return hit;
  }
  const h = ship.hold;
  if (!h) return null;
  if (h.until > s.time) {
    const held = list.find((x) => x.id === h.card);
    if (held) return held;
  }
  delete ship.hold;
  return null;
}

/** `effectiveStance`, shared per hangar, class and stance card within a tick (callers only read it). */
export function stanceOf(s: Sim, c: Ctx, ship: Ship): Stance {
  const rc = stanceCardOf(s, c, ship);
  // Card positions are stable within a tick and below CARD_SLOTS (< 32).
  const key = (ship.hangarId * 8 + CLASS_INDEX[ship.cls]) * 32 + (rc ? s.cards.indexOf(rc) + 1 : 0);
  let st = c.stances.get(key);
  if (!st) {
    st = effectiveStance(s, ship, rc);
    c.stances.set(key, st);
  }
  return st;
}

// ---------- stat helpers ----------

/** Number of `id` modules fitted (modules stack). */
export function modCount(ship: Ship, id: ModuleId): number {
  let n = 0;
  for (const m of ship.modules) if (m === id) n++;
  return n;
}

/** Cargo capacity of a class, including `ship`'s compressors when given. */
export function cargoCap(s: Sim, cls: ShipClass, ship?: Ship): number {
  const base =
    SHIP_STATS[cls].cargo * (ship ? COMPRESSOR_CARGO ** modCount(ship, 'compressor') : 1);
  if (cls === 'barge') return base * (1 + 0.2 * lvl(s, 'bargeCap'));
  if (cls === 'drone') return base * (1 + 0.2 * lvl(s, 'droneCargo'));
  if (cls === 'hauler') return base * (1 + 0.25 * lvl(s, 'haulerHold'));
  if (cls === 'harvester') return base * (1 + 0.25 * lvl(s, 'harvestCargo'));
  return base;
}

export function speed(s: Sim, ship: Ship): number {
  let v = SHIP_STATS[ship.cls].speed;
  if (ship.cls === 'hauler') v *= 1 + 0.12 * lvl(s, 'haulSpeed');
  else if (ship.cls === 'drone') v *= 1 + 0.15 * lvl(s, 'droneSpeed');
  else if (ship.cls === 'barge') v *= 1 + 0.25 * lvl(s, 'bargeThrust');
  else if (ship.cls === 'scout') v *= 1 + 0.25 * lvl(s, 'scoutSpeed');
  else if (ship.cls === 'repair') v *= 1 + 0.25 * lvl(s, 'repairSpeed');
  else if (ship.cls === 'harvester') v *= 1 + 0.2 * lvl(s, 'harvestSpeed');
  return v * TRACTOR_SPEED ** modCount(ship, 'tractor');
}

export function fighterDamage(s: Sim, c: Ctx, ship: Ship): number {
  let d = SHIP_STATS.fighter.damage * (1 + 0.15 * lvl(s, 'damage'));
  if (lvl(s, 'fighterAce') > 0) {
    const h = c.hangarOf.get(ship.id);
    if (h && hangarInfo(c, h).allFighters) d *= 1.25;
  }
  return d * LASER_DAMAGE ** modCount(ship, 'laser');
}

export function miningRate(s: Sim, c: Ctx, ship: Ship): number {
  let r =
    MINING_RATE *
    (1 + 0.15 * lvl(s, 'yield')) *
    (1 + repeatEffect(s, 'deepYield')) *
    (1 + admiraltyEffect(s, 'admYield'));
  if (lvl(s, 'droneSwarm') > 0) {
    const h = c.hangarOf.get(ship.id);
    const n = h ? hangarInfo(c, h).drones : 0;
    r *= 1 + Math.min(0.5, 0.1 * n);
  }
  return r * LASER_RATE ** modCount(ship, 'laser');
}

export function inHazard(s: Sim, p: Vec3): boolean {
  for (const h of s.hazards) if (dist2(h.pos, p) < h.radius * h.radius) return true;
  return false;
}

export function covered(s: Sim, p: Vec3, c: Ctx): boolean {
  if (dist(p, s.carrier.pos) < COVER_RADIUS) return true;
  for (const sh of c.byClass.barge)
    if (sh.mode === 'station' && dist(p, sh.pos) < COVER_RADIUS * 0.6) return true;
  for (const sh of c.byClass.fighter)
    if (sh.mode !== 'docked' && dist(p, sh.pos) < COVER_RADIUS * 0.5) return true;
  return false;
}

export function nearestPirate(s: Sim, p: Vec3, within: number): Pirate | null {
  let best: Pirate | null = null;
  let bd = within * within;
  for (const pi of s.pirates) {
    const d = dist2(pi.pos, p);
    if (d < bd) {
      bd = d;
      best = pi;
    }
  }
  return best;
}

// ---------- damage ----------

export function damageShip(s: Sim, ship: Ship, dmg: number) {
  if (ship.cls === 'hauler' && lvl(s, 'haulerArmor') > 0) dmg *= 0.6;
  if (ship.cls === 'barge') dmg *= 1 - 0.25 * lvl(s, 'bargeShell');
  dmg *= SHIELD_TAKEN ** modCount(ship, 'shield');
  ship.hull -= dmg;
}

export function damageCarrier(s: Sim, dmg: number) {
  const c = s.carrier;
  if (c.shield > 0) {
    const absorbed = Math.min(dmg, c.shield * SHIELD_HP);
    c.shield -= absorbed / SHIELD_HP;
    dmg -= absorbed;
  }
  c.hull -= dmg;
}

export function destroyShip(s: Sim, ship: Ship, cause: LossCause) {
  s.fx.push({ kind: 'explosion', a: copy(ship.pos), b: copy(ship.pos), ttl: 0.8 });
  removeFromHangars(s, ship.id);
  s.stats.shipsLost++;
  queueRebuild(s, ship);
  emit(s, 'ShipLost', { cls: ship.cls, cause });
}

// ---------- cargo ----------

/** Unload cargo at the carrier, capped by storage. Returns true when the hold is empty. */
export function unloadAtCarrier(s: Sim, ship: Ship): boolean {
  const c = s.carrier;
  if (ship.h2 > 0) {
    c.h2 += ship.h2;
    ship.h2 = 0;
  }
  if (ship.cargo <= 0) return true;
  const space = carrierStorage(s) - c.ore;
  const amt = Math.min(space, ship.cargo);
  if (amt <= 0) return false;
  const val = (ship.cargoValue / ship.cargo) * amt;
  c.ore += amt;
  c.oreValue += val;
  s.stats.oreValueDelivered += val;
  ship.cargo -= amt;
  ship.cargoValue -= val;
  if (ship.cargo < 1e-6) {
    ship.cargo = 0;
    ship.cargoValue = 0;
  }
  return ship.cargo === 0;
}

export function transfer(from: Ship, to: Ship, cap: number) {
  if (from.cargo <= 0) return;
  const amt = Math.min(from.cargo, cap - to.cargo);
  if (amt <= 0) return;
  const val = (from.cargoValue / from.cargo) * amt;
  to.cargo += amt;
  to.cargoValue += val;
  from.cargo -= amt;
  from.cargoValue -= val;
  if (from.cargo < 1e-6) {
    from.cargo = 0;
    from.cargoValue = 0;
  }
}

export function dock(s: Sim, ship: Ship) {
  unloadAtCarrier(s, ship);
  ship.mode = 'docked';
  ship.targetId = -1;
  ship.escortId = -1;
  ship.station = null;
  ship.bargeId = -1;
}

export function goHome(s: Sim, ship: Ship, dt: number): boolean {
  if (moveToward(ship.pos, s.carrier.pos, speed(s, ship) * dt, DOCK_RADIUS * 0.5)) {
    dock(s, ship);
    return true;
  }
  return false;
}
