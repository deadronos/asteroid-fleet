import { describe, expect, it } from 'vitest';
import {
  RETURN_GRACE_S,
  bottleneckYield,
  dematerialise,
  lossBuffer,
  materialise,
  runBackground,
  stepBackground,
} from './background';
import { order, settleOffline } from './actions';
import { newGame, bind, stateOf } from './state';
import { stepOp, stepSim } from './tick';
import { game } from './testing';
import type { Sim } from './types';

/** A fresh game moved to a dangerous system, with fighters out and a fighter reserve. */
function frontier(seed = 7): Sim {
  const s = game(seed);
  s.systems[s.systemId].tier = 3;
  s.wave.timer = 60;
  s.unlocked.push('fighter');
  s.researchLevels.reserveFighter = 1;
  s.credits = 5000;
  for (let i = 0; i < 3; i++) order(s, { type: 'buyShip', cls: 'fighter' });
  s.credits = 0;
  for (const x of s.ships) if (x.cls === 'fighter') x.mode = 'idle';
  s.miningIncomeAvg = 4;
  return s;
}

const snapshot = (s: Sim) => JSON.stringify({ ...stateOf(s), events: [], log: [], savedAt: 0 });

function roundTrip(): string {
  const s = frontier(11);
  for (let i = 0; i < 200; i++) stepSim(s);
  dematerialise(s);
  runBackground(s, 900);
  materialise(s);
  for (let i = 0; i < 200; i++) stepSim(s);
  return snapshot(s);
}

describe('background model', () => {
  it('is deterministic for the same state', () => {
    const a = frontier();
    const b = frontier();
    runBackground(a, 3600);
    runBackground(b, 3600);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('does not depend on other operations being stepped', () => {
    const g = newGame(7);
    const solo = bind(g, g.ops[0]);
    const twin = structuredClone(g);
    // A second operation in the twin run, stepped in between, must not change the first.
    const other = structuredClone(twin.ops[0]);
    other.id = 99;
    twin.ops.push(other);
    const a = solo;
    const b = bind(twin, twin.ops[0]);
    for (const s of [a, b]) {
      s.systems[s.systemId].tier = 3;
      s.wave.timer = 60;
    }
    for (let i = 0; i < 600; i++) {
      stepBackground(a);
      stepBackground(b);
      stepBackground(bind(twin, other));
    }
    expect(JSON.stringify(g.ops[0])).toBe(JSON.stringify(twin.ops[0]));
  });

  it('pays the bottleneck yield', () => {
    const s = game(9);
    s.miningIncomeAvg = 10;
    s.carrier.ore = 0;
    expect(bottleneckYield(s)).toBe(10);
    // A full hold of cheap ore caps the yield at what the refinery can turn into credits.
    s.carrier.ore = 100;
    s.carrier.oreValue = 1;
    expect(bottleneckYield(s)).toBeLessThan(10);
    const before = s.credits;
    runBackground(s, 10);
    expect(s.credits - before).toBeCloseTo(bottleneckYield(s) * 10);
  });

  it('takes wave losses only from the loss buffer, never a barge or the carrier', () => {
    const s = frontier(3);
    s.researchLevels.reserveBarge = 1;
    order(s, { type: 'buyShip', cls: 'barge' });
    const barges = s.ships.filter((x) => x.cls === 'barge').length;
    const hull = s.carrier.hull;
    let lost = 0;
    for (let i = 0; i < 4 * 3600; i++) {
      const buffer = lossBuffer(s);
      const r = stepBackground(s);
      expect(r.lost).toBeLessThanOrEqual(buffer);
      lost += r.lost;
    }
    expect(lost).toBeGreaterThan(0);
    expect(s.ships.filter((x) => x.cls === 'barge').length).toBeGreaterThanOrEqual(barges);
    expect(s.carrier.hull).toBe(hull);
  });

  it('loses nothing when there is no loss buffer', () => {
    const s = game(4);
    s.systems[s.systemId].tier = 3;
    s.wave.timer = 60;
    expect(lossBuffer(s)).toBe(0);
    const n = s.ships.length;
    expect(runBackground(s, 3600).lost).toBe(0);
    expect(s.ships.length).toBe(n);
  });
});

describe('Tier A / Tier B handover', () => {
  it('dematerialise drops map-only state and keeps the fleet', () => {
    const s = frontier();
    for (let i = 0; i < 300; i++) stepSim(s);
    const ids = s.ships.map((x) => x.id);
    dematerialise(s);
    expect(s.pirates).toEqual([]);
    expect(s.fx).toEqual([]);
    expect(s.containers).toEqual([]);
    expect(s.wave.active).toBe(false);
    expect(s.ships.map((x) => x.id)).toEqual(ids);
  });

  it('materialise puts launched ships back by the carrier and Tier A carries on', () => {
    const s = frontier();
    for (let i = 0; i < 300; i++) stepSim(s);
    dematerialise(s);
    runBackground(s, 120);
    materialise(s);
    for (const x of s.ships) {
      if (x.mode === 'docked' || x.mode === 'carried') continue;
      expect(x.mode).toBe('idle');
      expect(Math.hypot(x.pos.x - s.carrier.pos.x, x.pos.z - s.carrier.pos.z)).toBeLessThan(10);
    }
    expect(() => {
      for (let i = 0; i < 300; i++) stepOp(s);
    }).not.toThrow();
  });

  it('a round trip is deterministic', () => {
    expect(roundTrip()).toBe(roundTrip());
  });
});

describe('Tier C', () => {
  it('an 8 h settle on the frontier leaves no fx, no ShipLost and a grace period', () => {
    const s = frontier(5);
    const g = stateOf(s);
    g.events.length = 0;
    const lostBefore = s.stats.shipsLost;
    const t0 = performance.now();
    settleOffline(g, 8 * 3600);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(s.stats.shipsLost).toBeGreaterThan(lostBefore);
    expect(s.fx).toEqual([]);
    expect(g.events.some((e) => e.kind === 'ShipLost')).toBe(false);
    expect(s.wave.timer).toBeGreaterThanOrEqual(RETURN_GRACE_S);
    expect(s.wave.warning).toBe(false);
  });
});
