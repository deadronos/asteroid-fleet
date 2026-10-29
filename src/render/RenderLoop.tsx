import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';

interface CapClock {
  autoStart: boolean;
  elapsedTime: number;
  stop(): unknown;
}

/**
 * Calls `advance(seconds)` from rAF at most `fps` times a second and returns a stop function.
 * R3F's `advance` in `frameloop: 'never'` takes the delta as `timestamp - clock.elapsedTime`, but
 * it still calls `clock.getDelta()` first, which advances `elapsedTime` by wall-clock time and
 * leaves `oldTime` in milliseconds. So the clock is stopped here, and `elapsedTime` is the only
 * thing `advance` reads, seeded from the first frame so that frame has a zero delta.
 */
export function startFrameCap(
  clock: CapClock,
  fps: number,
  advance: (seconds: number) => void,
  raf: (cb: (t: number) => void) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame,
): () => void {
  const wasAutoStart = clock.autoStart;
  clock.stop();
  clock.autoStart = false;
  const step = 1000 / fps;
  let last = -Infinity;
  let id = raf(function loop(t) {
    id = raf(loop);
    // Half a vsync of slack, so a 30 fps cap on a 60 Hz display hits every other frame.
    if (t - last < step - 4) return;
    if (last === -Infinity) clock.elapsedTime = t / 1000;
    last = t;
    advance(t / 1000);
  });
  return () => {
    caf(id);
    clock.autoStart = wasAutoStart;
  };
}

/** Drives the render loop at most `fps` times a second; 0 leaves it uncapped. */
export function FrameCap({ fps }: { fps: number }) {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const advance = useThree((s) => s.advance);
  const clock = useThree((s) => s.clock);
  useEffect(() => {
    if (!fps) return;
    setFrameloop('never');
    const stop = startFrameCap(clock, fps, advance);
    return () => {
      stop();
      setFrameloop('always');
    };
  }, [fps, setFrameloop, advance, clock]);
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
