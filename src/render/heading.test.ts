import { describe, expect, it } from 'vitest';
import { advanceHeading, HEADING_TURN_RATE } from './heading';
import { easeFactor } from './focus';

const out = () => new Float32Array(3);
const DT60 = 1 / 60;

describe('advanceHeading', () => {
  it('starts facing +z and writes a unit vector', () => {
    const o = out();
    advanceHeading(9001, { x: 0, y: 0, z: 0 }, undefined, o, 0, DT60);
    expect([...o]).toEqual([0, 0, 1]);
  });

  it('turns toward the direction of travel without overshooting', () => {
    const o = out();
    const id = 9002;
    advanceHeading(id, { x: 0, y: 0, z: 0 }, undefined, o, 0, DT60);
    advanceHeading(id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o, 0, DT60);
    expect(o[0]).toBeGreaterThan(0);
    expect(o[2]).toBeGreaterThan(0);
    expect(Math.hypot(o[0], o[1], o[2])).toBeCloseTo(1, 5);
    for (let i = 0; i < 20; i++)
      advanceHeading(id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o, 0, DT60);
    expect(o[0]).toBeGreaterThan(0.99);
  });

  it('keeps its heading when the ship has not moved', () => {
    const o = out();
    const id = 9003;
    advanceHeading(id, { x: 0, y: 0, z: 0 }, undefined, o, 0, DT60);
    advanceHeading(id, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, o, 0, DT60);
    expect([...o]).toEqual([0, 0, 1]);
  });

  it('is frame-rate independent and preserves the 60 Hz step (#227)', () => {
    expect(easeFactor(DT60, HEADING_TURN_RATE)).toBeCloseTo(0.4375, 6);

    const o60 = out();
    const o120 = out();
    const o0 = out();
    advanceHeading(9004, { x: 0, y: 0, z: 0 }, undefined, o60, 0, DT60);
    advanceHeading(9005, { x: 0, y: 0, z: 0 }, undefined, o120, 0, 1 / 120);
    advanceHeading(9006, { x: 0, y: 0, z: 0 }, undefined, o0, 0, 0);

    // dt = 0 makes no turn.
    advanceHeading(9006, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o0, 0, 0);
    expect([...o0]).toEqual([0, 0, 1]);

    // Two 120 Hz half-steps stay close to one 60 Hz step (only chord normalization differs slightly).
    advanceHeading(9004, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o60, 0, DT60);
    advanceHeading(9005, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o120, 0, 1 / 120);
    advanceHeading(9005, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, o120, 0, 1 / 120);
    const dot = o60[0] * o120[0] + o60[1] * o120[1] + o60[2] * o120[2];
    expect(dot).toBeGreaterThan(0.995);
  });
});
