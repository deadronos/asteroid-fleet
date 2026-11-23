import { expect, it } from 'vitest';
import { dist } from './math';
import { inHazard } from './ctx';
import { enterSystem } from './state';
import { game } from './testing';
import { stepSim } from './tick';

// #242: a depleted rock that refills inside a hazard can never be mined again once a scout
// charts it, so over hours every rock collects there and ore delivery collapses.
it('refills mined-out rocks outside hazards', () => {
  const s = game(42);
  enterSystem(s, 4);
  expect(s.hazards.length).toBeGreaterThan(0);
  for (const a of s.asteroids) {
    a.ore = 0;
    a.respawn = 0.1;
  }
  for (let i = 0; i < 20; i++) stepSim(s);

  const fresh = s.asteroids.filter((a) => a.ore > 0);
  expect(fresh.length).toBe(s.asteroids.length);
  expect(fresh.every((a) => !inHazard(s, a.pos))).toBe(true);
  // Rocks spawn within 9 units of the centre, so the safety margin holds for every rock.
  for (const a of fresh)
    for (const h of s.hazards) expect(dist(a.pos, h.pos)).toBeGreaterThan(h.radius);
});
