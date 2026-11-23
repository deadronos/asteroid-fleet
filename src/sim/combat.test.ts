// Combat fidelity (#161): carrier facing, mount arcs, tracking vs evasion and pirate kinds.

import { describe, expect, it } from 'vitest';
import {
  carrierTurrets,
  fighter,
  hitChance,
  inFiringArc,
  pirateStep,
  pirateTargetScore,
  spawnWave,
} from './combat';
import { CARRIER_TURN_RATE, HEAVY_ARC, PIRATE_BASE, PIRATE_TYPES, TURRETS } from './config';
import { buildCtx } from './ctx';
import { shortestArc } from './math';
import { createShip } from './state';
import { game } from './testing';
import type { Pirate, PirateKind, Ship, Sim, Vec3 } from './types';
import { turnCarrier } from './world';

function addPirate(s: Sim, kind: PirateKind, pos: Vec3, hull = PIRATE_BASE.hull): Pirate {
  const p: Pirate = {
    id: s.nextId++,
    kind,
    pos,
    hull,
    maxHull: hull,
    damage: PIRATE_BASE.damage,
    speed: PIRATE_BASE.speed,
    targetId: -1,
    fireCooldown: 0,
  };
  s.pirates.push(p);
  return p;
}

function addShip(s: Sim, cls: Ship['cls'], pos: Vec3): Ship {
  s.hangars[0].slots = 20;
  const sh = createShip(s, cls, s.hangars[0].id)!;
  sh.mode = 'idle';
  sh.pos = pos;
  return sh;
}

function fighterDamageTo(kind: PirateKind): number {
  const s = game(7);
  const f = addShip(s, 'fighter', { x: 0, y: 0, z: 0 });
  const p = addPirate(s, kind, { x: 0, y: 0, z: 0 }, 300);
  fighter(s, f, 1, buildCtx(s), 'aggressive');
  return 300 - p.hull;
}

function pirateDamageTo(kind: PirateKind, cls: Ship['cls']): number {
  const s = game(7);
  // Keep the carrier out of the target choice: bombers would otherwise prefer it.
  s.carrier.pos = { x: 1000, y: 0, z: 0 };
  const target = addShip(s, cls, { x: 0, y: 0, z: 5 });
  const before = target.hull;
  const p = addPirate(s, kind, { x: 0, y: 0, z: 0 });
  p.targetId = target.id;
  pirateStep(s, 1, buildCtx(s));
  return before - target.hull;
}

function setSystem(s: Sim, tier: 2 | 3, distance: number) {
  s.systems[s.systemId].tier = tier;
  s.systems[s.systemId].distance = distance;
}

describe('carrier heading (#161)', () => {
  it('turns toward a travel target at no more than CARRIER_TURN_RATE per second', () => {
    const s = game(11);
    s.carrier.heading = 0;
    s.carrier.target = { x: 100, y: 0, z: 0 };
    turnCarrier(s, 0.1);
    expect(s.carrier.heading).toBeCloseTo(CARRIER_TURN_RATE * 0.1);
    for (let i = 0; i < 20; i++) turnCarrier(s, 0.1);
    expect(s.carrier.heading).toBeCloseTo(Math.PI / 2);
  });

  it('takes the short way round the wrap, not the long way', () => {
    const s = game(11);
    s.carrier.heading = 3;
    s.carrier.target = { x: 0, y: 0, z: -100 };
    const before = shortestArc(3, Math.PI);
    turnCarrier(s, 0.1);
    expect(shortestArc(s.carrier.heading, Math.PI)).toBeCloseTo(before - CARRIER_TURN_RATE * 0.1);
  });

  it('faces the toughest nearby pirate while holding position', () => {
    const s = game(11);
    s.carrier.heading = 0;
    s.carrier.target = null;
    addPirate(s, 'gunship', { x: 0, y: 0, z: 30 }, 30);
    addPirate(s, 'bomber', { x: 0, y: 0, z: -30 }, 500);
    turnCarrier(s, 0.1);
    // The bomber is behind the carrier, so the bounded step is toward -Z.
    expect(s.carrier.heading).toBeCloseTo(-CARRIER_TURN_RATE * 0.1);
  });

  it('ignores pirates too far away to threaten the hull', () => {
    const s = game(11);
    s.carrier.heading = 0;
    s.carrier.target = null;
    addPirate(s, 'bomber', { x: 0, y: 0, z: -1000 }, 500);
    turnCarrier(s, 0.1);
    expect(s.carrier.heading).toBe(0);
  });
});

