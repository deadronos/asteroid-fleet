import * as THREE from 'three';
import { engine } from '../game/engine';
import type { Vec3 } from '../sim/types';
import { easeFactor } from './focus';

const tmpV = new THREE.Vector3();
const headings = new Map<number, THREE.Vector3>();

/**
 * How fast a ship's visual heading turns toward its velocity, per second (see `easeFactor`),
 * calibrated so 60 Hz (`dt = 1 / 60`) matches two 0.25 lerps (`0.4375`) (#227).
 */
export const HEADING_TURN_RATE = -60 * Math.log(1 - 0.4375);

/** Drop headings of destroyed ships; `engine.prev` only holds live ids. */
export function pruneHeadings() {
  if (headings.size <= engine.prev.size + 64) return;
  for (const id of headings.keys()) if (!engine.prev.has(id)) headings.delete(id);
}

/**
 * Smoothed unit direction of travel, from the last two sim snapshots, written to
 * `out[o..o+2]`. Call once per entity per frame with frame `dt` in seconds.
 */
export function advanceHeading(
  id: number,
  cur: Vec3,
  prev: Vec3 | undefined,
  out: Float32Array,
  o: number,
  dt: number,
) {
  let h = headings.get(id);
  if (!h) {
    h = new THREE.Vector3(0, 0, 1);
    headings.set(id, h);
  }
  if (prev && dt > 0) {
    tmpV.set(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
    if (tmpV.lengthSq() > 1e-6)
      h.lerp(tmpV.normalize(), easeFactor(dt, HEADING_TURN_RATE)).normalize();
  }
  out[o] = h.x;
  out[o + 1] = h.y;
  out[o + 2] = h.z;
}
