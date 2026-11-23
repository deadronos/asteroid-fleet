import { describe, expect, it } from 'vitest';
import { order } from './actions';
import { pirateStep, pirateTargetScore, repairDrone } from './combat';
import { DT } from './config';
import { buildCtx, cargoCap } from './ctx';
import { CONTAINER_TTL } from './mining';
import { gasGiantPos, maxHull } from './state';
import { stepSim } from './tick';
import type { Sim, Ship } from './types';
import { game } from './testing';
import { hazards } from './world';

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
    // Hold launches so the barge does not immediately leave again with the drone still aboard.
    for (const h of s.hangars) h.launchTimer = 100;
    // The drone notices on its next update, which can be a tick or two later.
    for (let i = 0; i < 5 && bayDrone.mode === 'carried'; i++) stepSim(s);
    // The drone leaves the bay with the barge; it may already be relaunching on the next tick.
    expect(bayDrone.mode).not.toBe('carried');
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

describe('carried drone protection (#225)', () => {
  it('shields carried drones from pirate targeting, hazards/storms, and repair drones', () => {
    const s = bargeGame(41, true);
    s.unlocked.push('repair');
    expect(order(s, { type: 'buyShip', cls: 'repair', hangarId: 2 })).toBeNull();
    const barge = s.ships.find((x) => x.cls === 'barge')!;
    const drone = s.ships.find((x) => x.cls === 'drone')!;
    const repair = s.ships.find((x) => x.cls === 'repair')!;
    for (const x of s.ships) x.mode = 'docked';

    barge.mode = 'station';
    barge.pos = { x: 80, y: 0, z: 0 };
    drone.mode = 'carried';
    drone.bargeId = barge.id;
    drone.pos = { ...barge.pos };
    drone.hull = maxHull(s, 'drone') * 0.25;

    // Pirates score carried drones as 0 and drop them if they board mid-chase.
    expect(pirateTargetScore(s, drone)).toBe(0);
    s.pirates.push({
      id: s.nextId++,
      pos: { x: 81, y: 0, z: 0 },
      hull: 100,
      maxHull: 100,
      damage: 10,
      speed: 5,
      targetId: drone.id,
      fireCooldown: 0,
    });
    const hullBeforePirate = drone.hull;
    pirateStep(s, DT, buildCtx(s));
    expect(s.pirates[0].targetId).not.toBe(drone.id);
    expect(drone.hull).toBe(hullBeforePirate);

    // Hazards, solar storms, and H2 storms skip carried drones.
    s.hazards = [{ pos: { ...drone.pos }, radius: 20, dps: 50, kind: 'debris' }];
    s.storm = { timer: 100, active: 10 };
    const t2Plain = s.systems.find((sys) => sys.tier === 2 && !sys.gasGiant);
    if (t2Plain) s.systemId = t2Plain.id;
    const hullBeforeHazard = drone.hull;
    hazards(s, DT);
    expect(drone.hull).toBe(hullBeforeHazard);

    const t3Gas = s.systems.find((sys) => sys.gasGiant)!;
    expect(t3Gas).toBeDefined();
    s.systemId = t3Gas.id;
    drone.pos = { ...gasGiantPos(t3Gas) };
    hazards(s, DT);
    expect(drone.hull).toBe(hullBeforeHazard);

    // Repair drones neither target nor nano-heal carried drones.
    repair.mode = 'repairing';
    repair.pos = { ...barge.pos };
    repair.targetId = drone.id;
    drone.pos = { ...barge.pos };
    s.researchLevels.repairNano = 1;
    const hullBeforeRepair = drone.hull;
    repairDrone(s, repair, DT, buildCtx(s));
    expect(repair.targetId).toBe(-1);
    expect(drone.hull).toBe(hullBeforeRepair);

    // Even when nano-healing an adjacent damaged barge, the carried drone is untouched.
    barge.hull = maxHull(s, 'barge') * 0.5;
    const bargeBefore = barge.hull;
    repairDrone(s, repair, DT, buildCtx(s));
    expect(repair.targetId).toBe(barge.id);
    expect(barge.hull).toBeGreaterThan(bargeBefore);
    expect(drone.hull).toBe(hullBeforeRepair);
  });

  it('does not launch a docked repair drone for a damaged carried drone', () => {
    const s = bargeGame(42, true);
    s.unlocked.push('repair');
    expect(order(s, { type: 'buyShip', cls: 'repair', hangarId: 2 })).toBeNull();
    const barge = s.ships.find((x) => x.cls === 'barge')!;
    const drone = s.ships.find((x) => x.cls === 'drone')!;
    const repair = s.ships.find((x) => x.cls === 'repair')!;
    for (const x of s.ships) {
      x.mode = 'docked';
      x.hull = maxHull(s, x.cls);
    }
    barge.mode = 'station';
    barge.pos = { x: 40, y: 0, z: 0 };
    drone.mode = 'carried';
    drone.bargeId = barge.id;
    drone.pos = { ...barge.pos };
    drone.hull = maxHull(s, 'drone') * 0.25;
    // Keep only the repair drone in its hangar so launch priority is unambiguous.
    s.hangars[1].launchTimer = 0;
    s.hangars[1].items = s.hangars[1].items.filter((it) => it.shipId === repair.id);

    stepSim(s);
    expect(repair.mode).toBe('docked');
  });
});
