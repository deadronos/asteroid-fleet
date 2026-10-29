import { softcap } from './research';
import type { GameState } from './types';

/** An infinite Admiralty upgrade (#69): geometric Mark cost, soft-capped effect. */
export interface AdmiraltyUpgrade {
  id: string;
  name: string;
  desc: string;
  /** Marks for the first level. */
  base: number;
  /** Cost multiplier per level bought. */
  ratio: number;
  /** Effect approached as the level grows (see `softcap`). */
  cap: number;
  label: (effect: number) => string;
}

const pct = (e: number) => Math.round(e * 100);

export const ADMIRALTY_UPGRADES: AdmiraltyUpgrade[] = [
  {
    // Id kept from when it raised mining yield, so saves keep their levels (#214).
    id: 'admYield',
    name: 'Prospecting Charter',
    desc: 'Ore value of new asteroids, diminishing toward +100 %',
    base: 1,
    ratio: 1.6,
    cap: 1,
    label: (e) => `+${pct(e)} % ore value`,
  },
  {
    id: 'admEnergy',
    name: 'Reactor Refit',
    desc: 'Carrier energy capacity (and with it solar), diminishing toward +100 %',
    base: 2,
    ratio: 1.7,
    cap: 1,
    label: (e) => `+${pct(e)} % energy capacity`,
  },
  {
    id: 'admCredits',
    name: 'Founders Grant',
    desc: 'Credits at the start of each run, diminishing toward +5000',
    base: 1,
    ratio: 1.8,
    cap: 5000,
    label: (e) => `+${Math.round(e)} starting credits`,
  },
];

export const ADMIRALTY_BY_ID: Record<string, AdmiraltyUpgrade> = Object.fromEntries(
  ADMIRALTY_UPGRADES.map((u) => [u.id, u]),
);

type Levels = Pick<GameState, 'admiralty'>;
type Purse = Levels & Pick<GameState, 'marks'>;

export function admiraltyLevel(s: Levels, id: string): number {
  return s.admiralty[id] ?? 0;
}

/** Marks for the next level of `id`; Infinity for an unknown upgrade. */
export function admiraltyCost(s: Levels, id: string): number {
  const u = ADMIRALTY_BY_ID[id];
  return u ? Math.ceil(u.base * u.ratio ** admiraltyLevel(s, id)) : Infinity;
}

/** Current soft-capped effect of `id` (0 at level 0). */
export function admiraltyEffect(s: Levels, id: string): number {
  const u = ADMIRALTY_BY_ID[id];
  return u ? softcap(admiraltyLevel(s, id), u.cap) : 0;
}

export function canBuyAdmiralty(s: Purse, id: string): boolean {
  return !!ADMIRALTY_BY_ID[id] && s.marks >= admiraltyCost(s, id);
}

/** Spend Marks on one level. Returns false (changing nothing) when unknown or unaffordable. */
export function buyAdmiralty(s: Purse, id: string): boolean {
  if (!canBuyAdmiralty(s, id)) return false;
  s.marks -= admiraltyCost(s, id);
  s.admiralty[id] = admiraltyLevel(s, id) + 1;
  return true;
}
