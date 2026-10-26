import { describe, expect, it } from 'vitest';
import { order } from './actions';
import {
  COMPRESSOR_CARGO,
  DRILL_VALUE,
  LASER_DAMAGE,
  LASER_RATE,
  MODULES,
  SHIELD_TAKEN,
  SHIP_STATS,
  TRACTOR_SPEED,
  VEIN_BONUS,
} from './config';
import { buildCtx, cargoCap, damageShip, fighterDamage, miningRate, speed } from './ctx';
import { clusterCenters, createShip, enterSystem } from './state';
import { stepSim } from './tick';
import type { Sim, ModuleId, Ship, ShipClass } from './types';
import { game } from './testing';

const run = (s: Sim, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) stepSim(s);
};

function shipWith(cls: ShipClass, modules: ModuleId[] = []): { s: Sim; ship: Ship } {
  const s = game(5);
  s.stats.furthestTier = 2;
  s.unlocked.push('fighter', 'repair', 'harvester');
  s.credits = 100_000;
  const ship = createShip(s, cls, 2)!;
  modules.forEach((m, slot) => {
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot, module: m })).toBeNull();
  });
  return { s, ship };
}

function mineOnce(mods: ModuleId[]) {
  const { s, ship } = shipWith('drone', mods);
  const a = s.asteroids[0];
  ship.mode = 'mining';
  ship.targetId = a.id;
  ship.pos = { ...a.pos };
  for (const o of s.ships) if (o !== ship) o.mode = 'docked';
  stepSim(s);
  return { ore: ship.cargo, value: ship.cargoValue, unit: a.value };
}

function scoutGame(systemTier: 1 | 2) {
  const s = game(7);
  s.credits = 10_000;
  if (systemTier === 2) {
    const id = s.systems.findIndex((x) => x.tier === 2);
    enterSystem(s, id);
  }
  expect(order(s, { type: 'buyShip', cls: 'scout', hangarId: 1 })).toBeNull();
  return s;
}

function greedySetup(charted: boolean) {
  const s = game(3);
  s.doctrine.byClass.drone = { mining: 'greedy' };
  for (const o of s.ships) o.mode = 'docked';
  const drone = s.ships[0];
  drone.mode = 'idle';
  drone.pos = { x: 0, y: 0, z: 0 };
  s.asteroids = s.asteroids.slice(0, 2);
  const [rich, poor] = s.asteroids;
  rich.pos = { x: 10, y: 0, z: 0 };
  poor.pos = { x: -10, y: 0, z: 0 };
  rich.value = 4;
  poor.value = 1;
  rich.ore = poor.ore = 50;
  s.hazards = [{ pos: { ...rich.pos }, radius: 5, dps: 1, kind: 'debris' }];
  s.recon.hazards = charted ? [0] : [];
  stepSim(s);
  return { drone, rich, poor };
}

describe('fitting modules', () => {
  it('charges the module cost and respects slot counts', () => {
    const { s, ship } = shipWith('drone');
    const before = s.credits;
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot: 0, module: 'laser' })).toBeNull();
    expect(s.credits).toBe(before - MODULES.laser.cost);
    expect(ship.modules).toEqual(['laser']);
    // Drones have one slot.
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot: 1, module: 'drill' })).toBe(
      'No such module slot',
    );
    // Swapping replaces; unfitting clears.
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot: 0, module: 'drill' })).toBeNull();
    expect(ship.modules).toEqual(['drill']);
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot: 0, module: null })).toBeNull();
    expect(ship.modules).toEqual([]);
  });

  it('rejects modules that do not fit the class, are locked, or for ships in space', () => {
    const { s, ship } = shipWith('scout');
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot: 0, module: 'drill' })).toMatch(
      /does not fit/,
    );
    s.stats.furthestTier = 1;
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot: 0, module: 'shield' })).toMatch(
      /frontier/,
    );
    ship.mode = 'idle';
    expect(order(s, { type: 'fitModule', shipId: ship.id, slot: 0, module: 'tractor' })).toBe(
      'Ship must be docked',
    );
  });
});

