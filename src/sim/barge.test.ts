import { describe, expect, it } from 'vitest';
import { order } from './actions';
import { cargoCap } from './ctx';
import { CONTAINER_TTL } from './mining';
import { stepSim } from './tick';
import type { Sim, Ship } from './types';
import { game } from './testing';

const run = (s: Sim, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) stepSim(s);
};

function bargeGame(seed: number, bay: boolean) {
  const s = game(seed);
  s.credits = 10000;
  if (bay) s.researchLevels.bargeBay = 1;
  expect(order(s, { type: 'buyShip', cls: 'barge', hangarId: 2 })).toBeNull();
  // Launch the barge before the hangar's drones, so one boards its bay.
  expect(order(s, { type: 'buyShip', cls: 'drone', hangarId: 2 })).toBeNull();
  s.hangars[1].launchOrder = ['barge', 'drone'];
  return s;
}

describe('barge drone bay', () => {
  it('launches a drone from the barge once it is on station', () => {
    const s = bargeGame(11, true);
    const barge = s.ships.find((x) => x.cls === 'barge')!;
    let boarded: Ship | undefined;
    let launchedAt: { x: number; z: number } | null = null;
    for (let i = 0; i < 2000 && !launchedAt; i++) {
      stepSim(s);
      boarded ??= s.ships.find((x) => x.mode === 'carried');
      if (boarded && boarded.mode !== 'carried' && barge.mode === 'station')
        launchedAt = { x: boarded.pos.x, z: boarded.pos.z };
    }
    expect(boarded?.bargeId).toBe(barge.id);
    expect(launchedAt).not.toBeNull();
    // It left from the barge, far from the carrier.
    expect(Math.hypot(launchedAt!.x - barge.pos.x, launchedAt!.z - barge.pos.z)).toBeLessThan(3);
    expect(
      Math.hypot(barge.pos.x - s.carrier.pos.x, barge.pos.z - s.carrier.pos.z),
    ).toBeGreaterThan(10);
  });

  it('bay drones unload into and dock at their barge, and come home with it', () => {
    const s = bargeGame(12, true);
    run(s, 120);
    const barge = s.ships.find((x) => x.cls === 'barge')!;
    const bayDrone = s.ships.find((x) => x.bargeId === barge.id)!;
    expect(bayDrone).toBeDefined();
    expect(barge.cargo).toBeGreaterThan(0);
    // No rocks left: the drone docks in the bay instead of flying to the carrier.
    for (const a of s.asteroids) a.ore = 0;
    for (let i = 0; i < 600 && bayDrone.mode !== 'carried'; i++) stepSim(s);
    expect(bayDrone.mode).toBe('carried');
    // Sent home, the barge carries the drone back and docks with it.
    barge.mode = 'retreat';
    for (let i = 0; i < 1200 && (barge.mode as string) !== 'docked'; i++) stepSim(s);
    expect(barge.mode).toBe('docked');
    // The drone notices on its next update, which can be a tick or two later.
    for (let i = 0; i < 5 && bayDrone.mode === 'carried'; i++) stepSim(s);
    expect(bayDrone.mode).toBe('docked');
    expect(bayDrone.bargeId).toBe(-1);
  });

  it('without the research, barges carry no drones', () => {
    const s = bargeGame(11, false);
    run(s, 120);
    expect(s.ships.some((x) => x.mode === 'carried' || x.bargeId >= 0)).toBe(false);
  });
});

function wreck(seed: number) {
  const s = game(seed);
  s.credits = 10000;
  order(s, { type: 'buyShip', cls: 'barge', hangarId: 2 });
  const barge = s.ships.find((x) => x.cls === 'barge')!;
  barge.mode = 'station';
  barge.pos = { x: 30, y: 0, z: 30 };
  barge.station = { ...barge.pos };
  barge.cargo = 200;
  barge.cargoValue = 1000;
  barge.hull = 0;
  stepSim(s);
  return s;
}

describe('salvage containers', () => {
  it('a destroyed barge drops part of its cargo as a container', () => {
    const s = wreck(21);
    expect(s.ships.some((x) => x.cls === 'barge')).toBe(false);
    expect(s.containers).toHaveLength(1);
    expect(s.containers[0].cargo).toBeCloseTo(100);
    expect(s.containers[0].cargoValue).toBeCloseTo(500);
  });

  it('decays when nobody salvages it', () => {
    const s = wreck(22);
    run(s, CONTAINER_TTL - 5);
    expect(s.containers).toHaveLength(1);
    run(s, 10);
    expect(s.containers).toHaveLength(0);
  });

  it('haulers salvage it and deliver the ore to the carrier', () => {
    const s = wreck(23);
    order(s, { type: 'buyShip', cls: 'hauler' });
    const before = s.stats.oreValueDelivered;
    let picked = false;
    for (let i = 0; i < 900 && s.containers.length; i++) {
      stepSim(s);
      picked ||= s.ships.some((x) => x.cls === 'hauler' && x.mode === 'toDropoff');
    }
    expect(picked).toBe(true);
    expect(s.containers).toHaveLength(0);
    run(s, 60);
    expect(s.stats.oreValueDelivered - before).toBeGreaterThan(400);
  });
});

describe('pirate targeting', () => {
  it('still goes for the fullest barge first', () => {
    const s = game(31);
    s.credits = 10000;
    s.researchLevels.bargeBay = 1;
    s.hangars[0].slots = 12;
    expect(order(s, { type: 'buyShip', cls: 'barge', hangarId: 2 })).toBeNull();
    expect(order(s, { type: 'buyShip', cls: 'barge', hangarId: 1 })).toBeNull();
    const [empty, full] = s.ships.filter((x) => x.cls === 'barge');
    for (const [b, x] of [
      [empty, 20],
      [full, -20],
    ] as const) {
      b.mode = 'station';
      b.pos = { x, y: 0, z: 20 };
      b.station = { ...b.pos };
    }
    full.cargo = cargoCap(s, 'barge');
    full.cargoValue = full.cargo * 3;
    s.pirates.push({
      id: s.nextId++,
      pos: { x: 0, y: 0, z: 25 },
      hull: 100,
      maxHull: 100,
      damage: 0,
      speed: 5,
      targetId: -1,
      fireCooldown: 0,
    });
    stepSim(s);
    expect(s.pirates[0].targetId).toBe(full.id);
  });
});
