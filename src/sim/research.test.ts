import { describe, expect, it } from 'vitest';
import { SHIP_STATS } from './config';
import { cargoCap, damageShip, speed } from './ctx';
import { RESEARCH, canBuyResearch, buyResearch } from './research';
import { SHIP_CLASSES } from './types';
import { createShip, maxHull, spawnAsteroid } from './state';
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
