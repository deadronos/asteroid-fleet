import { describe, expect, it } from 'vitest';
import { advanceHeading } from './heading';

const out = () => new Float32Array(3);

describe('advanceHeading', () => {
  it('starts facing +z and writes a unit vector', () => {
    const o = out();
    advanceHeading(9001, { x: 0, y: 0, z: 0 }, undefined, o, 0);
    expect([...o]).toEqual([0, 0, 1]);
  });

  it('turns toward the direction of travel without overshooting', () => {
    const o = out();
    const id = 9002;
    advanceHeading(id, { x: 0, y: 0, z: 0 }, undefined, o, 0);
    advanceHeading(id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o, 0);
    expect(o[0]).toBeGreaterThan(0);
    expect(o[2]).toBeGreaterThan(0);
    expect(Math.hypot(o[0], o[1], o[2])).toBeCloseTo(1, 5);
    for (let i = 0; i < 20; i++)
      advanceHeading(id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o, 0);
    expect(o[0]).toBeGreaterThan(0.99);
  });

  it('keeps its heading when the ship has not moved', () => {
    const o = out();
    const id = 9003;
    advanceHeading(id, { x: 0, y: 0, z: 0 }, undefined, o, 0);
    advanceHeading(id, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, o, 0);
    expect([...o]).toEqual([0, 0, 1]);
  });
});
