import { describe, expect, it } from 'vitest';
import { admiralty, order, prestige, startChallenge } from './actions';
import { CHALLENGES, challengeProgress, hasModifier } from './modifiers';
import { focused, maxEnergy, newGame } from './state';
import { step, stepSim } from './tick';
import { game } from './testing';
import { migrate } from '../game/migrate';
import saveV14 from '../game/fixtures/save-v14.json';

function run(seed: number, mods: Parameters<typeof newGame>[1], ticks: number) {
  const g = newGame(seed, mods);
  for (let i = 0; i < ticks; i++) step(g, g.ops[0]);
  return g;
}

const snap = (g: ReturnType<typeof newGame>) =>
  JSON.stringify([g.credits, g.stats, g.ops[0].carrier.energy, g.ops[0].rng]);

const carry = (modifiers: ('noFighters' | 'halfEnergy' | 'deepSpace')[]) => ({
  research: 0,
  researchLevels: {},
  unlocked: [],
  unlockedRules: [],
  discovered: [],
  lifetime: { prestiges: 0, researchEarned: 0, admiralties: 0, marksEarned: 0 },
  modifiers,
});

describe('run modifiers (#71)', () => {
  it('a fresh game has none', () => {
    const g = newGame();
    expect(g.modifiers).toEqual([]);
    expect(g.challenge).toBeNull();
    expect(g.challengesDone).toEqual([]);
  });

  it('halfEnergy halves the pool', () => {
    const plain = focused(newGame(5));
    const half = focused(newGame(5, carry(['halfEnergy'])));
    expect(maxEnergy(half)).toBe(maxEnergy(plain) / 2);
    expect(half.carrier.energy).toBe(plain.carrier.energy / 2);
  });

  it('noFighters refuses to build fighters', () => {
    const s = focused(newGame(5, carry(['noFighters'])));
    s.unlocked.push('fighter');
    s.credits = 1e6;
    expect(order(s, { type: 'buyShip', cls: 'fighter' })).toMatch(/banned/);
    expect(s.ships.some((x) => x.cls === 'fighter')).toBe(false);
    const plain = game(5);
    plain.unlocked.push('fighter');
    plain.credits = 1e6;
    expect(order(plain, { type: 'buyShip', cls: 'fighter' })).toBeNull();
  });

  it('noFighters holds on every creation path: reserves, auto-buy and rebuilds', () => {
    const s = focused(newGame(5, carry(['noFighters'])));
    s.unlocked.push('fighter');
    s.credits = 1e6;
    s.researchLevels.reserveFighter = 2;
    s.researchLevels.autoBuy = 1;
    s.researchLevels.autoRebuild = 1;
    order(s, { type: 'setAutomation', patch: { autoBuy: true, autoRebuild: true } });
    order(s, { type: 'setHangarTarget', hangarId: 1, cls: 'fighter', count: 4 });
    s.automation.rebuildQueue.push({ cls: 'fighter', hangarId: 1 });
    for (let i = 0; i < 20_000; i++) stepSim(s);
    expect(s.ships.some((x) => x.cls === 'fighter')).toBe(false);
    expect(s.automation.rebuildQueue).toEqual([]);
    // The same setup without the modifier does build them.
    const plain = focused(newGame(5));
    plain.unlocked.push('fighter');
    plain.credits = 1e6;
    plain.researchLevels.reserveFighter = 2;
    for (let i = 0; i < 20_000; i++) stepSim(plain);
    expect(plain.ships.some((x) => x.cls === 'fighter')).toBe(true);
  });

  it('deepSpace starts in a tier-2 system', () => {
    const s = focused(newGame(5, carry(['deepSpace'])));
    expect(s.systems[s.systemId].tier).toBe(2);
    expect(s.stats.furthestTier).toBe(2);
  });

  it('changes the run deterministically: same seed and modifier repeat, a modifier diverges', () => {
    const a = run(11, carry(['halfEnergy']), 600);
    const b = run(11, carry(['halfEnergy']), 600);
    const plain = run(11, carry([]), 600);
    expect(snap(a)).toBe(snap(b));
    expect(snap(a)).not.toBe(snap(plain));
    expect(a.ops[0].carrier.energy).toBeLessThan(plain.ops[0].carrier.energy);
  });
});

describe('challenge runs (#71)', () => {
  it('startChallenge resets like a prestige and sets the modifiers', () => {
    const g = newGame(3);
    g.stats.oreValueDelivered = 5000;
    const next = startChallenge(g, 'pacifist')!;
    expect(next.challenge).toBe('pacifist');
    expect(next.modifiers).toEqual(CHALLENGES.pacifist.modifiers);
    expect(hasModifier(next, 'noFighters')).toBe(true);
    expect(next.stats.oreValueDelivered).toBe(0);
    expect(next.lifetime.prestiges).toBe(1);
    expect(next.log[0]?.kind).toBe('ChallengeStarted');
  });

  it('a plain prestige or Admiralty reset ends the modifiers', () => {
    const c = startChallenge(newGame(3), 'deepStart')!;
    expect(prestige(c).modifiers).toEqual([]);
    expect(prestige(c).challenge).toBeNull();
    expect(admiralty(c).modifiers).toEqual([]);
  });

  it('completing the goal pays Marks once and keeps a permanent bonus through resets', () => {
    const g = startChallenge(newGame(3), 'pacifist')!;
    const op = g.ops[0];
    expect(challengeProgress(g)).toBe(0);
    g.stats.oreValueDelivered = CHALLENGES.pacifist.goal;
    const marks = g.marks;
    step(g, op);
    expect(g.challenge).toBeNull();
    expect(g.challengesDone).toEqual(['pacifist']);
    expect(g.marks).toBe(marks + CHALLENGES.pacifist.marks);
    expect(g.log[0]?.kind).toBe('ChallengeComplete');
    step(g, op);
    expect(g.marks).toBe(marks + CHALLENGES.pacifist.marks);
    // The bonus survives both resets and raises ore value.
    const next = admiralty(prestige(g));
    expect(next.challengesDone).toEqual(['pacifist']);
    const base = focused(newGame(next.seed)).asteroids[0].value;
    expect(focused(next).asteroids[0].value).toBeCloseTo(
      base * (1 + CHALLENGES.pacifist.oreBonus),
      6,
    );
  });

  it('prestige and Admiralty reset keep both shop levels and completed challenges', () => {
    const g = newGame(3);
    g.admiralty = { admEnergy: 2 };
    g.challengesDone = ['lowPower'];
    for (const next of [prestige(g), admiralty(g)]) {
      expect(next.admiralty).toEqual({ admEnergy: 2 });
      expect(next.challengesDone).toEqual(['lowPower']);
    }
  });

  it('unknown challenge ids are ignored', () => {
    expect(startChallenge(newGame(), 'nope' as never)).toBeNull();
  });
});

describe('save v15 (#71)', () => {
  it('migrates a v14 fixture with no modifiers', () => {
    expect(saveV14.version).toBe(14);
    const r = migrate(saveV14);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.modifiers).toEqual([]);
    expect(r.state.challenge).toBeNull();
    expect(r.state.challengesDone).toEqual([]);
    for (let i = 0; i < 50; i++) step(r.state, r.state.ops[0]);
    expect(Number.isFinite(r.state.credits)).toBe(true);
  });

  it('round-trips an active challenge', () => {
    const g = startChallenge(newGame(3), 'lowPower')!;
    const r = migrate(JSON.parse(JSON.stringify(g)));
    expect(r.ok && r.state.challenge).toBe('lowPower');
    expect(r.ok && r.state.modifiers).toEqual(['halfEnergy']);
  });
});
