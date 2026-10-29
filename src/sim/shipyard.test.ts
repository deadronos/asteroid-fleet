import { describe, expect, it } from 'vitest';
import { order } from './actions';
import { HULLS, REFIT_COST } from './config';
import { carrierMaxHull, createShip } from './state';
import { game } from './testing';

const yard = () => {
  const s = game(7);
  s.hulls = ['standard', 'light', 'fleet', 'mining', 'bastion'];
  s.credits = 100_000;
  s.ships = [];
  for (const h of s.hangars) h.items = [];
  s.unlocked = ['drone', 'fighter', 'hauler', 'barge', 'repair', 'scout', 'harvester'];
  return s;
};

describe('shipyard refit (#66)', () => {
  it('swaps hull stats, keeps hull fraction, and charges credits', () => {
    const s = yard();
    s.researchLevels.frame = 2;
    s.carrier.hull = s.carrier.maxHull / 2;
    expect(order(s, { type: 'refit', hull: 'bastion' })).toBeNull();
    expect(s.carrier.hullClass).toBe('bastion');
    expect(s.carrier.maxHull).toBe(carrierMaxHull(s));
    expect(s.carrier.maxHull).toBeCloseTo(HULLS.bastion.hull * 1.24);
    expect(s.carrier.hull).toBeCloseTo(carrierMaxHull(s) / 2);
    expect(s.credits).toBe(100_000 - REFIT_COST);
    expect(s.hangars[0].slots).toBe(HULLS.bastion.slots);
  });

  it('rejects locked hulls, no credits, and away from a shipyard', () => {
    const s = yard();
    s.hulls = ['standard'];
    expect(order(s, { type: 'refit', hull: 'light' })).toBe('Hull not unlocked');
    s.hulls = ['standard', 'light'];
    s.credits = 0;
    expect(order(s, { type: 'refit', hull: 'light' })).toBe('Not enough credits');
    s.credits = 1e6;
    s.systemId = s.systems.findIndex((x) => x.tier === 3);
    expect(order(s, { type: 'refit', hull: 'light' })).toMatch(/shipyard/);
    expect(s.carrier.hullClass).toBe('standard');
  });

  it('keeps ships that fit and sells back those that do not', () => {
    const s = yard();
    for (let i = 0; i < 6; i++) createShip(s, 'drone', 1, i);
    for (let i = 0; i < 4; i++) createShip(s, 'drone', 2, i);
    expect(s.ships.length).toBe(10);
    // standard 6 slots -> mining 4 slots: two drones from hangar 1 need space,
    // hangar 2 is full, so they are sold.
    expect(order(s, { type: 'refit', hull: 'mining' })).toBeNull();
    expect(s.hangars.map((h) => h.slots)).toEqual([4, 4]);
    expect(s.ships.length).toBe(8);
    for (const h of s.hangars) {
      for (const it of h.items) expect(it.start).toBeLessThan(h.slots);
    }
    for (const sh of s.ships) {
      expect(s.hangars.some((h) => h.items.some((i) => i.shipId === sh.id))).toBe(true);
    }
  });

  it('moves a displaced ship to free space when there is some', () => {
    const s = yard();
    for (let i = 0; i < 6; i++) createShip(s, 'drone', 1, i);
    expect(order(s, { type: 'refit', hull: 'mining' })).toBeNull();
    expect(s.ships.length).toBe(6);
    expect(s.hangars[1].items.length).toBe(2);
  });

  it('refuses when a launched ship would not fit, and sells nothing', () => {
    const s = yard();
    for (let i = 0; i < 6; i++) createShip(s, 'drone', 1, i);
    for (let i = 0; i < 4; i++) createShip(s, 'drone', 2, i);
    const flying = s.hangars[0].items.at(-1)!.shipId;
    s.ships.find((x) => x.id === flying)!.mode = 'idle';
    const credits = s.credits;
    expect(order(s, { type: 'refit', hull: 'mining' })).toMatch(/Recall/);
    expect(s.credits).toBe(credits);
    expect(s.ships.length).toBe(10);
    expect(s.carrier.hullClass).toBe('standard');
    expect(s.hangars.map((h) => h.slots)).toEqual([6, 6]);
  });

  it('clears references to a sold ship', () => {
    const s = yard();
    for (let i = 0; i < 4; i++) createShip(s, 'drone', 2, i);
    createShip(s, 'barge', 1, 2);
    createShip(s, 'drone', 1, 0);
    const barge = s.ships.find((x) => x.cls === 'barge')!;
    const drone = s.ships.at(-1)!;
    drone.bargeId = barge.id;
    drone.targetId = barge.id;
    expect(order(s, { type: 'refit', hull: 'mining' })).toBeNull();
    expect(s.ships.some((x) => x.id === barge.id)).toBe(false);
    expect(drone.bargeId).toBe(-1);
    expect(drone.targetId).toBe(-1);
  });
});

const buy = (s: ReturnType<typeof yard>, start: number) =>
  order(s, { type: 'buyShip', cls: 'drone', hangarId: 1, start });

describe('buyShip with an explicit slot (#186)', () => {
  it('refuses a start that overlaps an existing ship and charges nothing', () => {
    const s = yard();
    expect(buy(s, 2)).toBeNull();
    const credits = s.credits;
    expect(buy(s, 2)).toBe('No free hangar slots');
    expect(s.credits).toBe(credits);
    expect(s.ships.length).toBe(1);
    expect(s.hangars[0].items.length).toBe(1);
  });

  it('refuses an out-of-range start the same way', () => {
    const s = yard();
    const credits = s.credits;
    for (const start of [-1, s.hangars[0].slots, 99]) {
      expect(buy(s, start)).toBe('No free hangar slots');
    }
    expect(s.credits).toBe(credits);
    expect(s.ships.length).toBe(0);
  });

  it('places a ship exactly at a free start', () => {
    const s = yard();
    expect(buy(s, 3)).toBeNull();
    expect(s.hangars[0].items).toEqual([{ shipId: s.ships[0].id, start: 3 }]);
    expect(s.credits).toBeLessThan(100_000);
  });
});