describe('turret firing arcs (#161)', () => {
  const from: Vec3 = { x: 0, y: 0, z: 0 };

  it('point-defense covers every bearing while a heavy battery covers a cone', () => {
    const pd = { bearing: 0, arc: Math.PI };
    const heavy = { bearing: 0, arc: HEAVY_ARC };
    expect(inFiringArc(0, pd, from, { x: 0, y: 0, z: -10 })).toBe(true);
    expect(inFiringArc(0, heavy, from, { x: 0, y: 0, z: 10 })).toBe(true);
    expect(inFiringArc(0, heavy, from, { x: 0, y: 0, z: -10 })).toBe(false);
    expect(inFiringArc(0, heavy, from, { x: 10, y: 0, z: 0 })).toBe(false);
  });

  it('applies the mount bearing offset and the carrier heading', () => {
    const mount = { bearing: Math.PI / 2, arc: HEAVY_ARC };
    expect(inFiringArc(0, mount, from, { x: 10, y: 0, z: 0 })).toBe(true);
    expect(inFiringArc(0, mount, from, { x: 0, y: 0, z: 10 })).toBe(false);
    expect(inFiringArc(Math.PI, { bearing: 0, arc: HEAVY_ARC }, from, { x: 0, y: 0, z: -10 })).toBe(
      true,
    );
  });

  it('makes the Bastion heavy battery switch targets when the carrier turns', () => {
    const s = game(5);
    s.carrier.hullClass = 'bastion';
    s.carrier.pos = { x: 0, y: 0, z: 0 };
    const front = addPirate(s, 'gunship', { x: 0, y: 0, z: 20 }, 200);
    const back = addPirate(s, 'gunship', { x: 0, y: 0, z: -20 }, 300);
    const pd = 2 * TURRETS.pd.damage; // two all-around PD mounts
    const heavy = TURRETS.heavy.damage * 0.65;

    s.carrier.heading = 0;
    carrierTurrets(s, 1);
    expect(front.hull).toBeCloseTo(200 - pd - heavy);
    expect(back.hull).toBe(300);

    s.carrier.heading = Math.PI;
    carrierTurrets(s, 1);
    expect(back.hull).toBeCloseTo(300 - heavy);
    expect(front.hull).toBeCloseTo(200 - pd * 2 - heavy);
  });
});

describe('tracking and evasion (#161)', () => {
  it('clamps the hit chance and ranks tracking against evasion', () => {
    expect(hitChance(1, 0.45)).toBe(1);
    expect(hitChance(0, 10)).toBe(0.15);
    expect(hitChance(0.3, 0.45)).toBeCloseTo(0.35);
    expect(hitChance(0.3, 0)).toBeCloseTo(0.8);
    // PD reliably hits an interceptor; a heavy battery does not.
    expect(hitChance(TURRETS.pd.tracking, PIRATE_TYPES.interceptor.evasion)).toBe(1);
    expect(hitChance(TURRETS.heavy.tracking, PIRATE_TYPES.interceptor.evasion)).toBeLessThan(0.5);
    expect(hitChance(TURRETS.heavy.tracking, PIRATE_TYPES.bomber.evasion)).toBeGreaterThan(0.75);
  });

  it('scales fighter damage with the pirate kind it is shooting at', () => {
    const interceptor = fighterDamageTo('interceptor');
    const bomber = fighterDamageTo('bomber');
    expect(interceptor).toBeGreaterThan(0);
    expect(interceptor / bomber).toBeCloseTo(0.8, 2);
  });

  it('reduces pirate fire against agile fighters but not against slow barges', () => {
    const vsFighter = pirateDamageTo('bomber', 'fighter');
    const vsBarge = pirateDamageTo('bomber', 'barge');
    expect(vsFighter / vsBarge).toBeCloseTo(0.55 / 0.9, 2);
  });
});

