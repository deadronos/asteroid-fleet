import { describe, expect, it } from 'vitest';
import { admiralty, apply, prestige } from './actions';
import { CARRIER_COST } from './config';
import { migrate } from '../game/migrate';
import { newGame } from './state';
import { step } from './tick';

function ready(admiralties = 3) {
  const g = newGame(5);
  g.lifetime.admiralties = admiralties;
  g.credits = 1e7;
  return g;
}
const buy = (g: ReturnType<typeof newGame>) =>
  apply(g, { type: 'buyCarrier', carrierId: g.ops[0].id });

describe('buy a carrier (#78)', () => {
  it('refuses without a free slot, then without credits', () => {
    const g = ready(0);
    expect(buy(g)).toBe('No slot');
    const h = ready(3);
    h.credits = CARRIER_COST(1) - 1;
    expect(buy(h)).toBe('Not enough credits');
    expect(h.ops).toHaveLength(1);
  });

  it('charges the curve and fills the slots', () => {
    const g = ready(5);
    const before = g.credits;
    expect(buy(g)).toBeNull();
    expect(g.credits).toBe(before - CARRIER_COST(1));
    expect(buy(g)).toBeNull();
    expect(g.ops).toHaveLength(3);
    expect(buy(g)).toBe('No slot');
    expect(CARRIER_COST(2)).toBeGreaterThan(CARRIER_COST(1));
  });

  it('gives the new carrier unique ids, its own rng and a starting system', () => {
    const g = ready();
    buy(g);
    const [a, b] = g.ops;
    expect(b.id).not.toBe(a.id);
    expect(b.rng).not.toBe(a.rng);
    expect(b.systemId).toBe(0);
    expect(b.asteroids.length).toBeGreaterThan(0);
    const hangars = [...a.hangars, ...b.hangars].map((h) => h.id);
    expect(new Set(hangars).size).toBe(hangars.length);
    const ships = [...a.ships, ...b.ships].map((x) => x.id);
    expect(new Set(ships).size).toBe(ships.length);
    expect(ships).not.toContain(b.id);
    expect(b.ships).toHaveLength(4);
  });

  it('keeps per-carrier pools separate and survives a save round trip', () => {
    const g = ready();
    buy(g);
    g.ops[1].carrier.ore = 42;
    for (let i = 0; i < 50; i++) for (const op of g.ops) step(g, op);
    const r = migrate(JSON.parse(JSON.stringify(g)));
    const state = r.ok ? r.state : null;
    expect(state?.ops).toHaveLength(2);
    expect(state?.ops[1].id).toBe(g.ops[1].id);
    expect(state?.ops[1].hangars.map((h) => h.id)).toEqual(g.ops[1].hangars.map((h) => h.id));
  });

  it('prestige and admiralty start the new run with as many fresh carriers', () => {
    const g = ready(5);
    buy(g);
    g.ops[1].carrier.ore = 42;
    for (const next of [prestige(g), admiralty(g)]) {
      expect(next.ops).toHaveLength(2);
      expect(next.ops[1].carrier.ore).toBe(0);
      const ids = next.ops.map((o) => o.id);
      expect(new Set(ids).size).toBe(2);
      const ships = next.ops.flatMap((o) => o.ships.map((x) => x.id));
      expect(new Set(ships).size).toBe(ships.length);
    }
  });

  it('a reset keeps no more carriers than the slots allow', () => {
    const g = ready(5);
    buy(g);
    buy(g);
    g.lifetime.admiralties = 3;
    expect(prestige(g).ops).toHaveLength(2);
  });
});
