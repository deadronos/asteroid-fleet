import { Clock } from 'three';
import { describe, expect, it } from 'vitest';
import { startFrameCap } from './RenderLoop';

/** R3F 9's `update`, reduced to its clock handling for `frameloop: 'never'`. */
function r3fAdvance(clock: Clock, deltas: number[]) {
  return (timestamp: number) => {
    let delta = clock.getDelta();
    delta = timestamp - clock.elapsedTime;
    clock.oldTime = clock.elapsedTime;
    clock.elapsedTime = timestamp;
    deltas.push(delta);
  };
}

describe('startFrameCap', () => {
  it('gives positive deltas of one step at the capped rate', () => {
    const clock = new Clock();
    clock.getDelta(); // R3F's loop had already started the clock
    const deltas: number[] = [];
    const cbs: ((t: number) => void)[] = [];
    const stop = startFrameCap(
      clock,
      30,
      r3fAdvance(clock, deltas),
      (f) => (cbs.push(f), 1),
      () => {},
    );
    for (let i = 0; i < 10; i++) cbs.at(-1)!(5000 + (i * 1000) / 60);
    expect(deltas[0]).toBe(0);
    expect(deltas.length).toBe(5);
    for (const d of deltas.slice(1)) expect(d).toBeCloseTo(1 / 30, 5);
    stop();
    expect(clock.autoStart).toBe(true);
  });
});
