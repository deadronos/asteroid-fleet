import type { GameState } from './types';

/**
 * Admiralty milestones (#70): permanent unlocks by Admiralty count. They derive from
 * `lifetime.admiralties`, which neither prestige() nor admiralty() resets, so no extra
 * state is saved.
 */
export type MilestoneReward = 'hulls' | 'carrier';

export interface Milestone {
  /** Admiralty resets needed. */
  at: number;
  reward: MilestoneReward;
  label: string;
}

export const MILESTONES: readonly Milestone[] = [
  { at: 1, reward: 'hulls', label: 'All hull classes' },
  { at: 3, reward: 'carrier', label: 'Second carrier slot' },
  { at: 5, reward: 'carrier', label: 'Third carrier slot' },
];

type Counted = Pick<GameState, 'lifetime'>;

/** Milestones reached at the current Admiralty count. */
export function reachedMilestones(g: Counted): Milestone[] {
  return MILESTONES.filter((m) => g.lifetime.admiralties >= m.at);
}

/** Next milestone not yet reached, or null when all are. */
export function nextMilestone(g: Counted): Milestone | null {
  return MILESTONES.find((m) => g.lifetime.admiralties < m.at) ?? null;
}

/** True once the hull-class milestone is reached: every hull is available. */
export function hullsUnlockedByMilestone(g: Counted): boolean {
  return reachedMilestones(g).some((m) => m.reward === 'hulls');
}

/** Carriers the player may run at once: the first, plus one per carrier milestone reached. */
export function carrierSlots(g: Counted): number {
  return 1 + reachedMilestones(g).filter((m) => m.reward === 'carrier').length;
}
