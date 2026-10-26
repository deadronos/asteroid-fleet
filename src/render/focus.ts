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
