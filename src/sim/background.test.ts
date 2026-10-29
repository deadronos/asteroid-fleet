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
import { mulberry } from './math';
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

/** Advance the op rng the way `rand` does, `n` times. */
function rollRng(rng: number, n: number): number {
  for (let i = 0; i < n; i++) rng = mulberry(rng)[1];
  return rng;
}

/** One pirate. `hull` 0 is already dead and must not be part of a handover roll. */
function pushPirate(s: Sim, hull = 40) {
  s.pirates.push({
    id: s.nextId++,
    pos: { x: 80, y: 0, z: 0 },
    hull,
    maxHull: 45,
    damage: 5,
    speed: 9,
    targetId: -1,
    fireCooldown: 0,
  });
}

/**
 * Frontier fleet with a fight still on the map. `wave.size` is deliberately not the
 * number of living pirates: the handover must roll who is left, not the scheduled wave.
 */
function underAttack(living = 6, seed = 7): Sim {
  const s = frontier(seed);
  s.wave.active = true;
  s.wave.warning = false;
  s.wave.size = 40;
  s.wave.timer = 80;
  for (let i = 0; i < living; i++) pushPirate(s);
  pushPirate(s, 0);
  return s;
}

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

  it('resolves an active wave instead of deleting it', () => {
    const s = underAttack();
    const living = s.pirates.filter((p) => p.hull > 0).length;
    const rng = s.rng;
    const kills = s.stats.piratesKilled;
    const lost = s.stats.shipsLost;
    const fighters = s.ships.filter((x) => x.cls === 'fighter').length;
    const drones = s.ships.filter((x) => x.cls === 'drone').length;
    const hull = s.carrier.hull;
    dematerialise(s);

    const killed = s.stats.piratesKilled - kills;
    const shipsLost = s.stats.shipsLost - lost;
    expect(s.wave.active).toBe(false);
    expect(s.pirates).toEqual([]);
    expect(s.fx).toEqual([]);
    expect(s.wave.timer).toBe(80);
    expect(s.wave.size).toBe(40);
    expect(s.wave.warning).toBe(false);
    // One seeded roll per living pirate, not per `wave.size` and not per dead hull.
    expect(s.rng).toBe(rollRng(rng, living));
    expect(killed + shipsLost).toBeGreaterThan(0);
    expect(killed).toBeLessThanOrEqual(living);
    expect(shipsLost).toBeLessThanOrEqual(living);
    expect(s.ships.filter((x) => x.cls === 'fighter').length).toBe(fighters - shipsLost);
    expect(s.ships.filter((x) => x.cls === 'drone').length).toBe(drones);
    expect(s.carrier.hull).toBe(hull);
    const repelled = s.events.filter((e) => e.kind === 'WaveRepelled');
    expect(repelled).toHaveLength(1);
    expect(repelled[0].carrierId).toBe(s.id);
    expect(s.log.filter((e) => e.kind === 'WaveRepelled')).toHaveLength(1);
    const losses = s.events.filter((e) => e.kind === 'ShipLost');
    expect(losses).toHaveLength(shipsLost);
    expect(losses.every((e) => e.kind === 'ShipLost' && e.data.cause === 'destroyed')).toBe(true);

    const again = underAttack();
    dematerialise(again);
    expect(snapshot(again)).toBe(snapshot(s));
    expect(again.events).toEqual(s.events);
  });

  it('resolves an active wave without events when asked', () => {
    const s = underAttack();
    const events = s.events.length;
    const log = s.log.length;
    const lost = s.stats.shipsLost;
    const killed = s.stats.piratesKilled;
    dematerialise(s, { events: false });
    expect(s.wave.active).toBe(false);
    expect(s.pirates).toEqual([]);
    expect(s.stats.shipsLost).toBeGreaterThan(lost);
    expect(s.stats.piratesKilled).toBeGreaterThan(killed);
    expect(s.events).toHaveLength(events);
    expect(s.log).toHaveLength(log);
  });

  it('leaves a carrier with no active wave unchanged apart from the map', () => {
    const s = frontier();
    s.wave.warning = true;
    s.wave.timer = 12;
    s.wave.size = 4;
    pushPirate(s);
    s.fx.push({ kind: 'explosion', a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, ttl: 1 });
    const rng = s.rng;
    const ids = s.ships.map((x) => x.id);
    const stats = { ...s.stats };
    const wave = { ...s.wave };
    const events = s.events.length;
    const log = s.log.length;
    dematerialise(s);
    expect(s.rng).toBe(rng);
    expect(s.ships.map((x) => x.id)).toEqual(ids);
    expect(s.stats).toEqual(stats);
    expect(s.wave).toEqual(wave);
    expect(s.events).toHaveLength(events);
    expect(s.log).toHaveLength(log);
    expect(s.pirates).toEqual([]);
    expect(s.fx).toEqual([]);
    expect(s.containers).toEqual([]);
  });

  it('does not resolve the same wave again when focus returns and leaves', () => {
    const s = underAttack();
    dematerialise(s);
    const killed = s.stats.piratesKilled;
    const lost = s.stats.shipsLost;
    const ids = s.ships.map((x) => x.id);
    materialise(s);
    const rng = s.rng;
    dematerialise(s);
    // One handover roll, including after coming back to Tier A and leaving again.
    expect(s.events.filter((e) => e.kind === 'WaveRepelled')).toHaveLength(1);
    expect(s.stats.piratesKilled).toBe(killed);
    expect(s.stats.shipsLost).toBe(lost);
    expect(s.ships.map((x) => x.id)).toEqual(ids);
    expect(s.rng).toBe(rng);
    expect(killed + lost).toBeGreaterThan(0);
    expect(s.wave.active).toBe(false);
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
  it('emits the departure wave before WelcomeBack and settles deterministically', () => {
    const s = underAttack();
    const g = stateOf(s);
    g.events.length = 0;
    const lostBefore = s.stats.shipsLost;
    const other = structuredClone(g);
    settleOffline(g, 60);
    settleOffline(other, 60);

    const kinds = g.events.map((e) => e.kind);
    expect(kinds.at(-1)).toBe('WelcomeBack');
    expect(kinds.at(-2)).toBe('WaveRepelled');
    const shipLost = kinds.filter((k) => k === 'ShipLost');
    expect(shipLost.length).toBeGreaterThan(0);
    expect(shipLost.length).toBe(s.stats.shipsLost - lostBefore);
    expect(kinds.slice(0, -2).every((k) => k === 'ShipLost')).toBe(true);
    expect(kinds.filter((k) => k === 'WaveRepelled')).toHaveLength(1);

    expect(JSON.stringify({ ...g, savedAt: 0 })).toBe(JSON.stringify({ ...other, savedAt: 0 }));
  });

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
