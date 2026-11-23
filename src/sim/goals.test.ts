import { describe, expect, it } from 'vitest';
import { tierHint } from './config';
import { creditsShort } from './costs';
import { createShip } from './economy';
import { goalPhases, goals } from './goals';
import { addCarrier, stateOf } from './state';
import { game } from './testing';
import { warpBlocked } from './warpReason';

describe('goals', () => {
  it('defines six phases that advance purely from derived state (#245)', () => {
    const s = game(1);
    for (const h of s.hangars) h.slots = 40;
    expect(goalPhases(s)).toHaveLength(6);
    expect(goals(s)[0]).toMatchObject({ phase: 1, phaseLabel: 'First Fleet', done: false });

    // Phase 1 completes on reaching the Frontier.
    s.stats.furthestTier = 2;
    expect(goals(s)[0].phase).toBe(2);
    expect(goals(s)[0].phaseLabel).toBe('Barge Chain');

    for (const cls of ['barge', 'hauler', 'scout'] as const) {
      if (!s.unlocked.includes(cls)) s.unlocked.push(cls);
      createShip(s, cls);
    }
    s.stats.oreValueDelivered = 20_000;
    expect(goals(s)[0].phase).toBe(3);
    expect(goals(s)[0].phaseLabel).toBe('First Prestige');

    s.lifetime.prestiges = 1;
    s.lifetime.researchEarned = 5;
    s.researchLevels.yield = 1;
    expect(goals(s)[0].phase).toBe(4);
    expect(goals(s)[0].phaseLabel).toBe('Fusion & Deep Space');

    s.researchLevels.fusion = 1;
    s.unlocked.push('harvester');
    createShip(s, 'harvester');
    s.stats.furthestTier = 3;
    expect(goals(s)[0].phase).toBe(5);
    expect(goals(s)[0].phaseLabel).toBe('Challenges & Admiralty');

    stateOf(s).challengesDone.push('pacifist');
    s.lifetime.admiralties = 1;
    s.admiralty.admDoctrine = 1;
    expect(goals(s)[0].phase).toBe(6);
    expect(goals(s)[0].phaseLabel).toBe('Multi-Carrier Fleet');

    addCarrier(stateOf(s));
    stateOf(s).routes.push({
      id: 1,
      from: s.id,
      to: stateOf(s).ops[1].id,
      resource: 'ore',
      rate: 20,
      rng: 1,
      moved: 0,
      lost: 0,
    });
    expect(goals(s).every((g) => g.done)).toBe(true);
  });

  it('keeps the last phase visible once everything is done', () => {
    const s = game(1);
    for (const h of s.hangars) h.slots = 40;
    for (const cls of ['barge', 'hauler', 'scout'] as const) {
      if (!s.unlocked.includes(cls)) s.unlocked.push(cls);
      createShip(s, cls);
    }
    s.stats.furthestTier = 3;
    s.stats.creditsEarned = 10_000;
    s.stats.oreValueDelivered = 100_000;
    s.lifetime.prestiges = 1;
    s.lifetime.researchEarned = 10;
    s.researchLevels.yield = 1;
    s.researchLevels.fusion = 1;
    s.carrier.h2 = 1;
    stateOf(s).challengesDone.push('pacifist');
    s.lifetime.admiralties = 1;
    s.admiralty.admDoctrine = 1;
    addCarrier(stateOf(s));
    stateOf(s).routes.push({
      id: 2,
      from: s.id,
      to: stateOf(s).ops[1].id,
      resource: 'ore',
      rate: 20,
      rng: 1,
      moved: 0,
      lost: 0,
    });
    expect(goals(s).every((g) => g.done)).toBe(true);
    expect(goals(s)[0].phase).toBe(6);
  });

  it('hint names the action', () => {
    expect(tierHint(2)).toContain('Warp to a Frontier system');
  });
});

describe('disabled reasons', () => {
  it('explain warp and credit blocks', () => {
    const s = game(1);
    s.carrier.energy = 0;
    s.carrier.h2 = 0;
    expect(warpBlocked(s, 0)).toBe('Unknown system');
    expect(warpBlocked(s, 1)).toMatch(/^Needs \d+ energy/);
    s.credits = 5;
    expect(creditsShort(s, 100)).toBe('Need 100 credits');
    expect(creditsShort(s, 5)).toBeNull();
  });
});
