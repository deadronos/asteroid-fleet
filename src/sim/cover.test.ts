import { expect, it } from 'vitest';
import { stepSim } from './tick';
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
