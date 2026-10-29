import { describe, expect, it } from 'vitest';
import { admiralty, apply, prestige, startChallenge } from './actions';
import { automation } from './automation';
import { CARRIER_COST } from './config';
import { destroyShip } from './ctx';
import { CHALLENGES } from './modifiers';
import { migrate } from '../game/migrate';
import type { ChallengeId } from './types';
import { bind, newGame } from './state';
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
    expect(buy(g)).toBe('No free carrier slot');
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
    expect(buy(g)).toBe('No free carrier slot');
    expect(CARRIER_COST(2)).toBeGreaterThan(CARRIER_COST(1));
  });

  it('buys a hangar without reusing an id another carrier holds (#173)', () => {
    const g = ready();
    buy(g);
    // The newer carrier already holds the highest ids; the older one is the collision.
    for (const carrierId of [g.ops[1].id, g.ops[0].id]) {
      const before = g.ops.flatMap((o) => o.hangars.map((h) => h.id));
      expect(apply(g, { type: 'buyHangar', hangarType: 'launch', carrierId })).toBeNull();
      const ids = g.ops.flatMap((o) => o.hangars.map((h) => h.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(Math.max(...ids)).toBe(Math.max(...before) + 1);
    }
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

  it('a challenge run keeps the carriers too', () => {
    const g = ready(5);
    buy(g);
    const next = startChallenge(g, Object.keys(CHALLENGES)[0] as ChallengeId);
    expect(next?.ops).toHaveLength(2);
  });

  it('rebuilds a loss onto the carrier that lost it (#174)', () => {
    const g = ready();
    buy(g);
    g.researchLevels.autoRebuild = 1;
    const a = bind(g, g.ops[0]);
    const b = bind(g, g.ops[1]);
    expect(
      apply(g, { type: 'setAutomation', patch: { autoRebuild: true }, carrierId: a.id }),
    ).toBeNull();
    g.credits = 1e7;
    const lost = b.ships.find((x) => x.cls === 'drone')!;
    const { cls, hangarId } = lost;
    b.ships = b.ships.filter((x) => x !== lost);
    destroyShip(b, lost, 'destroyed');
    expect(b.rebuildQueue).toEqual([{ cls, hangarId }]);
    expect(a.rebuildQueue).toEqual([]);
    const left = b.ships.filter((x) => x.cls === cls && x.hangarId === hangarId).length;
    a.automationTimer = 0.1;
    b.automationTimer = 0.1;
    const aCount = a.ships.length;
    automation(a, 0.1);
    automation(b, 0.1);
    expect(a.ships.length).toBe(aCount);
    expect(b.ships.filter((x) => x.cls === cls && x.hangarId === hangarId)).toHaveLength(left + 1);
    expect(a.rebuildQueue).toHaveLength(0);
    expect(b.rebuildQueue).toHaveLength(0);
  });
});
