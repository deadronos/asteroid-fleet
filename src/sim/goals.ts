import type { Sim } from './types';
import { tierHint } from './config';

export interface Goal {
  id: string;
  label: string;
  hint: string;
  done: boolean;
}

/** First-run checklist, derived from state so it needs no saved progress. */
export function goals(s: Sim): Goal[] {
  const drones = s.ships.filter((x) => x.cls === 'drone').length;
  return [
    {
      id: 'drones',
      label: 'Grow the mining fleet to 8 drones',
      hint: 'Hangars tab: buy drones into free slots.',
      done: drones >= 8 || s.stats.furthestTier >= 2,
    },
    {
      id: 'bottleneck',
      label: 'Earn 5,000 credits',
      hint: 'The Carrier table shows the slowest link (mining, hauling, refining): fix that one.',
      done: s.stats.creditsEarned >= 5000 || s.stats.furthestTier >= 2,
    },
    {
      id: 'frontier',
      label: 'Reach the Frontier',
      hint: `${tierHint(2)}. Unlocks fighters and repair ships.`,
      done: s.stats.furthestTier >= 2,
    },
  ];
}
