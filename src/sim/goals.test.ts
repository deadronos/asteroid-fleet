import { describe, expect, it } from 'vitest';
import { creditsShort } from './costs';
import { warpBlocked } from './warpReason';
import { tierHint } from './config';
import { goals } from './goals';
import { game } from './testing';

describe('goals', () => {
  it('starts unfinished and completes on reaching the frontier', () => {
    const s = game(1);
    expect(goals(s).some((g) => g.done)).toBe(false);
    s.stats.furthestTier = 2;
    expect(goals(s).every((g) => g.done)).toBe(true);
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
