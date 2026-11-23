import { describe, expect, it } from 'vitest';
import { order, prestige, admiralty, apply } from './actions';
import { fitLoadout, applyLoadout, setLoadout } from './loadouts';
import { createShip, stateOf } from './state';
import { game } from './testing';
import { stepSim } from './tick';

describe('module loadout templates (#244)', () => {
  it('validates templates before storing them', () => {
    const s = game(1);
    expect(setLoadout(s, 'drone', ['laser'])).toBeNull();
    expect(s.loadouts.drone).toEqual(['laser']);
    expect(setLoadout(s, 'drone', ['laser', 'laser'])).toBe('Too many module slots');
    expect(setLoadout(s, 'dreadnought' as 'drone', ['laser'])).toBe('No such class');
    expect(setLoadout(s, 'barge', ['quantum' as 'laser'])).toBe('Unknown module');
    expect(setLoadout(s, 'barge', ['drill'])).toBe('Module does not fit this class');
    expect(setLoadout(s, 'barge', ['tractor', null])).toBeNull();
  });

  it('fits unlocked, affordable modules and respects slots and the credit floor', () => {
    const s = game(2);
    s.credits = 1000;
    const drone = s.ships.find((x) => x.cls === 'drone')!;
    s.loadouts.drone = ['laser'];
    expect(fitLoadout(s, drone)).toBe(160);
    expect(drone.modules).toEqual(['laser']);
    expect(s.credits).toBe(840);
    // Fitting again is free when the slot already matches.
    expect(fitLoadout(s, drone)).toBe(0);

    s.automation.creditFloor = 800;
    const other = s.ships.find((x) => x.cls === 'drone' && x !== drone)!;
    expect(fitLoadout(s, other, s.automation.creditFloor)).toBe(0);
    expect(other.modules).toEqual([]);

    // Tier-2 modules are skipped on a Starter run.
    s.unlocked.push('barge');
    const barge = createShip(s, 'barge')!;
    s.loadouts.barge = ['shield', null];
    s.credits = 1000;
    expect(fitLoadout(s, barge)).toBe(0);
    expect(barge.modules).toEqual([]);
  });

  it('fits a new template when a ship is bought', () => {
    const s = game(3);
    s.credits = 10_000;
    s.unlocked.push('scout');
    s.loadouts.scout = ['tractor'];
    expect(order(s, { type: 'buyShip', cls: 'scout' })).toBeNull();
    const scout = s.ships.find((x) => x.cls === 'scout')!;
    expect(scout.modules).toEqual(['tractor']);
  });

  it('refits docked ships of a class with applyLoadout', () => {
    const s = game(4);
    s.credits = 10_000;
    s.loadouts.drone = ['laser'];
    const docked = s.ships.filter((x) => x.cls === 'drone');
    docked[0].mode = 'mining'; // launched ships are left alone
    expect(applyLoadout(s, 'drone')).toBe(docked.length - 1);
    expect(docked[0].modules).toEqual([]);
    for (const sh of docked.slice(1)) expect(sh.modules).toEqual(['laser']);
  });

  it('respects the credit floor when automation buys and rebuilds', () => {
    const s = game(5);
    s.credits = 1000;
    s.researchLevels.autoBuy = 1;
    s.researchLevels.autoRebuild = 1;
    s.automation.autoBuy = true;
    s.automation.autoRebuild = true;
    s.automation.creditFloor = 700;
    s.loadouts.drone = ['laser'];
    s.hangars[0].target.drone = 6;
    // Each drone costs ~40 plus a 160 laser; the floor leaves room for a few, not all.
    stepSim(s);
    const fitted = s.ships.filter((x) => x.cls === 'drone' && x.modules.includes('laser'));
    expect(fitted.length).toBeGreaterThan(0);
    expect(s.credits).toBeGreaterThanOrEqual(s.automation.creditFloor);
  });

  it('survives both prestige layers and is shared across carriers', () => {
    const s = game(6);
    s.loadouts = { drone: ['laser'], barge: ['tractor', null] };
    const g = stateOf(s);
    expect(prestige(g).loadouts).toEqual(s.loadouts);
    expect(admiralty(g).loadouts).toEqual(s.loadouts);
    const fromOrder = game(7);
    const raw = stateOf(fromOrder);
    apply(raw, {
      type: 'setLoadout',
      cls: 'drone',
      modules: ['laser'],
      carrierId: raw.ops[0].id,
    });
    expect(raw.loadouts.drone).toEqual(['laser']);
  });
});
