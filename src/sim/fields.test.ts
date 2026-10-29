import { describe, expect, it } from 'vitest';
import { settleOffline } from './actions';
import { FIELD_REFILL_SECS, enterSystem, recordField, focused, stateOf } from './state';
import type { Sim } from './types';
import { executeJump } from './warp';
import { game } from './testing';

/** Save budget for all depletion records together, serialized. */
const FIELDS_BUDGET_BYTES = 16 * 1024;

const warp = (s: Sim, to: number) => {
  s.warp = { targetSystem: to, charge: 0, total: 1, paid: { energy: 0, h2: 0 } };
  executeJump(s);
};

const ores = (s: Sim) => s.asteroids.map((a) => a.ore);

/** Rock positions and sizes of system 1 at a given rare-ore research level. */
const layout = (rare: number) => {
  const s = game(5);
  s.researchLevels.rare = rare;
  enterSystem(s, 1);
  return s.asteroids.map((a) => [a.pos.x, a.pos.z, a.maxOre]);
};

describe('persistent fields', () => {
  it('lays out the same rocks whether or not rare ore is researched (#40)', () => {
    expect(layout(3)).toEqual(layout(0));
  });

  it('keeps ore levels across a warp out and back, plus refill for the time away', () => {
    const s = game(5);
    const fresh = ores(s);
    s.asteroids[0].ore = 0;
    s.asteroids[0].respawn = 50;
    s.asteroids[1].ore = s.asteroids[1].maxOre * 0.25;
    s.asteroids[2].ore = 0;
    s.asteroids[2].respawn = 5;

    warp(s, 1);
    expect(s.fields[0].rocks).toHaveLength(3);
    s.time += 30;
    warp(s, 0);

    const a = s.asteroids;
    expect(ores(s).slice(3)).toEqual(fresh.slice(3));
    expect(a[0].ore).toBe(0);
    expect(a[0].respawn).toBeCloseTo(20);
    expect(a[1].ore / a[1].maxOre).toBeCloseTo(0.25 + 30 / FIELD_REFILL_SECS);
    expect(a[2].ore).toBe(a[2].maxOre); // its respawn ran out while away
    expect(s.fields[0]).toBeUndefined();
    expect(s.fields[1]).toBeDefined();
  });

  it('is fully refilled after a long absence and is deterministic', () => {
    const run = () => {
      const s = game(9);
      for (const a of s.asteroids) a.ore = a.maxOre / 2;
      warp(s, 1);
      s.time += 120;
      warp(s, 0);
      return { ...stateOf(s), savedAt: 0 };
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    const s = game(9);
    for (const a of s.asteroids) a.ore = 0;
    warp(s, 1);
    s.time += FIELD_REFILL_SECS + 100;
    warp(s, 0);
    for (const a of s.asteroids) expect(a.ore).toBe(a.maxOre);
  });

  it(`keeps every system's depletion record under ${FIELDS_BUDGET_BYTES} bytes`, () => {
    const s = game(3);
    // Worst case: every rock in every system half mined or depleted with a long timer.
    for (let id = 0; id < s.systems.length; id++) {
      enterSystem(s, id);
      s.asteroids.forEach((a, i) => {
        a.ore = i % 2 ? 0 : a.maxOre * 0.123456;
        a.respawn = 79.987654;
      });
    }
    s.fields[s.systemId] = recordField(s);
    expect(Object.keys(s.fields)).toHaveLength(s.systems.length);
    expect(JSON.stringify(s.fields).length).toBeLessThanOrEqual(FIELDS_BUDGET_BYTES);
    // The whole save (automation included) grows by no more than the budget.
    const without = JSON.stringify({ ...stateOf(s), fields: {} }).length;
    expect(JSON.stringify(stateOf(s)).length - without).toBeLessThanOrEqual(FIELDS_BUDGET_BYTES);
    expect(s.automation).toBeDefined();
  });

  it('survives offline settlement and the worker snapshot', () => {
    const s = game(4);
    s.asteroids[0].ore = 0;
    s.asteroids[0].respawn = 60;
    warp(s, 1);
    const before = JSON.stringify(s.fields);
    s.miningIncomeAvg = 5;
    settleOffline(stateOf(s), 3600);
    expect(JSON.stringify(s.fields)).toBe(before);
    const copy = focused(structuredClone(stateOf(s)));
    warp(copy, 0);
    expect(copy.asteroids[0].ore).toBe(0);
  });
});
