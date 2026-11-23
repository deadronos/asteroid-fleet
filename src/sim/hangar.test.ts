import { describe, expect, it } from 'vitest';
import { buildCtx, cargoCap, dockRepair, fighterDamage, miningRate, speed } from './ctx';
import { createShip } from './economy';
import {
  activeSynergies,
  boardBoosts,
  boardNeighbours,
  dockRepairRate,
  fits,
  neighbours,
  occupancy,
  repairSynergy,
} from './hangar';
import { game } from './testing';
import type { Hangar, Ship, Sim } from './types';

/** A cargo hangar holding a barge in slots 0-3 and a drone in slot 4. */
function bargeAndDrone(s: Sim): { h: Hangar; barge: Ship; drone: Ship } {
  const h = s.hangars[1];
  const barge = createShip(s, 'barge', h.id, 0)!;
  const drone = createShip(s, 'drone', h.id, 4)!;
  return { h, barge, drone };
}

const byIdOf = (s: Sim) => new Map(s.ships.map((sh) => [sh.id, sh]));

/** Empty hangars with room for the boards these tests build. */
function emptyBoards(s: Sim) {
  s.ships = [];
  for (const h of s.hangars) {
    h.items = [];
    h.slots = 12;
  }
}

describe('hangar board helpers (#250)', () => {
  it('builds the same board with or without a ship lookup', () => {
    const s = game(1);
    const { h, barge, drone } = bargeAndDrone(s);
    const byId = byIdOf(s);
    expect(occupancy(s, h)).toEqual(occupancy(s, h, byId));
    expect(occupancy(s, h, byId).slice(0, 5)).toEqual([
      barge.id,
      barge.id,
      barge.id,
      barge.id,
      drone.id,
    ]);
    expect(occupancy(s, h, byId)[5]).toBeNull();
    expect(fits(s, h, 'drone', 5)).toBe(true);
    expect(fits(s, h, 'barge', 0)).toBe(false);
  });

  it('reports the ship next to a span, from either side', () => {
    const s = game(2);
    const { h, barge, drone } = bargeAndDrone(s);
    const byId = byIdOf(s);
    const occ = occupancy(s, h, byId);
    expect(boardNeighbours(occ, barge.id)).toEqual([drone.id]);
    expect(neighbours(s, h, drone.id)).toEqual([barge.id]);
    expect(neighbours(s, h, drone.id, byId)).toEqual([barge.id]);
    expect(boardNeighbours(occ, 9999)).toEqual([]);
  });

  it('applies the bargeBay drone-next-to-barge repair bonus once researched', () => {
    const s = game(3);
    const { h, drone } = bargeAndDrone(s);
    const byId = byIdOf(s);
    const occ = occupancy(s, h, byId);
    expect(repairSynergy(s, occ, drone, byId)).toBeNull();

    s.researchLevels.bargeBay = 1;
    const syn = repairSynergy(s, occ, drone, byId);
    expect(syn?.factor).toBe(2);
    expect(syn?.kind).toBe('bargeBay');
    expect(repairSynergy(s, occ, drone)).toEqual(syn);
    expect(dockRepairRate(s, drone.id, byId)).toBe(dockRepairRate(s, drone.id));
  });

  it('applies repair-drone adjacency to fighters and barges, and describes both sides', () => {
    const s = game(4);
    const h = s.hangars[1];
    const fighter = createShip(s, 'fighter', h.id, 0)!;
    const repair = createShip(s, 'repair', h.id, 2)!;
    const byId = byIdOf(s);
    const occ = occupancy(s, h, byId);
    expect(repairSynergy(s, occ, fighter, byId)?.factor).toBe(3);
    expect(repairSynergy(s, occ, fighter, byId)?.kind).toBe('repair');
    expect(repairSynergy(s, occ, repair, byId)?.kind).toBe('boosting');
    expect(repairSynergy(s, occ, repair, byId)?.factor).toBe(1);
  });

  it('keeps the tick-context repair rate equal to the shared helper', () => {
    const s = game(5);
    const { drone } = bargeAndDrone(s);
    const byId = byIdOf(s);
    const without = dockRepairRate(s, drone.id, byId);
    s.researchLevels.bargeBay = 1;
    const withBay = dockRepairRate(s, drone.id, byId);
    expect(withBay).toBe(without * 2);
    const c = buildCtx(s);
    expect(dockRepair(s, c, drone)).toBe(withBay);
  });
});

