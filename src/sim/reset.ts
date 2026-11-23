// Prestige, challenge and Admiralty resets: each builds a fresh GameState that
// the runner adopts. orders.ts handles commands, actions.ts re-exports all (#250).

import { carrierSlots } from './milestones';
import { addCarrier, emit, focused, newGame } from './state';
import { lifetimeResearch, marksPayout, researchPayout } from './costs';
import { RESEARCH_BY_ID } from './research';
import { CHALLENGES } from './modifiers';
import type { ChallengeId, GameState, HullId, ModifierId } from './types';

/** Carriers survive a reset (#78): as many fresh ones as were owned, up to the slots. */
function refillCarriers(next: GameState, owned: number) {
  for (const n = Math.min(owned, carrierSlots(next)); next.ops.length < n;) addCarrier(next);
}

export function prestige(
  s: GameState,
  hull?: HullId,
  run?: { modifiers: ModifierId[]; challenge: ChallengeId },
): GameState {
  const rp = researchPayout(s);
  const next = newGame(s.seed + s.lifetime.prestiges + 1, {
    research: s.research + rp,
    researchLevels: { ...s.researchLevels },
    unlocked: [...s.unlocked],
    unlockedRules: [...s.unlockedRules],
    hulls: [...s.hulls],
    hullClass: hull ?? focused(s).carrier.hullClass,
    discovered: s.systems.filter((x) => x.discovered).map((x) => x.id),
    lifetime: {
      ...s.lifetime,
      prestiges: s.lifetime.prestiges + 1,
      researchEarned: s.lifetime.researchEarned + rp,
    },
    marks: s.marks,
    challengesDone: [...s.challengesDone],
    modifiers: run?.modifiers,
    challenge: run?.challenge,
    admiralty: { ...s.admiralty },
    doctrine: structuredClone(s.doctrine),
    alerts: structuredClone(s.alerts),
    cards: structuredClone(s.cards),
    automation: structuredClone(s.automation),
    loadouts: structuredClone(s.loadouts),
  });
  refillCarriers(next, s.ops.length);
  emit(focused(next), 'Prestiged', { research: rp });
  return next;
}

/**
 * Start a challenge run (#71): a prestige reset (it banks the run's RP like any other) whose new
 * run carries the challenge's modifiers. A plain prestige or Admiralty reset drops them again.
 * Calling it while a challenge is active restarts that attempt.
 */
export function startChallenge(s: GameState, id: ChallengeId, hull?: HullId): GameState | null {
  const def = CHALLENGES[id];
  if (!def) return null;
  const next = prestige(s, hull, { modifiers: [...def.modifiers], challenge: id });
  emit(focused(next), 'ChallengeStarted', { challenge: id });
  return next;
}

/**
 * Second prestige layer (#68, Q6 in #49). Resets the research tree, RP and discovered systems
 * along with the run. Keeps automation nodes, unlocked hulls and rules, carriers (rebuilt
 * fresh, as many as were owned), Marks, doctrine and cards.
 */
export function admiralty(s: GameState): GameState {
  const marks = marksPayout(s);
  const kept = Object.fromEntries(
    Object.entries(s.researchLevels).filter(([id]) => RESEARCH_BY_ID[id]?.branch === 'Automation'),
  );
  const next = newGame(s.seed + s.lifetime.prestiges + s.lifetime.admiralties + 1, {
    research: 0,
    researchLevels: kept,
    unlocked: [...s.unlocked],
    unlockedRules: [...s.unlockedRules],
    discovered: [],
    lifetime: {
      prestiges: s.lifetime.prestiges,
      researchEarned: lifetimeResearch(s),
      admiralties: s.lifetime.admiralties + 1,
      marksEarned: s.lifetime.marksEarned + marks,
    },
    hulls: [...s.hulls],
    hullClass: focused(s).carrier.hullClass,
    alerts: structuredClone(s.alerts),
    marks: s.marks + marks,
    challengesDone: [...s.challengesDone],
    admiralty: { ...s.admiralty },
    doctrine: structuredClone(s.doctrine),
    cards: structuredClone(s.cards),
    automation: structuredClone(s.automation),
    loadouts: structuredClone(s.loadouts),
  });
  refillCarriers(next, s.ops.length);
  emit(focused(next), 'Admiralty', { marks });
  return next;
}
