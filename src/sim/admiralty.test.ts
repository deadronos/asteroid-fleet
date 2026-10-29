import { describe, expect, it } from 'vitest';
import { admiralty, apply, marksPayout, prestige, researchPayout } from './actions';
import { admiraltyCost, admiraltyEffect, buyAdmiralty } from './admiralty';
import { newGame, spawnAsteroid } from './state';
import { game } from './testing';
import { migrate } from '../game/migrate';

function richGame() {
  const g = newGame(7);
  g.stats.oreValueDelivered = 4_000_000;
  g.stats.furthestTier = 2;
  g.research = 5;
  g.researchLevels = { yield: 3, autoRebuild: 1, autoBuy: 1, tactics: 1 };
  g.unlocked = ['harvester'];
  g.systems[1].discovered = true;
  g.credits = 9999;
  g.hulls = ['standard', 'bastion'];
  g.ops[0].carrier.hullClass = 'bastion';
  g.alerts = { fleet: {}, byCarrier: {} };
  return g;
}

describe('Admiralty shop (#69)', () => {
  it('costs grow geometrically and effects soft-cap', () => {
    const g = newGame(1);
    const c0 = admiraltyCost(g, 'admYield');
    g.admiralty.admYield = 5;
    expect(admiraltyCost(g, 'admYield')).toBeGreaterThan(c0 * 5);
    g.admiralty.admYield = 1000;
    expect(admiraltyEffect(g, 'admYield')).toBeLessThanOrEqual(1);
    expect(admiraltyEffect(g, 'admYield')).toBeGreaterThan(0.99);
    g.admiralty.admYield = 1;
    const e1 = admiraltyEffect(g, 'admYield');
    g.admiralty.admYield = 2;
    const e2 = admiraltyEffect(g, 'admYield');
    g.admiralty.admYield = 3;
    expect(admiraltyEffect(g, 'admYield') - e2).toBeLessThan(e2 - e1);
  });

  it('spends Marks, refuses when short, and ignores unknown ids', () => {
    const g = newGame(1);
    expect(buyAdmiralty(g, 'admYield')).toBe(false);
    expect(buyAdmiralty(g, 'nope')).toBe(false);
    g.marks = 10;
    expect(buyAdmiralty(g, 'admYield')).toBe(true);
    expect(g.marks).toBe(9);
    expect(g.admiralty.admYield).toBe(1);
    expect(apply(g, { type: 'buyAdmiralty', id: 'admEnergy', carrierId: g.ops[0].id })).toBeNull();
    expect(g.admiralty.admEnergy).toBe(1);
  });

  it('levels survive prestige and admiralty', () => {
    const g = richGame();
    g.lifetime.researchEarned = 200;
    g.admiralty = { admYield: 3, admCredits: 2 };
    expect(prestige(g).admiralty).toEqual({ admYield: 3, admCredits: 2 });
    const next = admiralty(g);
    expect(next.admiralty).toEqual({ admYield: 3, admCredits: 2 });
    expect(next.admiralty).not.toBe(g.admiralty);
    expect(next.credits).toBeGreaterThan(150);
  });

  it('migrates a v13 save with an empty shop', () => {
    const save = JSON.parse(JSON.stringify(newGame(3))) as Record<string, unknown>;
    delete save.admiralty;
    save.version = 13;
    const r = migrate(save);
    expect(r.ok && r.state.admiralty).toEqual({});
  });
});

describe('Prospecting Charter (#214)', () => {
  it('raises the ore value of new asteroids, not mining yield', () => {
    const s = game(4);
    const rock = () => spawnAsteroid(s, () => 0.5, { x: 20, y: 0, z: 0 }, s.systems[s.systemId]);
    const base = rock().value;
    s.admiralty.admYield = 3;
    expect(rock().value).toBeCloseTo(base * (1 + admiraltyEffect(s, 'admYield')));
  });
});

describe('Admiralty (#68)', () => {
  it('pays nothing for a fresh game', () => {
    expect(marksPayout(newGame())).toBe(0);
  });

  it('raises RP by 15 % per Mark ever earned', () => {
    const g = newGame(3);
    g.stats.oreValueDelivered = 1_000_000; // ⌊√100⌋ = 10
    g.stats.furthestTier = 2;
    expect(researchPayout(g)).toBe(20);
    g.lifetime.marksEarned = 4;
    expect(researchPayout(g)).toBe(32);
  });

  it('counts the run in progress toward lifetime RP', () => {
    const g = richGame();
    g.lifetime.researchEarned = 100;
    expect(marksPayout(g)).toBeGreaterThan(0);
  });

  it('resets research, RP and discovery; keeps automation, hulls and Marks', () => {
    const g = richGame();
    g.lifetime.researchEarned = 200;
    const marks = marksPayout(g);
    expect(marks).toBeGreaterThan(0);
    const next = admiralty(g);
    expect(next.marks).toBe(marks);
    expect(next.research).toBe(0);
    expect(next.researchLevels).toEqual({ autoRebuild: 1, autoBuy: 1, tactics: 1 });
    const known = (x: typeof next) => x.systems.filter((y) => y.discovered).length;
    expect(known(next)).toBe(known(newGame(next.seed)));
    expect(next.unlocked).toContain('harvester');
    expect(next.credits).toBe(150);
    expect(next.stats.oreValueDelivered).toBe(0);
    expect(next.lifetime.admiralties).toBe(1);
    expect(next.lifetime.marksEarned).toBe(marks);
    // The first Admiralty also unlocks the remaining hull classes (#70).
    expect(next.hulls).toEqual(expect.arrayContaining(g.hulls));
    expect(next.ops[0].carrier.hullClass).toBe(g.ops[0].carrier.hullClass);
    expect(next.alerts).toEqual(g.alerts);
    expect(next.log[0]?.kind).toBe('Admiralty');
  });

  it('pays only the increase on a second reset, and Marks survive prestige', () => {
    const next = admiralty(richGame());
    expect(marksPayout(next)).toBe(0);
    const again = prestige(next);
    expect(again.marks).toBe(next.marks);
    expect(again.lifetime.marksEarned).toBe(next.lifetime.marksEarned);
    expect(again.lifetime.admiralties).toBe(1);
    next.stats.oreValueDelivered = 400_000_000;
    next.stats.furthestTier = 3;
    expect(marksPayout(next)).toBeGreaterThan(0);
    const twice = admiralty(next);
    expect(twice.marks).toBe(next.marks + marksPayout(next));
  });

  it('round-trips through save and migrate', () => {
    const next = admiralty(richGame());
    const r = migrate(JSON.parse(JSON.stringify(next)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.marks).toBe(next.marks);
    expect(r.state.lifetime).toEqual(next.lifetime);
    expect(r.state.researchLevels).toEqual(next.researchLevels);
  });

  it('migrates a v12 save with zero Marks', () => {
    const v10 = JSON.parse(JSON.stringify(newGame()));
    v10.version = 12;
    delete v10.marks;
    v10.lifetime = { prestiges: 2, researchEarned: 9 };
    const r = migrate(v10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.marks).toBe(0);
    expect(r.state.lifetime).toEqual({
      prestiges: 2,
      researchEarned: 9,
      admiralties: 0,
      marksEarned: 0,
    });
  });
});
