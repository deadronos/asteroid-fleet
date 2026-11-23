import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { engine } from '../game/engine';

/** Idle render rate when the simulation is paused (#239). */
export const PAUSED_FPS = 4;
/** Milliseconds after pointer/wheel input during which a paused scene stays responsive. */
export const PAUSE_WAKE_MS = 1000;

interface CapClock {
  autoStart: boolean;
  elapsedTime: number;
  stop(): unknown;
}

/** Target frame rate given LQ `fps`, `paused`, and whether camera input is active. */
export function effectiveFps(
  fps: number,
  paused: boolean,
  active: boolean,
  pausedFps = PAUSED_FPS,
): number {
  if (!paused || active) return fps;
  return fps > 0 ? Math.min(fps, pausedFps) : pausedFps;
}

/**
 * Calls `advance(seconds)` from rAF at most `fps` times a second (or uncapped when `<= 0`)
 * and returns a stop function.
 * R3F's `advance` in `frameloop: 'never'` takes the delta as `timestamp - clock.elapsedTime`, but
 * it still calls `clock.getDelta()` first, which advances `elapsedTime` by wall-clock time and
 * leaves `oldTime` in milliseconds. So the clock is stopped here, and `elapsedTime` is the only
 * thing `advance` reads, seeded from the first frame so that frame has a zero delta.
 */
export function startFrameCap(
  clock: CapClock,
  fps: number | (() => number),
  advance: (seconds: number) => void,
  raf: (cb: (t: number) => void) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame,
): () => void {
  const wasAutoStart = clock.autoStart;
  clock.stop();
  clock.autoStart = false;
  const readFps = typeof fps === 'function' ? fps : () => fps;
  let last = -Infinity;
  let id = raf(function loop(t) {
    id = raf(loop);
    const rate = readFps();
    if (rate > 0) {
      const step = 1000 / rate;
      // Half a vsync of slack, so a 30 fps cap on a 60 Hz display hits every other frame.
      if (t - last < step - 4) return;
    }
    if (last === -Infinity) clock.elapsedTime = t / 1000;
    last = t;
    advance(t / 1000);
  });
  return () => {
    caf(id);
    clock.autoStart = wasAutoStart;
  };
}

/**
 * Drives the render loop at most `fps` times a second (0 = uncapped) and throttles
 * to `PAUSED_FPS` when `paused` unless user input just occurred (#239).
 */
export function FrameCap({ fps, paused = false }: { fps: number; paused?: boolean }) {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const advance = useThree((s) => s.advance);
  const clock = useThree((s) => s.clock);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!fps && !paused) return;
    setFrameloop('never');
    let activeUntil = -Infinity;
    const wake = () => {
      activeUntil = performance.now() + PAUSE_WAKE_MS;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons > 0) wake();
    };
    const el = gl.domElement;
    if (paused) {
      el.addEventListener('pointerdown', wake);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('wheel', wake, { passive: true });
      el.addEventListener('touchstart', wake, { passive: true });
      el.addEventListener('touchmove', wake, { passive: true });
    }
    const unsub = paused ? engine.subscribe(wake) : null;
    const stop = startFrameCap(
      clock,
      () => effectiveFps(fps, paused, performance.now() < activeUntil),
      advance,
    );
    return () => {
      stop();
      unsub?.();
      if (paused) {
        el.removeEventListener('pointerdown', wake);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('wheel', wake);
        el.removeEventListener('touchstart', wake);
        el.removeEventListener('touchmove', wake);
      }
      setFrameloop('always');
    };
  }, [fps, paused, setFrameloop, advance, clock, gl]);
  return null;
}

export interface RenderStatsData {
  /** Frames rendered so far; the object itself is reused. */
  frame: number;
  calls: number;
  triangles: number;
  otherCarriers: number;
}

declare global {
  var __render: RenderStatsData;
}

const stats: RenderStatsData = { frame: 0, calls: 0, triangles: 0, otherCarriers: 0 };

/** Draw calls and triangles per frame, summed over all passes, and the extra carriers drawn, on `__render`. */
export function RenderStats() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.info.autoReset = false;
    globalThis.__render = stats;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => {
    const r = gl.info.render;
    let others = 0;
    for (const c of scene.children) if (c.name === 'otherCarrier') others++;
    stats.frame++;
    stats.calls = r.calls;
    stats.triangles = r.triangles;
    stats.otherCarriers = others;
    gl.info.reset();
  });
  return null;
}
