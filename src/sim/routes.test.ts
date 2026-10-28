import { describe, expect, it } from 'vitest';
import { apply, settleOffline } from './actions';
import { migrate } from '../game/migrate';
import { createLocalHost } from '../game/localHost';
import type { OutMsg } from '../game/protocol';
import { MAX_ROUTES, ROUTE_RATES, interceptChance, routeChance, routeTick } from './routes';
import { addCarrier, bind, maxEnergy, newGame } from './state';
import { step } from './tick';
import { carrierStorage } from './hangar';
import type { GameState } from './types';

/** Two carriers, the second in `system`. */
function pair(system = 0, seed = 5): GameState {
  const g = newGame(seed);
  addCarrier(g);
  g.ops[1].systemId = system;
  return g;
}
const route = (
  g: GameState,
  resource: 'ore' | 'h2' | 'energy' = 'ore',
  rate = 5,
  from = 0,
  to = 1,
) => apply(g, { type: 'addRoute', carrierId: g.ops[from].id, to: g.ops[to].id, resource, rate });
const tick = (g: GameState, n: number) => {
  for (let i = 0; i < n; i++) step(g, g.ops[0]);
};

function h2Run(poke: boolean) {
  const g = pair(2);
  route(g, 'h2', 10);
  g.ops[0].carrier.h2 = 1e6;
  if (poke) g.ops[1].rng = 99; // another carrier's rng must not matter
  tick(g, 3000);
  return g.routes[0];
}
function farPair() {
  const g = pair(2);
  route(g, 'h2', 10);
  g.ops[0].carrier.h2 = 1e5;
  return g;
}
function settled() {
  const g = pair(0);
  route(g, 'h2', 1);
  g.ops[0].carrier.h2 = 1000;
  settleOffline(g, 3600);
  return g;
}