describe('positional board synergies (#244)', () => {
  it('gates every boost behind Board mastery and boosts the lead slot', () => {
    const s = game(6);
    emptyBoards(s);
    const h = s.hangars[0];
    const drone = createShip(s, 'drone', h.id, 0)!;
    const byId = byIdOf(s);
    const occ = occupancy(s, h, byId);
    expect(boardBoosts(s, occ, drone, byId)).toEqual([]);

    s.researchLevels.boardMastery = 1;
    expect(boardBoosts(s, occ, drone, byId)).toEqual([
      { kind: 'catapult', stat: 'speed', factor: 1.2 },
    ]);
    const base = speed(s, drone);
    buildCtx(s);
    expect(speed(s, drone)).toBeCloseTo(base * 1.2);
    // Level two amplifies the same rule.
    s.researchLevels.boardMastery = 2;
    buildCtx(s);
    expect(speed(s, drone)).toBeCloseTo(base * 1.4);
  });

  it('links a drone or fighter to an adjacent scout', () => {
    const s = game(7);
    emptyBoards(s);
    const h = s.hangars[0];
    const drone = createShip(s, 'drone', h.id, 0)!;
    createShip(s, 'scout', h.id, 1);
    const byId = byIdOf(s);
    const occ = occupancy(s, h, byId);
    const base = miningRate(s, buildCtx(s), drone);
    s.researchLevels.boardMastery = 1;
    expect(boardBoosts(s, occ, drone, byId)).toEqual([
      { kind: 'catapult', stat: 'speed', factor: 1.2 },
      { kind: 'sensorLink', stat: 'mining', factor: 1.25 },
    ]);
    buildCtx(s);
    expect(miningRate(s, buildCtx(s), drone)).toBeCloseTo(base * 1.25);

    const s2 = game(8);
    emptyBoards(s2);
    const h2 = s2.hangars[0];
    const fighter = createShip(s2, 'fighter', h2.id, 0)!;
    createShip(s2, 'scout', h2.id, 2);
    const baseDmg = fighterDamage(s2, buildCtx(s2), fighter);
    s2.researchLevels.boardMastery = 1;
    const b2 = byIdOf(s2);
    const occ2 = occupancy(s2, h2, b2);
    expect(boardBoosts(s2, occ2, fighter, b2)).toContainEqual({
      kind: 'sensorLink',
      stat: 'damage',
      factor: 1.25,
    });
    buildCtx(s2);
    expect(fighterDamage(s2, buildCtx(s2), fighter)).toBeCloseTo(baseDmg * 1.25);
  });

  it('dispatches a hauler next to a barge and keeps the repair synergy in the same list', () => {
    const s = game(9);
    emptyBoards(s);
    const h = s.hangars[0];
    createShip(s, 'barge', h.id, 0);
    const hauler = createShip(s, 'hauler', h.id, 4)!;
    const byId = byIdOf(s);
    const occ = occupancy(s, h, byId);
    expect(activeSynergies(s, occ, hauler, byId)).toEqual([]);

    s.researchLevels.boardMastery = 1;
    expect(boardBoosts(s, occ, hauler, byId)).toEqual([
      { kind: 'dispatchLink', stat: 'speed', factor: 1.3 },
      { kind: 'dispatchLink', stat: 'cargo', factor: 1.3 },
    ]);
    const baseCap = cargoCap(s, 'hauler', hauler);
    buildCtx(s);
    expect(cargoCap(s, 'hauler', hauler)).toBeCloseTo(baseCap * 1.3);

    const s2 = game(10);
    const h2 = s2.hangars[1];
    const fighter = createShip(s2, 'fighter', h2.id, 0)!;
    createShip(s2, 'repair', h2.id, 2);
    s2.researchLevels.boardMastery = 1;
    const b2 = byIdOf(s2);
    expect(activeSynergies(s2, occupancy(s2, h2, b2), fighter, b2).map((x) => x.kind)).toContain(
      'repair',
    );
  });
});
