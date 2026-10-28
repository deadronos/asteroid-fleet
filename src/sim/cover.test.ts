import { expect, it } from 'vitest';
import { stepSim } from './tick';
import { COVER_BACKOFF, TICK_HZ } from './config';
import { game } from './testing';

// #156: a held carrier parked away from all ore must not leave safe drones docked forever.
it('safe drones still mine when no ore is inside cover and no pirates are around', () => {
  const s = game(1);
  s.carrier.stance = 'hold';
  s.carrier.pos = { x: 0, y: 0, z: 0 };
  s.asteroids = s.asteroids.filter((a) => Math.hypot(a.pos.x, a.pos.z) > 60);
  expect(s.asteroids.length).toBeGreaterThan(0);
  for (let i = 0; i < 600; i++) stepSim(s);
  expect(s.pirates.length).toBe(0);
  expect(s.ships.some((x) => x.mode === 'mining')).toBe(true);
});

// #156 follow-up: with a pirate about, cover stays strict, so the fleet must not thrash the hangar.
function raidedAwayFromOre() {
  const s = game(1);
  s.carrier.stance = 'hold';
  s.carrier.pos = { x: 0, y: 0, z: 0 };
  s.asteroids = s.asteroids.filter((a) => Math.hypot(a.pos.x, a.pos.z) > 60);
  s.pirates.push({
    id: s.nextId++,
    pos: { x: 400, y: 0, z: 400 },
    hull: 1e9,
    maxHull: 1e9,
    damage: 0,
    speed: 0,
    targetId: -1,
    fireCooldown: 0,
  });
  return s;
}

it('safe drones with no ore in cover back off instead of relaunching every tick', () => {
  const s = raidedAwayFromOre();
  const seconds = 120;
  let launches = 0;
  let timer = s.hangars.map((h) => h.launchTimer);
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    stepSim(s);
    // The launch timer is reset only when a ship leaves a hangar.
    s.hangars.forEach((h, k) => {
      if (h.launchTimer > timer[k]) launches++;
    });
    timer = s.hangars.map((h) => h.launchTimer);
  }
  expect(s.ships.some((x) => x.mode === 'mining')).toBe(false);
  const drones = s.ships.filter((x) => x.cls === 'drone').length;
  expect(launches).toBeGreaterThan(0);
  expect(launches).toBeLessThanOrEqual(drones * (seconds / COVER_BACKOFF + 1));
});

it('flags "no ore in cover" while pirates keep safe drones docked, and clears it once ore is covered', () => {
  const s = raidedAwayFromOre();
  for (let i = 0; i < 400; i++) stepSim(s);
  expect(s.noCoverAt).toBeGreaterThan(0);
  expect(s.time - s.noCoverAt!).toBeLessThan(30);
  // Move the carrier onto the ore: cover returns and the flag goes stale.
  const a = s.asteroids[0];
  s.carrier.pos = { ...a.pos };
  for (let i = 0; i < 1000; i++) stepSim(s);
  expect(s.time - s.noCoverAt!).toBeGreaterThan(5);
});