describe('supply routes (#80)', () => {
  it('validates routes', () => {
    const g = pair();
    expect(route(g)).toBeNull();
    expect(route(g)).toBe('Invalid route');
    expect(route(g, 'ore', 5, 0, 0)).toBe('Invalid route');
    expect(route(g, 'h2', 3)).toBe('Invalid route');
    expect(apply(g, { type: 'addRoute', carrierId: 0, to: 99, resource: 'ore', rate: 5 })).toBe(
      'Invalid route',
    );
    expect(apply(g, { type: 'removeRoute', carrierId: 0, routeId: 12345 })).toBe('No such route');
    for (const rate of ROUTE_RATES) route(g, 'energy', rate, 1, 0);
    expect(g.routes.length).toBe(2);
    route(g, 'h2', 1);
    route(g, 'h2', 1, 1, 0);
    route(g, 'ore', 1, 1, 0);
    route(g, 'energy', 1);
    expect(g.routes.length).toBe(MAX_ROUTES);
    addCarrier(g);
    expect(route(g, 'h2', 2, 0, 2)).toBe('Too many routes');
    const id = g.routes[0].id;
    expect(apply(g, { type: 'removeRoute', carrierId: 0, routeId: id })).toBeNull();
    expect(g.routes.some((r) => r.id === id)).toBe(false);
  });

  it('moves ore with its value, a second at a time, within stock and room', () => {
    const g = pair(0);
    route(g, 'ore', 5);
    const [a, b] = g.ops;
    a.carrier.ore = 12;
    a.carrier.oreValue = 120;
    b.carrier.ore = 0;
    b.carrier.oreValue = 0;
    tick(g, 9);
    expect(g.routes[0].moved).toBe(0); // not a full second yet
    // The refinery eats ore in the meantime, so check the route on its own from here.
    a.carrier.ore = 12;
    a.carrier.oreValue = 120;
    routeTick(g, 1);
    expect(a.carrier.ore).toBeCloseTo(7);
    expect(b.carrier.ore).toBeCloseTo(5);
    expect(b.carrier.oreValue).toBeCloseTo(50);
    expect(a.carrier.oreValue).toBeCloseTo(70);
    routeTick(g, 1);
    routeTick(g, 1);
    routeTick(g, 1);
    expect(a.carrier.ore).toBe(0);
    expect(a.carrier.oreValue).toBe(0);
    expect(b.carrier.ore).toBeCloseTo(12, 5);
  });

  it('stops at full storage and keeps the energy floor', () => {
    const g = pair(0);
    const [a, b] = g.ops;
    route(g, 'ore', 10);
    route(g, 'energy', 10);
    a.carrier.ore = 100;
    a.carrier.oreValue = 100;
    b.carrier.ore = carrierStorage(bind(g, b)) - 3;
    a.carrier.energy = maxEnergy(bind(g, a));
    b.carrier.energy = 0;
    const floor = maxEnergy(bind(g, a)) * 0.25;
    for (let i = 0; i < 100; i++) routeTick(g, 1);
    expect(b.carrier.ore).toBeCloseTo(carrierStorage(bind(g, b)));
    expect(a.carrier.ore).toBeCloseTo(97);
    expect(a.carrier.energy).toBeCloseTo(floor);
    expect(b.carrier.energy).toBeGreaterThan(0);
  });

  it('moves H2 and never moves credits', () => {
    const g = pair(0);
    route(g, 'h2', 2);
    g.ops[0].carrier.h2 = 10;
    const credits = g.credits;
    tick(g, 100);
    expect(g.ops[0].carrier.h2 + g.ops[1].carrier.h2).toBeCloseTo(10);
    expect(g.ops[1].carrier.h2).toBeGreaterThan(5);
    expect(g.credits).toBeGreaterThanOrEqual(credits);
  });

  it('intercepts only across systems, more with distance and tier', () => {
    const g = pair(0);
    const far = g.systems.find((s) => s.tier === 3)!;
    const mid = g.systems.find((s) => s.tier === 2)!;
    expect(interceptChance(g, 0, 0)).toBe(0);
    expect(interceptChance(g, 0, mid.id)).toBeGreaterThan(0);
    expect(interceptChance(g, 0, far.id)).toBeGreaterThan(interceptChance(g, 0, mid.id));
    expect(interceptChance(g, 0, far.id)).toBeLessThanOrEqual(0.5);

    const same = pair(0);
    route(same, 'h2', 10);
    same.ops[0].carrier.h2 = 1e6;
    tick(same, 600);
    expect(same.routes[0].lost).toBe(0);
    expect(same.routes[0].moved).toBeCloseTo(600, 3);

    const apart = pair(far.id);
    route(apart, 'h2', 10);
    apart.ops[0].carrier.h2 = 1e6;
    tick(apart, 6000);
    const r = apart.routes[0];
    expect(routeChance(apart, apart.ops, r)).toBe(interceptChance(apart, 0, far.id));
    expect(r.lost).toBeGreaterThan(0);
    expect(r.moved).toBeGreaterThan(0);
    const share = r.lost / (r.lost + r.moved);
    expect(share).toBeGreaterThan(routeChance(apart, apart.ops, r) * 0.5);
    expect(share).toBeLessThan(routeChance(apart, apart.ops, r) * 1.5);
    expect(apart.ops[1].carrier.h2).toBeCloseTo(r.moved, 3);
  });

  it('is deterministic, and independent of the carriers own rng', () => {
    const run = h2Run;
    expect(run(false)).toEqual(run(false));
    const a = run(false);
    const b = run(true);
    expect(b.moved).toBe(a.moved);
    expect(b.lost).toBe(a.lost);
  });

  it('works for a carrier in the background (Tier B), same as in the foreground', () => {
    const make = farPair;
    const out: OutMsg[] = [];
    const host = createLocalHost((m) => out.push(m));
    host.post({ t: 'init', state: make(), now: Date.now(), settle: false });
    host.runner.stop();
    host.runner.resetClock(0);
    for (let i = 1; i <= 600; i++) host.runner.pump(i * 100);
    const g = host.runner.state!;
    // The second carrier sits in another system, so it ran at Tier B all along.
    expect(g.ops[1].systemId).toBe(2);
    expect(g.routes[0].moved + g.routes[0].lost).toBeCloseTo(600, 3);
    const direct = make();
    tick(direct, 600);
    expect(g.routes[0].moved).toBe(direct.routes[0].moved);
    expect(g.routes[0].lost).toBe(direct.routes[0].lost);
    expect(g.ops[1].carrier.h2).toBeGreaterThan(0);
  });

  it('settles routes for whole seconds and drops the remainder (#185)', () => {
    const g = pair(0);
    route(g, 'h2', 1);
    g.ops[0].carrier.h2 = 1000;
    settleOffline(g, 40.9);
    expect(g.routes[0].moved).toBe(40);
  });

  it('keeps flowing while away (offline settlement)', () => {
    const make = settled;
    const g = make();
    expect(g.ops[1].carrier.h2).toBeGreaterThan(900);
    expect(g.ops[0].carrier.h2 + g.ops[1].carrier.h2).toBeCloseTo(1000 - g.routes[0].lost, 3);
    expect(make().routes).toEqual(g.routes);
  });

  it('survives a save round trip and carries on identically', () => {
    const g = pair(2);
    route(g, 'h2', 10);
    route(g, 'energy', 5, 1, 0);
    g.ops[0].carrier.h2 = 1e5;
    tick(g, 500);
    const r = migrate(JSON.parse(JSON.stringify(g)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.routes).toEqual(g.routes);
    tick(g, 500);
    tick(r.state, 500);
    expect(r.state.routes).toEqual(g.routes);
    expect(r.state.ops[1].carrier.h2).toBe(g.ops[1].carrier.h2);
  });

  it('drops saved routes that name a missing carrier', () => {
    const g = pair(0);
    route(g, 'h2', 1);
    const raw = JSON.parse(JSON.stringify(g));
    raw.routes[0].to = 999;
    const r = migrate(raw);
    expect(r.ok && r.state.routes).toEqual([]);
  });

  it('a new run has no routes', () => {
    expect(newGame(5).routes).toEqual([]);
  });
});
