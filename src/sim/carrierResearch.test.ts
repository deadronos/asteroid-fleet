import { describe, expect, it } from 'vitest';
import { WAVE_WARNING } from './config';
import { waveWarning } from './combat';
import { RESEARCH, buyResearch, canBuyResearch } from './research';
import { jumpCost, newGame, refineThroughput, bind, focusOp } from './state';
import { game } from './testing';

const ids = ['frame', 'reactor', 'bays', 'sensors'];

describe('carrier research branch (#67)', () => {
  it('adds finite Carrier nodes', () => {
    for (const id of ids) {
      const n = RESEARCH.find((r) => r.id === id)!;
      expect(n.branch).toBe('Carrier');
      expect(Number.isFinite(n.maxLevel)).toBe(true);
    }
  });

  it('frame raises hull now and keeps damage taken', () => {
    const s = game(3);
    s.carrier.hull = 1500;
    s.research = 100;
    expect(buyResearch(s, 'frame')).toBe(true);
    expect(s.carrier.maxHull).toBeCloseTo(2000 * 1.12);
    expect(s.carrier.hull).toBeCloseTo(1500 + 240);
  });

  it('frame applies to a new run from carried levels without a save change', () => {
    const g = newGame(3, {
      research: 0,
      researchLevels: { frame: 2 },
      unlocked: [],
      unlockedRules: [],
      hulls: ['standard'],
      hullClass: 'standard',
      discovered: [],
      lifetime: { prestiges: 1, researchEarned: 0, admiralties: 0, marksEarned: 0 },
    });
    const s = bind(g, focusOp(g));
    expect(s.carrier.maxHull).toBeCloseTo(2000 * 1.24);
    expect(s.carrier.hull).toBe(s.carrier.maxHull);
  });

  it('reactor and sensors scale refinery, jump cost and warning', () => {
    const s = game(3);
    const r = refineThroughput(s);
    const j = jumpCost(s, 0, 1);
    const w = waveWarning(s);
    s.researchLevels.reactor = 5;
    s.researchLevels.sensors = 4;
    expect(refineThroughput(s)).toBeCloseTo(r * 1.5);
    expect(jumpCost(s, 0, 1)).toBeCloseTo(j * 0.8);
    expect(waveWarning(s)).toBe(w + 20);
    expect(w).toBe(WAVE_WARNING);
  });

  it('bays needs Hangar frames first', () => {
    const s = game(3);
    s.research = 100;
    expect(canBuyResearch(s, 'bays')).toBe(false);
    s.researchLevels.slots = 1;
    expect(canBuyResearch(s, 'bays')).toBe(true);
  });
});
