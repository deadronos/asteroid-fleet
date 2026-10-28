import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type * as THREE from 'three';

interface Rect {
  left: number;
  right: number;
  height: number;
}

/**
 * How far right, in pixels, to shift the picture so the orbit target sits in the middle of
 * what the side panel leaves visible. Zero unless the panel is an open column on the left;
 * on phones it is a bottom sheet, and collapsed it is only its tab row.
 */
export function panelShift(panel: Rect | null, width: number, height: number): number {
  if (!panel) return 0;
  if (panel.left > width * 0.1 || panel.right > width * 0.6 || panel.height < height * 0.5)
    return 0;
  return panel.right / 2;
}

/** Applies `panelShift` to the camera's projection and keeps it current as the panel changes. */
export function PanelViewOffset() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const side = document.querySelector('.side');
    const apply = () => {
      const shift = panelShift(side?.getBoundingClientRect() ?? null, size.width, size.height);
      if (shift > 0)
        camera.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height);
      else camera.clearViewOffset();
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (side) observer.observe(side);
    return () => {
      observer.disconnect();
      camera.clearViewOffset();
    };
  }, [camera, size]);
  return null;
}
