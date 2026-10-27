import { describe, expect, it } from 'vitest';
import { admiralty, marksPayout, prestige } from './actions';
import { newGame } from './state';
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
  return g;
}

describe('Admiralty (#68)', () => {
  it('pays nothing for a fresh game', () => {
    expect(marksPayout(newGame())).toBe(0);
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
    expect(next.unlocked).toEqual(g.unlocked);
    expect(next.unlocked).toContain('harvester');
    expect(next.credits).toBe(150);
    expect(next.stats.oreValueDelivered).toBe(0);
    expect(next.lifetime.admiralties).toBe(1);
    expect(next.lifetime.marksEarned).toBe(marks);
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

  it('migrates a v10 save with zero Marks', () => {
    const v10 = JSON.parse(JSON.stringify(newGame()));
    v10.version = 10;
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
