import * as THREE from 'three';
import { engine } from '../game/engine';
import type { Vec3 } from '../sim/types';

const tmpV = new THREE.Vector3();
const headings = new Map<number, THREE.Vector3>();

/** Drop headings of destroyed ships; `engine.prev` only holds live ids. */
export function pruneHeadings() {
  if (headings.size <= engine.prev.size + 64) return;
  for (const id of headings.keys()) if (!engine.prev.has(id)) headings.delete(id);
}

/**
 * Smoothed unit direction of travel, from the last two sim snapshots, written to
 * `out[o..o+2]`. Call once per entity per frame. The step is the equivalent of two
 * 0.25 lerps, which is what the ship layer and its trail used to apply between them.
 */
export function advanceHeading(
  id: number,
  cur: Vec3,
  prev: Vec3 | undefined,
  out: Float32Array,
  o: number,
) {
  let h = headings.get(id);
  if (!h) {
    h = new THREE.Vector3(0, 0, 1);
    headings.set(id, h);
  }
  if (prev) {
    tmpV.set(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
    if (tmpV.lengthSq() > 1e-6) h.lerp(tmpV.normalize(), 0.4375).normalize();
  }
  out[o] = h.x;
  out[o + 1] = h.y;
  out[o + 2] = h.z;
}
