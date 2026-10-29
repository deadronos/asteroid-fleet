import { hullsUnlockedByMilestone } from './milestones';
import {
  ENERGY_MAX,
  HANGAR_UPKEEP,
  HULLS,
  HULL_IDS,
  REFINE_ENERGY,
  REFINE_ENERGY_STEP,
  SHIP_STATS,
  SHIP_UPKEEP,
  SOLAR_CAPACITY_EXP,
  SOLAR_RATE,
  refineRate,
  warpCost,
} from './config';
import { findSpace, fits } from './hangar';
import { energyMult, shipBanned } from './modifiers';
import { admiraltyEffect } from './admiralty';
import { lvl, repeatEffect } from './research';
import type { Hangar, Ship, ShipClass, Sim } from './types';

export function maxHull(s: Sim, cls: ShipClass): number {
  let h = SHIP_STATS[cls].hull * (1 + 0.15 * lvl(s, 'armor'));
  if (cls === 'barge' && lvl(s, 'bargeBay') > 0) h *= 1.5;
  if (cls === 'drone') h *= 1 + 0.3 * lvl(s, 'droneHull');
  if (cls === 'hauler') h *= 1 + 0.4 * lvl(s, 'haulerHull');
  if (cls === 'fighter') h *= 1 + 0.25 * lvl(s, 'fighterHull');
  if (cls === 'harvester') h *= 1 + 0.3 * lvl(s, 'harvestHull');
  return h;
}

/** Carrier hull points: hull class times Reinforced frame. */
export function carrierMaxHull(s: Sim): number {
  return HULLS[s.carrier.hullClass].hull * (1 + 0.12 * lvl(s, 'frame'));
}

export function maxEnergy(s: Sim): number {
  return ENERGY_MAX * energyMult(s) * capacityMult(s);
}

/** Energy pool multiplier from the hull and capacity upgrades, without challenge modifiers. */
function capacityMult(s: Sim): number {
  return (
    HULLS[s.carrier.hullClass].energy *
    (1 + 0.25 * lvl(s, 'energyCap')) *
    (1 + repeatEffect(s, 'deepEnergy')) *
    (1 + admiraltyEffect(s, 'admEnergy'))
  );
}

/** Refinery throughput, ore/s: level, hull class and void refining. */
export function refineThroughput(s: Sim): number {
  return (
    refineRate(s.carrier.refinery) *
    HULLS[s.carrier.hullClass].refinery *
    (1 + 0.1 * lvl(s, 'reactor')) *
    (1 + 0.25 * lvl(s, 'voidRefining'))
  );
}

/** Energy per ore unit refined: each refinery level makes the refinery more efficient. */
export function refineEnergy(s: Sim): number {
  return REFINE_ENERGY * REFINE_ENERGY_STEP ** s.carrier.refinery;
}

/** Jump energy between two system distances, with the hull's multiplier. */
export function jumpCost(s: Sim, from: number, to: number): number {
  return warpCost(from, to, HULLS[s.carrier.hullClass].warpCost * (1 - 0.05 * lvl(s, 'sensors')));
}

/** Unlock hull classes the run has earned: after the first prestige, by furthest tier. */
export function unlockHulls(s: Sim) {
  const all = hullsUnlockedByMilestone(s);
  if (s.lifetime.prestiges < 1 && !all) return;
  for (const id of HULL_IDS)
    if ((all || HULLS[id].tier <= s.stats.furthestTier) && !s.hulls.includes(id)) s.hulls.push(id);
}

/** Solar recharge in the current system, energy/s, before storm boosts. Grows with capacity. */
export function solarRate(s: Sim): number {
  return (
    SOLAR_RATE *
    s.systems[s.systemId].brightness *
    (1 + 0.2 * lvl(s, 'solar')) *
    capacityMult(s) ** SOLAR_CAPACITY_EXP
  );
}

/** Energy/s drawn by `count` hangars. */
export function hangarUpkeep(count: number): number {
  let e = 0;
  for (let i = 0; i < count; i++) e += HANGAR_UPKEEP(i);
  return e;
}

/** Energy/s the hangars and launched ships draw right now (#60). Docked ships are free. */
export function upkeepRate(s: Sim): number {
  let total = hangarUpkeep(s.hangars.length);
  for (const x of s.ships) if (x.mode !== 'docked') total += SHIP_UPKEEP[x.cls];
  return total;
}

export interface Upkeep {
  hangars: number;
  /** Energy/s for the hangars alone. */
  hangarRate: number;
  /** Launched (not docked) ships per class. */
  launched: Record<ShipClass, number>;
  /** Energy/s for all hangars and launched ships. */
  total: number;
}

/** `upkeepRate` broken down for the Power panel. */
export function upkeep(s: Sim): Upkeep {
  const launched = Object.fromEntries(Object.keys(SHIP_UPKEEP).map((c) => [c, 0])) as Record<
    ShipClass,
    number
  >;
  const hangarRate = hangarUpkeep(s.hangars.length);
  let total = hangarRate;
  for (const x of s.ships) {
    if (x.mode === 'docked') continue;
    launched[x.cls]++;
    total += SHIP_UPKEEP[x.cls];
  }
  return { hangars: s.hangars.length, hangarRate, launched, total };
}

export function createShip(
  s: Sim,
  cls: ShipClass,
  preferredHangar?: number,
  start?: number,
): Ship | null {
  // The one place every ship comes from (buy, reserves, auto-buy, rebuilds): modifiers ban here.
  if (shipBanned(s, cls)) return null;
  let hangar: Hangar | undefined;
  let at = start ?? -1;
  if (preferredHangar !== undefined && start !== undefined) {
    // An explicit slot is honoured only if the span is in range and free; no fallback.
    hangar = s.hangars.find((h) => h.id === preferredHangar);
    if (!hangar || !fits(s, hangar, cls, start)) return null;
  } else {
    const space = findSpace(s, cls, preferredHangar);
    if (!space) return null;
    hangar = space.hangar;
    at = space.start;
  }
  if (!hangar || at < 0) return null;
  const ship: Ship = {
    id: s.nextId++,
    cls,
    hangarId: hangar.id,
    mode: 'docked',
    pos: { ...s.carrier.pos },
    hull: maxHull(s, cls),
    cargo: 0,
    cargoValue: 0,
    h2: 0,
    targetId: -1,
    escortId: -1,
    station: null,
    bargeId: -1,
    fireCooldown: 0,
    modules: [],
  };
  s.ships.push(ship);
  hangar.items.push({ shipId: ship.id, start: at });
  return ship;
}
