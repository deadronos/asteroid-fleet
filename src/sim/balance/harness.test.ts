import { describe, expect, it } from 'vitest';
import { researchPayout } from '../actions';
import { RP_DIVISOR } from '../config';
import { clock, compact, formatReport, parseArgs, payout, runBalance } from './harness';
import { steadyPolicy } from './policy';
import { game } from '../testing';

const short = () => ({
  hours: 0.25,
  seed: 42,
  rpDivisors: [RP_DIVISOR, 1e6],
  sampleMinutes: 5,
  research: {},
  policy: steadyPolicy(),
});

describe('balance harness', () => {
  it('agrees with the game payout at the shipped divisor', () => {
    const s = game(1);
    s.stats.oreValueDelivered = 123_456;
    s.stats.furthestTier = 2;
    expect(payout(s, RP_DIVISOR)).toBe(researchPayout(s));
  });

  it('is deterministic for a seed and samples on schedule', () => {
    const a = runBalance(short());
    const b = runBalance(short());
    expect(a.samples.map((x) => x.t)).toEqual([300, 600, 900]);
    expect(JSON.stringify(a.samples)).toBe(JSON.stringify(b.samples));
    expect(a.end.oreValueDelivered).toBeGreaterThan(0);
    expect(a.end.ships.drone).toBeGreaterThan(0);
  });

  it('prints a report with the table and milestones', () => {
    const text = formatReport(runBalance(short()));
    expect(text).toContain('RP@10k');
    expect(text).toContain('RP@1M');
    expect(text).toContain('First prestige');
    expect(text).toContain('Prestige at end');
  });

  it('parses CLI flags', () => {
    const { options, json } = parseArgs([
      '--hours',
      '6',
      '--seed',
      '7',
      '--rp-divisor',
      '1e4,1e5,1e6',
      '--research',
      'autoRebuild=1,slots',
      '--json',
    ]);
    expect(options.hours).toBe(6);
    expect(options.seed).toBe(7);
    expect(options.rpDivisors).toEqual([1e4, 1e5, 1e6]);
    expect(options.research).toEqual({ autoRebuild: 1, slots: 1 });
    expect(json).toBe(true);
    expect(() => parseArgs(['--hours', '-1'])).toThrow(/positive number/);
    expect(() => parseArgs(['--policy', 'nope'])).toThrow(/Unknown policy/);
  });

  it('formats numbers compactly', () => {
    expect(compact(950)).toBe('950');
    expect(compact(10_000)).toBe('10k');
    expect(compact(1_250_000)).toBe('1.3M');
    expect(clock(3725)).toBe('1:02');
    expect(clock(null)).toBe('—');
  });
});
