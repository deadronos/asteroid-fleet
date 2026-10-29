// Small pure costs and payouts the UI reads. Kept apart from `actions.ts` so the panels do not
// pull the command interpreter (and the whole sim behind it) into the initial bundle.
import { MARKS_DIVISOR, RP_DIVISOR, RP_PER_MARK, SHIP_STATS } from './config';
import type { GameState, Sim, ShipClass } from './types';

export const RETROFIT_COST = 800;

export function shipCost(s: Sim, cls: ShipClass): number {
  const n = s.ships.filter((x) => x.cls === cls).length;
  return Math.round(SHIP_STATS[cls].cost * Math.pow(1.07, n));
}

export function researchPayout(s: Pick<GameState, 'stats' | 'lifetime'>): number {
  const base = Math.floor(Math.sqrt(s.stats.oreValueDelivered / RP_DIVISOR)) * s.stats.furthestTier;
  return Math.floor(base * researchMult(s));
}

/** RP multiplier from Admiralty Marks ever earned. */
export function researchMult(s: Pick<GameState, 'lifetime'>): number {
  return 1 + RP_PER_MARK * s.lifetime.marksEarned;
}

/** Lifetime RP counting the run in progress, as an Admiralty reset would bank it. */
export function lifetimeResearch(s: Pick<GameState, 'stats' | 'lifetime'>): number {
  return s.lifetime.researchEarned + researchPayout(s);
}

/** Marks the next Admiralty reset pays: floor(sqrt(lifetime RP / divisor)) less what was paid. */
export function marksPayout(s: Pick<GameState, 'stats' | 'lifetime'>): number {
  const total = Math.floor(Math.sqrt(lifetimeResearch(s) / MARKS_DIVISOR));
  return Math.max(0, total - s.lifetime.marksEarned);
}

/** Why `cost` credits can't be spent now, or null. */
export function creditsShort(s: Sim, cost: number): string | null {
  return s.credits < cost ? `Need ${Math.ceil(cost)} credits` : null;
}
