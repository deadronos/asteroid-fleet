import { describe, expect, it } from 'vitest';
import {
  AUTO_TACTICAL_OFF,
  AUTO_TACTICAL_ON,
  DOUBLE_CLICK_MS,
  easeFactor,
  focus,
  isDoubleMiss,
  resolveFocus,
  leaveTactical,
  stepTactical,
  takeTacticalExit,
  shortestArc,
} from './focus';

const ships = (...m: [number, string][]) => ({
  ships: m.map(([id, mode]) => ({ id, mode })) as never,
});

describe('resolveFocus', () => {
  it('keeps live ships', () => expect(resolveFocus(ships([1, 'mining']), 1)).toBe(1));
  it('falls back when docked', () => expect(resolveFocus(ships([1, 'docked']), 1)).toBeNull());
  it('falls back when destroyed', () => expect(resolveFocus(ships([2, 'idle']), 1)).toBeNull());
  it('null stays null', () => expect(resolveFocus(ships(), null)).toBeNull());
});

describe('isDoubleMiss', () => {
  it('detects two quick misses once', () => {
    expect(isDoubleMiss(10_000)).toBe(false);
    expect(isDoubleMiss(10_000 + DOUBLE_CLICK_MS - 1)).toBe(true);
    expect(isDoubleMiss(10_000 + DOUBLE_CLICK_MS)).toBe(false);
  });
  it('ignores slow clicks', () => {
    expect(isDoubleMiss(50_000)).toBe(false);
    expect(isDoubleMiss(60_000)).toBe(false);
  });
});

describe('easeFactor', () => {
  it('is 0..1 and monotonic', () => {
    expect(easeFactor(0, 8)).toBe(0);
    expect(easeFactor(0.1, 8)).toBeGreaterThan(0);
    expect(easeFactor(10, 8)).toBeLessThan(1.0000001);
  });
});

describe('focus store', () => {
  it('notifies on change only', () => {
    let n = 0;
    const off = focus.subscribe(() => n++);
    focus.set(5);
    focus.set(5);
    focus.set(null);
    off();
    expect(n).toBe(2);
  });
});

const step = (wasTactical: boolean, tactical: boolean, auto: boolean, dist: number) =>
  stepTactical({ wasTactical, tactical, auto, dist });

describe('leaveTactical', () => {
  it('is consumed once and makes auto-tactical reset the camera', () => {
    leaveTactical();
    expect(takeTacticalExit()).toBe(true);
    expect(takeTacticalExit()).toBe(false);
    // The rig then treats it as manual tactical switched off.
    expect(step(true, false, true, 230)).toEqual({ resetCamera: true, auto: false });
  });
});

describe('stepTactical', () => {
  it('manual off resets the camera and clears auto even when far away', () => {
    expect(step(true, false, true, 230)).toEqual({ resetCamera: true, auto: false });
  });
  it('manual on does not reset the camera', () => {
    expect(step(false, true, false, 74).resetCamera).toBe(false);
  });
  it('turns auto on above the on threshold', () => {
    expect(step(false, false, false, AUTO_TACTICAL_ON + 1).auto).toBe(true);
  });
  it('stays off at the on threshold', () => {
    expect(step(false, false, false, AUTO_TACTICAL_ON).auto).toBe(false);
  });
  it('holds auto inside the hysteresis band', () => {
    expect(step(false, false, true, 180).auto).toBe(true);
    expect(step(false, false, false, 180).auto).toBe(false);
  });
  it('turns auto off below the off threshold', () => {
    expect(step(false, false, true, AUTO_TACTICAL_OFF - 1).auto).toBe(false);
  });
  it('does not flip every frame around 190', () => {
    let auto = false;
    for (const d of [195, 190, 185, 190, 195, 190]) auto = step(false, false, auto, d).auto;
    expect(auto).toBe(false);
  });
});

describe('shortestArc', () => {
  it('takes the short way across ±π', () => {
    expect(shortestArc(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(shortestArc(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
    expect(shortestArc(0.5, 1)).toBeCloseTo(0.5);
  });
});
