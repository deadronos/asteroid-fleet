import { Clock } from 'three';
import { describe, expect, it } from 'vitest';
import { PAUSED_FPS, effectiveFps, startFrameCap } from './RenderLoop';

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

  it('switches cleanly between paused throttle and uncapped input wake', () => {
    const clock = new Clock();
    clock.getDelta();
    const deltas: number[] = [];
    const cbs: ((t: number) => void)[] = [];
    let rate = PAUSED_FPS;
    const stop = startFrameCap(
      clock,
      () => rate,
      r3fAdvance(clock, deltas),
      (f) => (cbs.push(f), 1),
      () => {},
    );
    const step60 = 1000 / 60;
    // 1 second idle at PAUSED_FPS (4 fps): frames at t = 0, 250, 500, 750 ms.
    for (let i = 0; i < 60; i++) cbs.at(-1)!(5000 + i * step60);
    expect(deltas.length).toBe(4);
    // Wake on user input (rate = 0): every 60 Hz frame renders immediately.
    rate = 0;
    for (let i = 60; i < 70; i++) cbs.at(-1)!(5000 + i * step60);
    expect(deltas.length).toBe(14);
    // Drop back to PAUSED_FPS: skips frames until the next 250 ms boundary.
    rate = PAUSED_FPS;
    for (let i = 70; i < 100; i++) cbs.at(-1)!(5000 + i * step60);
    expect(deltas.length).toBe(16);
    for (const d of deltas.slice(1)) expect(d).toBeGreaterThan(0);
    stop();
  });
});

describe('effectiveFps', () => {
  it('caps at PAUSED_FPS when paused and idle unless LQ already caps lower', () => {
    expect(effectiveFps(0, false, false)).toBe(0);
    expect(effectiveFps(30, false, false)).toBe(30);
    expect(effectiveFps(0, true, false)).toBe(PAUSED_FPS);
    expect(effectiveFps(30, true, false)).toBe(PAUSED_FPS);
    expect(effectiveFps(2, true, false)).toBe(2);
    expect(effectiveFps(0, true, true)).toBe(0);
    expect(effectiveFps(30, true, true)).toBe(30);
  });
});
