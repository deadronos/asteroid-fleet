import type { Sim } from '../sim/types';

/** Ship the camera follows; null follows the carrier. Lives outside React so the 60 fps rig can read it. */
let focusId: number | null = null;
const listeners = new Set<() => void>();
let lastMiss = -Infinity;

export const DOUBLE_CLICK_MS = 350;

export const focus = {
  get: () => focusId,
  set(id: number | null) {
    if (id === focusId) return;
    focusId = id;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

/** Id to follow, or null (carrier) when the ship is gone or docked. */
export function resolveFocus(s: Pick<Sim, 'ships'>, id: number | null): number | null {
  if (id === null) return null;
  const ship = s.ships.find((x) => x.id === id);
  return ship && ship.mode !== 'docked' ? id : null;
}

/** True when a click on empty space at `now` completes a double-click. */
export function isDoubleMiss(now: number): boolean {
  const dbl = now - lastMiss <= DOUBLE_CLICK_MS;
  lastMiss = dbl ? -Infinity : now;
  return dbl;
}

/** Exponential smoothing factor, frame-rate independent. */
export function easeFactor(dt: number, rate: number): number {
  return 1 - Math.exp(-Math.max(0, dt) * rate);
}

/** Smoothstep ease for the eased tactical camera move; clamps 0..1 (#237). */
export function tacticalEase(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/** Exponential decay of a camera shake impulse, frame-rate independent (#237). */
export function shakeDecay(v: number, dt: number, rate = 6): number {
  return v * Math.exp(-Math.max(0, dt) * rate);
}

/** FOV target during the last two seconds of warp charge (`charge` counts down to 0) (#237). */
export function warpFov(charge: number, base = 55, kick = 5): number {
  return charge > 0 && charge < 2 ? base + kick * (1 - charge / 2) : base;
}

let exitRequested = false;
/** Ask the camera rig to leave tactical view (manual and auto) on its next frame. */
export function leaveTactical(): void {
  exitRequested = true;
}
/** True once per {@link leaveTactical} call. */
export function takeTacticalExit(): boolean {
  const r = exitRequested;
  exitRequested = false;
  return r;
}

/** Camera distance above which tactical turns on by itself. */
export const AUTO_TACTICAL_ON = 200;
/** Camera distance below which auto-tactical turns back off; lower than ON so it does not flicker. */
export const AUTO_TACTICAL_OFF = 160;

/**
 * One frame of the tactical toggle / auto-tactical state machine. Switching tactical off by hand
 * always resets the camera and clears auto; otherwise auto flips with hysteresis on camera distance.
 */
export function stepTactical(s: {
  wasTactical: boolean;
  tactical: boolean;
  auto: boolean;
  dist: number;
}): { resetCamera: boolean; auto: boolean } {
  if (s.wasTactical && !s.tactical) return { resetCamera: true, auto: false };
  const auto = s.auto ? s.dist >= AUTO_TACTICAL_OFF : s.dist > AUTO_TACTICAL_ON;
  return { resetCamera: false, auto };
}

/** Shared with the sim so the drawn heading and the firing cones use the same wrap (#161). */
export { shortestArc } from '../sim/math';