describe('pirate waves and targeting (#161)', () => {
  it('composes deterministic waves, with bombers only in deeper systems', () => {
    const frontier = game(7);
    setSystem(frontier, 2, 1);
    spawnWave(frontier, 80);
    expect(frontier.pirates).toHaveLength(80);
    expect(frontier.pirates.every((p) => p.kind !== 'bomber')).toBe(true);
    expect(frontier.pirates.some((p) => p.kind === 'interceptor')).toBe(true);
    expect(frontier.pirates.some((p) => p.kind === 'gunship')).toBe(true);

    const mid = game(7);
    setSystem(mid, 2, 5);
    spawnWave(mid, 80);
    expect(mid.pirates.some((p) => p.kind === 'bomber')).toBe(true);

    const deep = game(7);
    setSystem(deep, 3, 6);
    spawnWave(deep, 80);
    expect(deep.pirates.some((p) => p.kind === 'bomber')).toBe(true);
    expect(deep.pirates.some((p) => p.kind === 'interceptor')).toBe(true);
    expect(deep.pirates.some((p) => p.kind === 'gunship')).toBe(true);
  });

  it('replays the same wave from the same seed', () => {
    const a = game(7);
    const b = game(7);
    setSystem(a, 3, 6);
    setSystem(b, 3, 6);
    spawnWave(a, 40);
    spawnWave(b, 40);
    expect(a.pirates.map((p) => p.kind)).toEqual(b.pirates.map((p) => p.kind));
  });

  it('gives interceptors speed, bombers hull and damage', () => {
    const s = game(7);
    setSystem(s, 3, 6);
    spawnWave(s, 120);
    const of = (kind: PirateKind) => s.pirates.find((p) => p.kind === kind)!;
    const interceptor = of('interceptor');
    const gunship = of('gunship');
    const bomber = of('bomber');
    expect(interceptor.speed).toBeGreaterThan(gunship.speed);
    expect(interceptor.hull).toBeLessThan(gunship.hull);
    expect(bomber.hull).toBeGreaterThan(gunship.hull);
    expect(bomber.speed).toBeLessThan(gunship.speed);
    expect(bomber.damage).toBeGreaterThan(gunship.damage);
  });

  it('sends interceptors after fighters and bombers after loaded barges', () => {
    const s = game(7);
    const fighterShip = addShip(s, 'fighter', { x: 20, y: 0, z: 0 });
    const barge = addShip(s, 'barge', { x: -20, y: 0, z: 0 });
    barge.cargo = 0;

    const interceptor = addPirate(s, 'interceptor', { x: 0, y: 0, z: 0 });
    pirateStep(s, 0.1, buildCtx(s));
    expect(interceptor.targetId).toBe(fighterShip.id);

    barge.cargo = 300;
    const bomber = addPirate(s, 'bomber', { x: 0, y: 0, z: 0 });
    pirateStep(s, 0.1, buildCtx(s));
    expect(bomber.targetId).toBe(barge.id);
  });

  it('never scores stowed ships as targets', () => {
    const s = game(7);
    const docked = addShip(s, 'drone', { x: 0, y: 0, z: 0 });
    docked.mode = 'docked';
    for (const kind of ['interceptor', 'gunship', 'bomber'] as const)
      expect(pirateTargetScore(s, docked, kind)).toBe(0);
  });
});