describe('module effects', () => {
  it('laser raises mining rate', () => {
    const plain = shipWith('drone');
    const fitted = shipWith('drone', ['laser']);
    const base = miningRate(plain.s, buildCtx(plain.s), plain.ship);
    expect(miningRate(fitted.s, buildCtx(fitted.s), fitted.ship)).toBeCloseTo(base * LASER_RATE);
  });

  it('laser raises fighter damage', () => {
    const plain = shipWith('fighter');
    const fitted = shipWith('fighter', ['laser', 'laser']);
    const base = fighterDamage(plain.s, buildCtx(plain.s), plain.ship);
    expect(fighterDamage(fitted.s, buildCtx(fitted.s), fitted.ship)).toBeCloseTo(
      base * LASER_DAMAGE ** 2,
    );
  });

  it('drill raises the value of mined ore', () => {
    const plain = mineOnce([]);
    const drilled = mineOnce(['drill']);
    expect(drilled.ore).toBeCloseTo(plain.ore);
    expect(drilled.value).toBeCloseTo(plain.ore * plain.unit * DRILL_VALUE);
  });

  it('tractor beam raises speed', () => {
    const plain = shipWith('hauler');
    const fitted = shipWith('hauler', ['tractor']);
    expect(speed(fitted.s, fitted.ship)).toBeCloseTo(speed(plain.s, plain.ship) * TRACTOR_SPEED);
  });

  it('shield cuts damage taken', () => {
    const { s, ship } = shipWith('barge', ['shield']);
    const before = ship.hull;
    damageShip(s, ship, 100);
    expect(before - ship.hull).toBeCloseTo(100 * SHIELD_TAKEN);
  });

  it('compressor raises cargo capacity, per ship', () => {
    const plain = shipWith('barge');
    const fitted = shipWith('barge', ['compressor']);
    expect(cargoCap(plain.s, 'barge', plain.ship)).toBe(SHIP_STATS.barge.cargo);
    expect(cargoCap(fitted.s, 'barge', fitted.ship)).toBeCloseTo(
      SHIP_STATS.barge.cargo * COMPRESSOR_CARGO,
    );
    // A compressed drone fills more before heading home.
    const { s, ship } = shipWith('drone', ['compressor']);
    run(s, 60);
    expect(Math.max(...s.ships.filter((x) => x.cls === 'drone').map((x) => x.cargo))).toBeLessThan(
      cargoCap(s, 'drone', ship) + 1e-6,
    );
  });
});

describe('scout reconnaissance', () => {
  it('surveys clusters and marks rich asteroids as veins', () => {
    const s = scoutGame(1);
    run(s, 120);
    expect(s.recon.clusters.length).toBeGreaterThan(0);
    expect(s.recon.veins.length).toBeGreaterThan(0);
    const max = Math.max(...s.asteroids.map((a) => a.value));
    const veins = s.asteroids.filter((a) => s.recon.veins.includes(a.id));
    expect(veins.length).toBeGreaterThan(0);
    for (const a of veins) expect(a.value).toBeGreaterThanOrEqual(max * 0.5);
  });

  it('charts hazards it flies near', () => {
    const s = scoutGame(2);
    expect(s.hazards.length).toBeGreaterThan(0);
    run(s, 240);
    expect(s.recon.hazards.length).toBeGreaterThan(0);
    for (const i of s.recon.hazards) expect(s.hazards[i]).toBeDefined();
  });

  it('drones prefer revealed veins', () => {
    // Two equally distant rocks; the vein wins.
    const s = game(3);
    for (const o of s.ships) o.mode = 'docked';
    const drone = s.ships[0];
    drone.mode = 'idle';
    drone.pos = { x: 0, y: 0, z: 0 };
    s.asteroids = s.asteroids.slice(0, 2);
    const [a, b] = s.asteroids;
    a.pos = { x: 10, y: 0, z: 0 };
    b.pos = { x: -10, y: 0, z: 0 };
    a.value = b.value = 2;
    a.ore = b.ore = 50;
    s.recon.veins = [b.id];
    stepSim(s);
    expect(drone.targetId).toBe(b.id);
    expect(VEIN_BONUS).toBeGreaterThan(1);
  });

  it('greedy drones avoid charted hazards but not uncharted ones', () => {
    const blind = greedySetup(false);
    expect(blind.drone.targetId).toBe(blind.rich.id);
    const scouted = greedySetup(true);
    expect(scouted.drone.targetId).toBe(scouted.poor.id);
  });

  it('forgets everything on a jump', () => {
    const s = scoutGame(1);
    run(s, 120);
    expect(s.recon.clusters.length).toBeGreaterThan(0);
    enterSystem(s, 1);
    expect(s.recon).toEqual({ clusters: [], veins: [], hazards: [] });
    expect(clusterCenters(s.systems[1]).length).toBeGreaterThan(0);
  });
});
