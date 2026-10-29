// Scripted players for the balance harness. A policy only issues the same
// commands the UI can (`order`), so a run measures the game, not the script.

import { order, shipCost } from '../actions';
import { autoRebuildUnlocked } from '../automation';
import { refineThroughput, solarRate, upkeepRate } from '../economy';
import { lvl } from '../research';
import {
  FUSION_RATE,
  MAX_REFINERY,
  REFINE_ENERGY,
  REFINERY_COST,
  SOFT_HANGAR_SLOTS,
  SOFT_HANGARS,
  warpCost,
} from '../config';
import { SHIP_CLASSES, type Sim, type HangarType, type ShipClass } from '../types';

export interface Policy {
  name: string;
  /** One line for the report header. */
  describe: string;
  /** Called once before the first tick (doctrine, rules). */
  setup?(s: Sim): void;
  /** Called every `ACT_INTERVAL_TICKS`; spends credits and decides warps. */
  act(s: Sim): void;
}

/** True when energy could feed a faster refinery: the current one draws less than solar (and fusion) spare. */
function refineryIsLimit(s: Sim): boolean {
  const fusion = lvl(s, 'fusion') > 0 && s.carrier.h2 > 0 ? FUSION_RATE : 0;
  return refineThroughput(s) * REFINE_ENERGY < solarRate(s) + fusion - upkeepRate(s);
}

/** Ticks between policy passes: once a game second, like the automation pass. */
export const ACT_INTERVAL_TICKS = 10;

export type Counts = Record<ShipClass, number>;

export function shipCounts(s: Sim): Counts {
  const n = Object.fromEntries(SHIP_CLASSES.map((c) => [c, 0])) as Counts;
  for (const x of s.ships) n[x.cls]++;
  return n;
}

/**
 * Buy a ship, growing the hangars when they are full: a slot in the smallest
 * hangar first, then a new hangar once every hangar is at its maximum size.
 * Returns true if something was bought.
 */
export function buyShipOrRoom(s: Sim, cls: ShipClass, newHangar: HangarType): boolean {
  if (s.credits < shipCost(s, cls)) return false;
  const err = order(s, { type: 'buyShip', cls });
  if (err === null) return true;
  if (err !== 'No free hangar slots') return false;
  const smallest = [...s.hangars].sort((a, b) => a.slots - b.slots)[0];
  if (smallest && (smallest.slots < SOFT_HANGAR_SLOTS || s.hangars.length >= SOFT_HANGARS))
    return order(s, { type: 'buySlot', hangarId: smallest.id }) === null;
  return order(s, { type: 'buyHangar', hangarType: newHangar }) === null;
}

/** A discovered system one jump further out (`step` 1) or back (-1), or null. Plain systems before gas giants. */
export function neighbour(s: Sim, dir: 1 | -1) {
  const here = s.systems[s.systemId];
  const out = s.systems.filter((x) => x.discovered && x.distance === here.distance + dir);
  return out.sort((a, b) => Number(a.gasGiant) - Number(b.gasGiant) || a.id - b.id)[0] ?? null;
}

/** Warp to `to`, switching to defense power to bank energy while the jump is not yet affordable. */
export function jump(s: Sim, to: number): boolean {
  const from = s.systems[s.systemId].distance;
  const cost = warpCost(from, s.systems[to].distance);
  // 'defense' power holds half the pool back from refining, enough for any one jump.
  const mode = s.carrier.energy >= cost ? 'balanced' : 'defense';
  if (s.powerMode !== mode) order(s, { type: 'setPower', mode });
  return order(s, { type: 'warp', systemId: to }) === null;
}

export interface SteadyParams {
  /** Drones before the first barge. */
  dronesPerBarge: number;
  /** Fighters per drone once fighters unlock. */
  fighterShare: number;
  /** Minimum ship count before warping one step further out, by the target's distance. */
  shipsToWarp: (distance: number) => number;
  /** Credits kept back after a warp into a new tier, to buy escorts on arrival. */
  arrivalReserve: number;
  /** Game seconds without a ship loss before the fleet moves on. */
  calmBeforeWarp: number;
  /** Losing this share of the fleet within `lossWindow` seconds means warp back and stay there. */
  retreatShare: number;
  lossWindow: number;
}

