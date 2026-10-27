import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';

/** Drives the render loop at most `fps` times a second; 0 leaves it uncapped. */
export function FrameCap({ fps }: { fps: number }) {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    if (!fps) return;
    setFrameloop('never');
    const step = 1000 / fps;
    let last = -Infinity;
    let raf = requestAnimationFrame(function loop(t) {
      raf = requestAnimationFrame(loop);
      // Half a vsync of slack, so a 30 fps cap on a 60 Hz display hits every other frame.
      if (t - last < step - 4) return;
      last = t;
      advance(t / 1000);
    });
    return () => {
      cancelAnimationFrame(raf);
      setFrameloop('always');
    };
  }, [fps, setFrameloop, advance]);
  return null;
}

export interface RenderStatsData {
  /** Frames rendered so far; the object itself is reused. */
  frame: number;
  calls: number;
  triangles: number;
  otherCarriers: number;
}

const stats: RenderStatsData = { frame: 0, calls: 0, triangles: 0, otherCarriers: 0 };

/** Draw calls and triangles per frame, summed over all passes, and the extra carriers drawn, on `__render`. */
export function RenderStats() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.info.autoReset = false;
    (globalThis as unknown as { __render: RenderStatsData }).__render = stats;
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
