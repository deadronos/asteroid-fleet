import { describe, expect, it } from 'vitest';
import { order } from './actions';
import { waveSize } from './combat';
import * as config from './config';
import { removeFromHangars } from './hangar';
import { game } from './testing';

// Pins tuning values that used to be inline literals, so moving them cannot silently change balance.
describe('tuning constants', () => {
  it('keep their pre-extraction values', () => {
    expect(config.SCRAP_REFUND).toBe(0.5);
    expect(config.HEAT_CARGO_PER_TIER).toBe(2500);
    expect(config.ORE_VALUE_DISTANCE_SCALE).toBe(140);
    expect([
      config.WAVE_SIZE_BASE,
      config.WAVE_SIZE_PER_DISTANCE,
      config.WAVE_SIZE_PER_TIER,
    ]).toEqual([1, 0.7, 2]);
    expect([config.PIRATE_HULL_PER_DISTANCE, config.PIRATE_DAMAGE_PER_DISTANCE]).toEqual([
      0.25, 0.15,
    ]);
    expect([
      config.PIRATE_SPAWN_RADIUS,
      config.PIRATE_SPAWN_JITTER,
      config.PIRATE_SPAWN_HEIGHT,
    ]).toEqual([110, 10, 6]);
    expect(config.WAVE_INTERVAL_JITTER).toEqual([0.8, 1.2]);
    expect([config.STORM_DURATION, ...config.STORM_GAP]).toEqual([20, 120, 220]);
    expect([
      config.ESCORT_NEAR,
      config.ESCORT_ATTACKER_RANGE,
      config.DEFENSIVE_VICTIM_RANGE,
    ]).toEqual([18, 40, 20]);
    expect(config.AGGRESSIVE_CARRIER_SENSOR_MULT).toBe(1.5);
    expect([
      config.ESCORT_ORBIT_RADIUS,
      config.AGGRESSIVE_ORBIT_RADIUS,
      config.PATROL_ORBIT_RADIUS,
      config.SCOUT_ORBIT_RADIUS,
    ]).toEqual([5, 32, 12, 75]);
  });

  it('waveSize matches the original formula', () => {
    const s = game(3);
    s.systems[s.systemId].tier = 2;
    s.systems[s.systemId].distance = 3;
    s.carrier.oreValue = 0;
    for (const sh of s.ships) sh.cargoValue = 0;
    expect(waveSize(s)).toBe(Math.max(1, Math.round(1 + 3 * 0.7)));
    s.carrier.oreValue = 2500;
    expect(waveSize(s)).toBe(Math.round((1 + 3 * 0.7) * (1 + 2500 / (2500 * 2))));
  });

  it('scrapping refunds half the cost and frees the hangar slot', () => {
    const s = game(5);
    const ship = s.ships.find((x) => x.mode === 'docked')!;
    const before = s.credits;
    expect(order(s, { type: 'scrapShip', shipId: ship.id } as never)).toBeNull();
    expect(s.credits - before).toBe(Math.round(config.SHIP_STATS[ship.cls].cost * 0.5));
    expect(s.hangars.some((h) => h.items.some((it) => it.shipId === ship.id))).toBe(false);
  });

  it('removeFromHangars clears every slot of a ship', () => {
    const s = game(5);
    const id = s.ships[0].id;
    removeFromHangars(s, id);
    expect(s.hangars.flatMap((h) => h.items).some((it) => it.shipId === id)).toBe(false);
  });
});
