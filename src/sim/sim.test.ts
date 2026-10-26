import { describe, expect, it } from 'vitest';
import { apply, prestige, researchPayout, settleOffline, shipCost } from './actions';
import { fits, neighbours, occupancy } from './hangar';
import { SOLAR_RATE } from './config';
import { lvl } from './research';
import { maxEnergy, newGame, upkeepRate } from './state';
import { step } from './tick';
import type { GameState } from './types';

const run = (s: GameState, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) step(s);
};

describe('simulation', () => {
  it('is deterministic for the same seed', () => {
    const a = newGame(7);
    const b = newGame(7);
    run(a, 120);
    run(b, 120);
    expect(JSON.stringify({ ...a, savedAt: 0 })).toEqual(JSON.stringify({ ...b, savedAt: 0 }));
  });

  it('drones mine and the refinery turns ore into credits', () => {
    const s = newGame(1);
    const start = s.credits;
    run(s, 180);
    expect(s.stats.oreValueDelivered).toBeGreaterThan(0);
    expect(s.credits).toBeGreaterThan(start);
  });

  it('a barge and hauler move ore through the logistics chain', () => {
    const s = newGame(2);
    s.credits = 5000;
    for (let i = 0; i < 2; i++) apply(s, { type: 'buyShip', cls: 'drone' });
    expect(apply(s, { type: 'buyShip', cls: 'barge', hangarId: 2 })).toBeNull();
    expect(apply(s, { type: 'buyShip', cls: 'hauler' })).toBeNull();
    run(s, 400);
    const barge = s.ships.find((x) => x.cls === 'barge')!;
    expect(barge.mode === 'station' || barge.cargo === 0).toBe(true);
    expect(s.stats.oreValueDelivered).toBeGreaterThan(300);
  });

  it('enforces hangar slot sizes and reports neighbours', () => {
    const s = newGame(3);
    const h = s.hangars[0];
    expect(occupancy(s, h).filter((x) => x !== null).length).toBe(4);
    expect(fits(s, h, 'barge', 4)).toBe(false); // 2 free slots, barge needs 4
    expect(fits(s, h, 'hauler', 4)).toBe(true);
    const first = h.items.find((it) => it.start === 0)!.shipId;
    expect(neighbours(s, h, first).length).toBe(1);
  });

  it('loses ships left outside at jump time', () => {
    const s = newGame(4);
    run(s, 30);
    const outside = s.ships.filter((x) => x.mode !== 'docked').length;
    expect(outside).toBeGreaterThan(0);
    s.carrier.energy = 1000;
    expect(apply(s, { type: 'warp', systemId: 1 })).toBeNull();
    apply(s, { type: 'jumpNow' });
    expect(s.systemId).toBe(1);
    expect(s.stats.shipsLost).toBe(outside);
  });

  it('recall during the warp charge docks the fleet before the jump', () => {
    const s = newGame(5);
    run(s, 30);
    s.carrier.energy = 1000;
    apply(s, { type: 'warp', systemId: 1 });
    run(s, 16);
    expect(s.systemId).toBe(1);
    expect(s.stats.shipsLost).toBe(0);
  });

  it('pays research by the documented formula and keeps research on prestige', () => {
    const s = newGame(6);
    s.stats.oreValueDelivered = 250_000;
    s.stats.furthestTier = 2;
    expect(researchPayout(s)).toBe(10);
    s.researchLevels.yield = 2;
    const next = prestige(s);
    expect(next.research).toBe(10);
    expect(next.researchLevels.yield).toBe(2);
    expect(next.ships.length).toBe(4);
    expect(next.lifetime.prestiges).toBe(1);
  });

  it('pirates attack in the frontier and fighters fight back', () => {
    const s = newGame(8);
    s.systems[2].discovered = true;
    s.carrier.energy = 1000;
    apply(s, { type: 'warp', systemId: 2 });
    apply(s, { type: 'jumpNow' });
    s.credits = 5000;
    for (let i = 0; i < 3; i++) expect(apply(s, { type: 'buyShip', cls: 'fighter' })).toBeNull();
    run(s, 200);
    expect(s.stats.piratesKilled).toBeGreaterThan(0);
  });

  it('settles offline time at reduced efficiency without pirates', () => {
    const s = newGame(9);
    s.miningIncomeAvg = 10;
    const before = s.credits;
    const rep = settleOffline(s, 3600)!;
    expect(rep.credits).toBeCloseTo(18000);
    expect(s.credits - before).toBeCloseTo(18000);
    expect(s.pirates.length).toBe(0);
  });

  it('pays offline only from mining income, not salvage', () => {
    const s = newGame(9);
    s.miningIncomeAvg = 2;
    s.incomeAvg = 10; // includes pirate salvage
    const rep = settleOffline(s, 3600)!;
    expect(rep.credits).toBeCloseTo(3600);
  });

  it('does not count offline credits toward prestige research', () => {
    const s = newGame(9);
    s.miningIncomeAvg = 10;
    const before = researchPayout(s);
    const ore = s.stats.oreValueDelivered;
    settleOffline(s, 12 * 3600);
    expect(s.stats.oreValueDelivered).toBe(ore);
    expect(researchPayout(s)).toBe(before);
  });

  it('recharges energy from solar minus upkeep over the elapsed time, capped at max', () => {
    const s = newGame(9);
    const sys = s.systems[s.systemId];
    const rate = SOLAR_RATE * sys.brightness * (1 + 0.2 * lvl(s, 'solar')) - upkeepRate(s);
    s.carrier.energy = 0;
    settleOffline(s, 100);
    expect(s.carrier.energy).toBeCloseTo(Math.min(maxEnergy(s), rate * 100));
    expect(s.carrier.energy).toBeLessThan(maxEnergy(s));
    s.carrier.energy = 0;
    settleOffline(s, 12 * 3600);
    expect(s.carrier.energy).toBe(maxEnergy(s));
  });

  it('ship prices rise with fleet size', () => {
    const s = newGame(10);
    const c1 = shipCost(s, 'drone');
    s.credits = 1000;
    apply(s, { type: 'buyShip', cls: 'drone' });
    expect(shipCost(s, 'drone')).toBeGreaterThan(c1);
  });
});
