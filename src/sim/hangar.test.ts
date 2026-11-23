import { describe, expect, it } from 'vitest';
import { buildCtx, dockRepair } from './ctx';
import { createShip } from './economy';
import {
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
