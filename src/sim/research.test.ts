import { describe, expect, it } from 'vitest';
import { SHIP_STATS } from './config';
import { cargoCap, damageShip, speed } from './ctx';
import { RESEARCH, canBuyResearch, buyResearch, repeatEffect, softcap } from './research';
import { SHIP_CLASSES } from './types';
import { createShip, maxEnergy, maxHull, spawnAsteroid } from './state';
import { stepSim } from './tick';
import type { Sim } from './types';
import { game } from './testing';

const run = (s: Sim, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) stepSim(s);
};
const withLevel = (id: string, n = 1) => {
  const s = game(5);
  s.researchLevels[id] = n;
  return s;
};

const ship = (s: Sim, cls: (typeof SHIP_CLASSES)[number]) => {
  s.unlocked.push(cls);
  s.credits = 1e6;
  return s.ships.find((x) => x.cls === cls) ?? createShip(s, cls)!;
};

const value = (lv: number, roll: number) => {
  const s = withLevel('rare', lv);
  return spawnAsteroid(s, () => roll, { x: 20, y: 0, z: 0 }, s.systems[s.systemId]).value;
};

const dist = (lv: number) => {
  const s = withLevel('sublight', lv);
  s.carrier.target = { x: 500, y: 0, z: 0 };
  const x0 = s.carrier.pos.x;
  run(s, 10);
  return Math.abs(s.carrier.pos.x - x0) + Math.abs(s.carrier.pos.z);
};

describe('research tree', () => {
  it('gives every ship class at least 3 nodes and unique ids', () => {
    for (const c of SHIP_CLASSES) {
      expect(RESEARCH.filter((n) => n.branch === c).length).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(RESEARCH.map((n) => n.id)).size).toBe(RESEARCH.length);
  });

  it('gates harvester nodes behind fusion', () => {
    const s = game(1);
    s.research = 99;
    expect(canBuyResearch(s, 'harvestCargo')).toBe(false);
    expect(buyResearch(s, 'fusion')).toBe(true);
    expect(canBuyResearch(s, 'harvestCargo')).toBe(true);
  });

  it('scales speed, cargo, hull and damage per class', () => {
    for (const [id, cls] of [
      ['droneSpeed', 'drone'],
      ['bargeThrust', 'barge'],
      ['scoutSpeed', 'scout'],
      ['repairSpeed', 'repair'],
      ['harvestSpeed', 'harvester'],
    ] as const) {
      const s = withLevel(id, 2);
      const base = SHIP_STATS[cls].speed;
      expect(speed(s, ship(s, cls))).toBeGreaterThan(base);
    }
    expect(cargoCap(withLevel('haulerHold', 2), 'hauler')).toBeCloseTo(180 * 1.5);
    expect(cargoCap(withLevel('harvestCargo', 2), 'harvester')).toBeCloseTo(
      SHIP_STATS.harvester.cargo * 1.5,
    );
    expect(maxHull(withLevel('droneHull', 1), 'drone')).toBeCloseTo(20 * 1.3);
    expect(maxHull(withLevel('haulerHull', 1), 'hauler')).toBeCloseTo(90 * 1.4);
    expect(maxHull(withLevel('fighterHull', 2), 'fighter')).toBeCloseTo(60 * 1.5);
    expect(maxHull(withLevel('harvestHull', 1), 'harvester')).toBeCloseTo(
      SHIP_STATS.harvester.hull * 1.3,
    );
    const s = withLevel('bargeShell', 2);
    const b = ship(s, 'barge');
    const before = b.hull;
    damageShip(s, b, 10);
    expect(before - b.hull).toBeCloseTo(5);
  });

  it('rare ore chance makes some asteroids worth 2.5x', () => {
    expect(value(5, 0.1)).toBeCloseTo(value(0, 0.1) * 2.5); // 0.1 < 5 x 4 %
    expect(value(5, 0.5)).toBeCloseTo(value(0, 0.5)); // roll misses the 20 % chance
  });

  it('sublight drive moves the carrier faster', () => {
    expect(dist(4)).toBeGreaterThan(dist(0));
  });

  it('barge and hauler reserves rebuild lost ships', () => {
    for (const [id, cls] of [
      ['reserveBarge', 'barge'],
      ['reserveHauler', 'hauler'],
    ] as const) {
      const s = withLevel(id, 1);
      s.unlocked.push(cls);
      s.credits = 1e6;
      expect(s.ships.some((x) => x.cls === cls)).toBe(false);
      run(s, 600);
      expect(s.ships.some((x) => x.cls === cls)).toBe(true);
    }
  });
});

describe('repeatable research (#64)', () => {
  const REPEAT = RESEARCH.filter((n) => n.repeat);

  it('has yield, energy and launch sinks with geometric cost', () => {
    expect(REPEAT.map((n) => n.id).sort()).toEqual(['deepEnergy', 'deepLaunch', 'deepYield']);
    for (const n of REPEAT) {
      expect(n.maxLevel).toBe(Infinity);
      expect(n.cost(20) / n.cost(10)).toBeGreaterThan(5);
    }
  });

  it('effects diminish and never pass the cap', () => {
    const gains = [1, 2, 10, 11, 100].map((l) => softcap(l, 1));
    expect(gains[1] - gains[0]).toBeGreaterThan(gains[3] - gains[2]);
    expect(softcap(1000, 1)).toBeLessThanOrEqual(1);
    expect(softcap(0, 1)).toBe(0);
  });

  it('unlocks only once the base node is maxed, then buys past any old limit', () => {
    const s = game(5);
    s.research = 1e9;
    expect(canBuyResearch(s, 'deepYield')).toBe(false);
    s.researchLevels.yield = RESEARCH.find((n) => n.id === 'yield')!.maxLevel;
    for (let i = 0; i < 30; i++) expect(buyResearch(s, 'deepYield')).toBe(true);
    expect(s.researchLevels.deepYield).toBe(30);
    expect(repeatEffect(s, 'deepYield')).toBeGreaterThan(0.8);
  });

  it('raises energy capacity and has a readable label', () => {
    const s = game(5);
    const before = maxEnergy(s);
    s.researchLevels.deepEnergy = 10;
    expect(maxEnergy(s)).toBeCloseTo(before * (1 + softcap(10, 1)));
    const n = RESEARCH.find((r) => r.id === 'deepLaunch')!;
    expect(n.repeat!.label(softcap(10, n.repeat!.cap))).toMatch(/^−\d+\.\d % launch interval$/);
  });

  it('round-trips through JSON (no save-shape change)', () => {
    const s = withLevel('deepYield', 12);
    expect(JSON.parse(JSON.stringify(s.researchLevels)).deepYield).toBe(12);
  });
});
