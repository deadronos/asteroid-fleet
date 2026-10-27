// Run modifiers and challenge runs (#71, part of #52).
//
// A modifier is a rule that bends one run: it lives in `GameState.modifiers` and is read through
// the small hooks below, so each rule has one place that names it. A challenge is a named bundle
// of modifiers with a goal; finishing it pays Admiralty Marks and a permanent bonus. Nothing here
// touches the sim loop except `challengeProgress`, which the tick uses to ask whether it is done.
import type { ChallengeId, GameState, ModifierId, ShipClass } from './types';

export interface ModifierDef {
  name: string;
  blurb: string;
}

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  noFighters: {
    name: 'No fighters',
    blurb: 'Fighters cannot be built. Drones and barges must cope.',
  },
  halfEnergy: { name: 'Half energy', blurb: 'The carrier energy pool is half its usual size.' },
  deepSpace: { name: 'Deep-space start', blurb: 'The run starts in the first tier-2 system.' },
};

export interface ChallengeDef {
  name: string;
  blurb: string;
  modifiers: ModifierId[];
  /** Ore value to deliver within the run. */
  goal: number;
  /** Admiralty Marks paid on completion. */
  marks: number;
  /** Permanent fraction added to all ore value (stacks with each completed challenge). */
  oreBonus: number;
}

export const CHALLENGES: Record<ChallengeId, ChallengeDef> = {
  pacifist: {
    name: 'Pacifist',
    blurb: 'Deliver ore without a single fighter.',
    modifiers: ['noFighters'],
    goal: 1_500_000,
    marks: 1,
    oreBonus: 0.05,
  },
  lowPower: {
    name: 'Low power',
    blurb: 'Run the fleet on half the energy.',
    modifiers: ['halfEnergy'],
    goal: 2_500_000,
    marks: 2,
    oreBonus: 0.05,
  },
  deepStart: {
    name: 'Deep start',
    blurb: 'Start among the pirates, with no fighters to meet them.',
    modifiers: ['deepSpace', 'noFighters'],
    goal: 4_000_000,
    marks: 3,
    oreBonus: 0.08,
  },
};

export const CHALLENGE_IDS = Object.keys(CHALLENGES) as ChallengeId[];

export function hasModifier(s: Pick<GameState, 'modifiers'>, id: ModifierId): boolean {
  return s.modifiers.includes(id);
}

/** Why `cls` cannot be built under the active modifiers, or null. */
export function shipBanned(s: Pick<GameState, 'modifiers'>, cls: ShipClass): string | null {
  return cls === 'fighter' && hasModifier(s, 'noFighters') ? 'Fighters are banned this run' : null;
}

/** Multiplier on the carrier's energy pool. */
export function energyMult(s: Pick<GameState, 'modifiers'>): number {
  return hasModifier(s, 'halfEnergy') ? 0.5 : 1;
}

/** The system a run starts in. */
export function startSystem(s: Pick<GameState, 'modifiers' | 'systems'>): number {
  if (!hasModifier(s, 'deepSpace')) return 0;
  return s.systems.find((x) => x.tier === 2)?.id ?? 0;
}

/** Permanent ore value bonus from completed challenges. */
export function challengeBonus(s: Pick<GameState, 'challengesDone'>): number {
  let b = 0;
  for (const id of s.challengesDone) b += CHALLENGES[id]?.oreBonus ?? 0;
  return b;
}

/** Fraction (0..1) of the active challenge's goal delivered so far, or null with none. */
export function challengeProgress(s: Pick<GameState, 'challenge' | 'stats'>): number | null {
  if (!s.challenge) return null;
  return Math.min(1, s.stats.oreValueDelivered / CHALLENGES[s.challenge].goal);
}
