import { describe, expect, it } from 'vitest';
import { order } from './actions';
import { H2_STORM_RADIUS, ZONE_RULE_UNLOCKS } from './config';
import { buildCtx } from './ctx';
import { pirateStep, pirateTargetScore } from './combat';
import { harvester } from './mining';
import { buyResearch, canBuyResearch, reserveDefs, RESEARCH } from './research';
import { createShip, enterSystem, gasGiantPos, h2Storm } from './state';
import { hazards } from './world';
import type { Sim, Ship } from './types';
import { game } from './testing';

const gasSystem = (s: Sim) => s.systems.findIndex((x) => x.gasGiant);
const deepSystem = (s: Sim) => s.systems.findIndex((x) => x.tier === 3);

const launch = (s: Sim, cls: Ship['cls'], x: number) => {
  if (!s.unlocked.includes(cls)) s.unlocked.push(cls);
  s.credits = 1e6;
  const sh = createShip(s, cls)!;
  sh.mode = 'idle';
  sh.pos = { x, y: 0, z: 0 };
  return sh;
};

describe('deep space unlocks', () => {
  it('gates the fabrication bay behind tier 3', () => {
    const s = game(3);
    s.credits = 1e6;
    expect(order(s, { type: 'buyHangar', hangarType: 'fabricator' })).toMatch(/deep space/i);
    enterSystem(s, deepSystem(s));
    expect(s.stats.furthestTier).toBe(3);
    expect(order(s, { type: 'buyHangar', hangarType: 'fabricator' })).toBeNull();
  });

  it('a fabrication bay shortens reserve rebuilds once, not per bay', () => {
    const s = game(3);
    s.researchLevels.reserveDrone = 1;
    const base = reserveDefs(s)[0][2];
    s.hangars[0].type = 'fabricator';
    expect(reserveDefs(s)[0][2]).toBeCloseTo(base * 0.6);
    s.hangars[1].type = 'fabricator';
    expect(reserveDefs(s)[0][2]).toBeCloseTo(base * 0.6);
  });

  it('unlocks the storm-shelter rule card in deep space', () => {
    const s = game(3);
    expect(s.unlockedRules).not.toContain('harvesterStormShelter');
    enterSystem(s, deepSystem(s));
    for (const id of ZONE_RULE_UNLOCKS[3]) expect(s.unlockedRules).toContain(id);
  });

  it('gates deep research behind furthest tier 3', () => {
    const deep = RESEARCH.filter((n) => n.tier === 3);
    expect(deep.length).toBeGreaterThan(0);
    const s = game(3);
    s.research = 100;
    s.researchLevels.reserveCd = 1;
    s.stats.furthestTier = 2;
    for (const n of deep) expect(canBuyResearch(s, n.id)).toBe(false);
    s.stats.furthestTier = 3;
    for (const n of deep) expect(buyResearch(s, n.id)).toBe(true);
  });
});

describe('gas giants', () => {
  it('pirates prefer harvesters only in gas giant systems', () => {
    const s = game(4);
    const hv = launch(s, 'harvester', 0);
    const hauler = launch(s, 'hauler', 0);
    expect(pirateTargetScore(s, hv)).toBe(pirateTargetScore(s, hauler));
    enterSystem(s, gasSystem(s));
    expect(pirateTargetScore(s, hv)).toBeGreaterThan(pirateTargetScore(s, hauler));
  });

  it('a pirate picks the harvester over an equally close hauler', () => {
    const s = game(4);
    enterSystem(s, gasSystem(s));
    const hv = launch(s, 'harvester', 40);
    launch(s, 'hauler', -40);
    s.pirates.push({
      id: s.nextId++,
      pos: { x: 0, y: 0, z: 60 },
      hull: 50,
      maxHull: 50,
      damage: 1,
      speed: 9,
      targetId: -1,
      fireCooldown: 0,
    });
    pirateStep(s, 0.1, buildCtx(s));
    expect(s.pirates[0].targetId).toBe(hv.id);
  });

  it('H2 storms hurt ships near the gas giant and boost harvesting', () => {
    const s = game(4);
    enterSystem(s, gasSystem(s));
    expect(Number.isFinite(s.storm.timer)).toBe(true);
    s.researchLevels.fusion = 1;
    const g = gasGiantPos(s.systems[s.systemId]);
    const hv = launch(s, 'harvester', 0);
    hv.pos = { x: g.x + 20, y: g.y, z: g.z };
    const calm = launch(s, 'harvester', 0);
    calm.pos = { ...hv.pos };
    harvester(s, calm, 1, buildCtx(s));
    s.storm.active = 10;
    expect(h2Storm(s)).toBe(true);
    harvester(s, hv, 1, buildCtx(s));
    expect(hv.h2).toBeCloseTo(calm.h2 * 2);
    const hull = hv.hull;
    hazards(s, 1);
    expect(hv.hull).toBeLessThan(hull);
    expect(H2_STORM_RADIUS).toBeGreaterThan(20);
  });

  it('the shelter rule sends harvesters home during an H2 storm', () => {
    const s = game(4);
    enterSystem(s, deepSystem(s));
    enterSystem(s, gasSystem(s));
    s.cards.find((c) => c.preset === 'harvesterStormShelter')!.enabled = true;
    s.researchLevels.fusion = 1;
    const g = gasGiantPos(s.systems[s.systemId]);
    const hv = launch(s, 'harvester', 0);
    hv.pos = { x: g.x + 20, y: g.y, z: g.z };
    hv.h2 = 5;
    s.storm.active = 10;
    harvester(s, hv, 0.1, buildCtx(s));
    expect(hv.mode).toBe('toCarrier');
  });
});