export const STEADY_DEFAULTS: SteadyParams = {
  dronesPerBarge: 8,
  fighterShare: 0.25,
  shipsToWarp: (d) => 10 + 6 * d,
  arrivalReserve: 1000,
  calmBeforeWarp: 180,
  retreatShare: 0.25,
  lossWindow: 120,
};

/**
 * "Steady": a patient player. Drones first, a barge and hauler per eight drones, one scout,
 * fighters and a repair drone once the frontier unlocks them; the refinery whenever ore backs
 * up and energy is not the limit; warps one system outward once the fleet is big enough and has
 * lost nothing for a while, banking energy (defense power) for the jump. If a system mauls the
 * fleet it warps back and never goes that far again. No modules, no research spending.
 */
export function steadyPolicy(p: Partial<SteadyParams> = {}): Policy {
  const k = { ...STEADY_DEFAULTS, ...p };

  function want(s: Sim, n: Counts): ShipClass {
    if (n.drone < 6) return 'drone';
    if (n.barge * k.dronesPerBarge < n.drone - 4) return 'barge';
    if (n.hauler < n.barge) return 'hauler';
    if (s.unlocked.includes('scout') && n.scout < 1) return 'scout';
    if (s.unlocked.includes('fighter') && n.fighter < Math.max(2, n.drone * k.fighterShare))
      return 'fighter';
    if (s.unlocked.includes('repair') && n.repair < 1) return 'repair';
    return 'drone';
  }

  let lost = 0;
  let lastLoss = 0;
  let windowStart = 0;
  let windowLost = 0;
  let ceiling = Infinity; // furthest distance this policy will still warp to

  return {
    name: 'steady',
    describe:
      'drones, a barge+hauler per 8 drones, 1 scout, fighters 1:4 once unlocked; warps out when big and calm, back when mauled',
    setup(s) {
      // 'safe' drones stall once the carrier parks away from covered rocks (see balance.test.ts).
      order(s, { type: 'setStance', scope: 'drone', patch: { mining: 'greedy' } });
    },
    act(s) {
      if (autoRebuildUnlocked(s) && !s.automation.autoRebuild)
        order(s, { type: 'setAutomation', patch: { autoRebuild: true } });
      if (s.stats.shipsLost > lost) {
        lost = s.stats.shipsLost;
        lastLoss = s.time;
      }
      if (s.time - windowStart >= k.lossWindow) {
        windowStart = s.time;
        windowLost = lost;
      }
      if (s.warp) return;

      const here = s.systems[s.systemId];
      const back = neighbour(s, -1);
      if (back && lost - windowLost > k.retreatShare * Math.max(10, s.ships.length)) {
        ceiling = here.distance - 1;
        windowLost = lost;
        if (jump(s, back.id)) return;
      }
      const target = neighbour(s, 1);
      const calm = s.time - lastLoss >= k.calmBeforeWarp && !s.wave.active && !s.wave.warning;
      if (
        target &&
        target.distance <= ceiling &&
        calm &&
        s.ships.length >= k.shipsToWarp(target.distance) &&
        s.credits >= (target.tier > here.tier ? k.arrivalReserve : 0) &&
        jump(s, target.id)
      )
        return;
      if (s.powerMode !== 'balanced') order(s, { type: 'setPower', mode: 'balanced' });

      // Refinery first while ore waits on the carrier and energy can feed a faster one, then up to
      // five ship buys a pass.
      if (
        s.carrier.refinery < MAX_REFINERY &&
        s.carrier.ore > 300 &&
        refineryIsLimit(s) &&
        s.credits >= REFINERY_COST(s.carrier.refinery)
      )
        order(s, { type: 'upgradeRefinery' });
      for (let i = 0; i < 5; i++) {
        const cls = want(s, shipCounts(s));
        if (!buyShipOrRoom(s, cls, s.hangars.length % 2 ? 'cargo' : 'launch')) break;
      }
    },
  };
}

export const POLICIES: Record<string, () => Policy> = {
  steady: () => steadyPolicy(),
};
