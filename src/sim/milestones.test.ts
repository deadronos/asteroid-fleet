import { describe, expect, it } from 'vitest';
import { admiralty, prestige } from './actions';
import { HULL_IDS } from './config';
import { MILESTONES, carrierSlots, nextMilestone, reachedMilestones } from './milestones';
import { newGame } from './state';

function withAdmiralties(n: number) {
  const g = newGame(3);
  g.lifetime.admiralties = n;
  return g;
}

describe('Admiralty milestones (#70)', () => {
  it('starts with one carrier slot and nothing reached', () => {
    const g = newGame();
    expect(carrierSlots(g)).toBe(1);
    expect(reachedMilestones(g)).toEqual([]);
    expect(nextMilestone(g)).toBe(MILESTONES[0]);
  });

  it('grants carrier slots at 3 and 5', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => carrierSlots(withAdmiralties(n)))).toEqual([
      1, 1, 1, 2, 2, 3, 3,
    ]);
    expect(nextMilestone(withAdmiralties(5))).toBeNull();
  });

  it('unlocks every hull class at the first Admiralty, even before any prestige', () => {
    const g = newGame(5);
    g.stats.oreValueDelivered = 4_000_000;
    g.lifetime.researchEarned = 500;
    expect(g.hulls).toEqual(['standard']);
    const next = admiralty(g);
    expect(next.lifetime.admiralties).toBe(1);
    for (const id of HULL_IDS) expect(next.hulls).toContain(id);
  });

  it('survives prestige and further Admiralty resets', () => {
    let g = withAdmiralties(3);
    g.lifetime.researchEarned = 500;
    g = prestige(g);
    expect(carrierSlots(g)).toBe(2);
    g = admiralty(g);
    expect(g.lifetime.admiralties).toBe(4);
    expect(carrierSlots(g)).toBe(2);
    g.lifetime.admiralties = 5;
    g = prestige(admiralty(g));
    expect(carrierSlots(g)).toBe(3);
    expect(g.hulls.length).toBe(HULL_IDS.length);
  });
});
