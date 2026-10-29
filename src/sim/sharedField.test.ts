import { describe, expect, it } from 'vitest';
import { apply } from './actions';
import { bind, newGame } from './state';
import { stepOp } from './tick';
import type { GameState, Sim } from './types';
import { executeJump } from './warp';

/** A run with two carriers, both in system 0 on the same live field. */
function twoCarriers(): { g: GameState; a: Sim; b: Sim } {
  const g = newGame(5);
  g.lifetime.admiralties = 3;
  g.credits = 1e7;
  expect(apply(g, { type: 'buyCarrier', carrierId: g.ops[0].id })).toBeNull();
  return { g, a: bind(g, g.ops[0]), b: bind(g, g.ops[1]) };
}

const warp = (s: Sim, to: number) => {
  s.warp = { targetSystem: to, charge: 0, total: 1, paid: { energy: 0, h2: 0 } };
  executeJump(s);
};
const deplete = (s: Sim, i: number) => {
  s.asteroids[i].ore = 0;
  s.asteroids[i].respawn = 50;
};
const depleted = (s: Sim) => s.asteroids.flatMap((r, i) => (r.ore === 0 ? [i] : []));

describe('one field per system for the whole run (#176)', () => {
  it('keeps A depletion after A leaves, B enters and B leaves', () => {
    const { g, a, b } = twoCarriers();
    warp(b, 1);
    deplete(a, 3);
    warp(a, 2);
    warp(b, 0);
    expect(depleted(b)).toEqual([3]);
    warp(b, 1);
    warp(a, 0);
    expect(depleted(a)).toEqual([3]);
    expect(g.fields[1]).toBeUndefined(); // B left 1 with it untouched
  });

  it('shows A its depletion on return even while B sits in the system', () => {
    const { a, b } = twoCarriers();
    warp(b, 1);
    deplete(a, 3);
    warp(a, 2);
    warp(b, 0);
    warp(a, 0);
    expect(depleted(a)).toEqual([3]);
    expect(a.asteroids).toBe(b.asteroids);
  });

  it('loses neither record when two carriers leave the same system', () => {
    const { a, b } = twoCarriers();
    deplete(a, 3);
    deplete(b, 5);
    warp(a, 1);
    warp(b, 2);
    warp(a, 0);
    expect(depleted(a)).toEqual([3, 5]);
    warp(b, 0);
    expect(depleted(b)).toEqual([3, 5]);
  });

  it('lets two carriers in one system mine no more ore than the field holds', () => {
    const { g, a, b } = twoCarriers();
    expect(a.asteroids).toBe(b.asteroids);
    for (const r of a.asteroids) {
      r.ore = 0;
      r.respawn = 1e9;
    }
    const rock = a.asteroids[0];
    rock.ore = 40;
    rock.respawn = 0;
    const cap = 40 * rock.value;
    for (let i = 0; i < 350; i++) {
      g.time += 0.1;
      stepOp(a);
      stepOp(b);
    }
    let mined = g.stats.oreValueDelivered;
    for (const s of [a, b]) for (const x of s.ships) mined += x.cargoValue;
    expect(mined).toBeGreaterThan(0);
    expect(mined).toBeLessThanOrEqual(cap * 1.0001);
  });
});
