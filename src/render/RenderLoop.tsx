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

/** Draw calls and triangles per frame, summed over all passes, and the extra carriers drawn, on `__render`. */
export function RenderStats() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => {
    const r = gl.info.render;
    (globalThis as unknown as { __render: object }).__render = {
      calls: r.calls,
      triangles: r.triangles,
      otherCarriers: scene.children.filter((c) => c.name === 'otherCarrier').length,
    };
    gl.info.reset();
  });
  return null;
}
