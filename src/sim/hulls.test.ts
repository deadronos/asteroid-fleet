import { describe, expect, it } from 'vitest';
import { order, prestige } from './actions';
import { HULLS, HULL_IDS, WARP_CHARGE, warpCost } from './config';
import {
  jumpCost,
  maxEnergy,
  newGame,
  refineThroughput,
  bind,
  focusOp,
  unlockHulls,
} from './state';
import { stepSim } from './tick';
import { game } from './testing';

const withHull = (hullClass: (typeof HULL_IDS)[number], seed = 5) => {
  const g = newGame(seed, {
    research: 0,
    researchLevels: {},
    unlocked: [],
    unlockedRules: [],
    hulls: [...HULL_IDS],
    hullClass,
    discovered: [],
    lifetime: { prestiges: 1, researchEarned: 0 },
  });
  return bind(g, focusOp(g));
};

const regen = (id: 'standard' | 'bastion') => {
  const s = withHull(id);
  s.carrier.shield = 0.2;
  s.carrier.energy = 1000;
  for (let i = 0; i < 20; i++) stepSim(s);
  return s.carrier.shield - 0.2;
};

describe('hull classes (#65)', () => {
  it('standard matches the old carrier', () => {
    const s = game(1);
    expect(s.carrier.hullClass).toBe('standard');
    expect(s.carrier.maxHull).toBe(2000);
    expect(s.hangars.map((h) => [h.type, h.slots])).toEqual([
      ['launch', 6],
      ['cargo', 6],
    ]);
    expect(refineThroughput(s)).toBe(12);
    expect(jumpCost(s, 0, 1)).toBe(warpCost(0, 1));
    expect(s.hulls).toEqual(['standard']);
  });

  it('each hull sets the starting grid and stats', () => {
    for (const id of HULL_IDS) {
      const s = withHull(id);
      const d = HULLS[id];
      expect(s.carrier.maxHull).toBe(d.hull);
      expect(s.hangars.map((h) => h.type)).toEqual(d.start);
      expect(s.hangars.every((h) => h.slots === d.slots)).toBe(true);
      expect(maxEnergy(s)).toBeCloseTo(1000 * d.energy);
      expect(refineThroughput(s)).toBeCloseTo(12 * d.refinery);
      expect(jumpCost(s, 0, 2)).toBe(warpCost(0, 2, d.warpCost));
    }
  });

  it('warp charge time scales with the hull', () => {
    const s = withHull('light');
    s.carrier.energy = 1000;
    s.systems[1].discovered = true;
    expect(order(s, { type: 'warp', systemId: 1 })).toBeNull();
    expect(s.warp?.charge).toBeCloseTo(WARP_CHARGE * HULLS.light.warpCharge);
  });

  it('bastion regenerates shields faster than standard', () => {
    expect(regen('bastion')).toBeGreaterThan(regen('standard') * 1.5);
  });

  it('hangars bought later use the hull slot count', () => {
    const s = withHull('mining');
    s.credits = 1e9;
    expect(order(s, { type: 'buyHangar', hangarType: 'launch' })).toBeNull();
    expect(s.hangars.at(-1)!.slots).toBe(HULLS.mining.newSlots);
  });

  it('later hulls unlock only after the first prestige, by furthest tier', () => {
    const s = game(3);
    s.stats.furthestTier = 3;
    unlockHulls(s);
    expect(s.hulls).toEqual(['standard']);
    s.lifetime.prestiges = 1;
    s.stats.furthestTier = 2;
    unlockHulls(s);
    expect(s.hulls).toEqual(['standard', 'light', 'fleet']);
    s.stats.furthestTier = 3;
    unlockHulls(s);
    expect(s.hulls).toEqual([...HULL_IDS]);
  });

  it('prestige carries the chosen hull, and ignores one that is locked', () => {
    const g = newGame(3);
    g.hulls = ['standard', 'light'];
    expect(focusOp(prestige(g, 'light')).carrier.hullClass).toBe('light');
    expect(focusOp(prestige(g, 'bastion')).carrier.hullClass).toBe('standard');
    const light = prestige(g, 'light');
    expect(focusOp(prestige(light)).carrier.hullClass).toBe('light');
    expect(prestige(light).hulls).toEqual(['standard', 'light']);
  });
});
