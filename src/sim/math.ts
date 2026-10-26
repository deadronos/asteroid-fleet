import type { Sim, Vec3 } from './types';

/** mulberry32 step: returns [value in 0..1, next state]. */
export function mulberry(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Deterministic RNG whose state lives in the save. */
export function rand(s: Sim): number {
  const [v, next] = mulberry(s.rng);
  s.rng = next;
  return v;
}

export function randRange(s: Sim, a: number, b: number): number {
  return a + (b - a) * rand(s);
}

/** Small standalone RNG for generation from a fixed seed. */
export function seeded(seed: number) {
  let st = seed | 0;
  return () => {
    const [v, n] = mulberry(st);
    st = n;
    return v;
  };
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Move `p` toward `t` by at most `step`. Returns true when arrived. */
export function moveToward(p: Vec3, t: Vec3, step: number, stopAt = 0): boolean {
  const d = dist(p, t);
  if (d <= stopAt + 1e-6) return true;
  const travel = Math.min(step, d - stopAt);
  const f = travel / d;
  p.x += (t.x - p.x) * f;
  p.y += (t.y - p.y) * f;
  p.z += (t.z - p.z) * f;
  return d - travel <= stopAt + 1e-3;
}

/** Move `p` away from `t`. */
export function moveAway(p: Vec3, t: Vec3, step: number) {
  const d = dist(p, t) || 1;
  p.x += ((p.x - t.x) / d) * step;
  p.y += ((p.y - t.y) / d) * step;
  p.z += ((p.z - t.z) / d) * step;
}

export function onSphere(r: () => number, radius: number, flat = 0.25): Vec3 {
  const a = r() * Math.PI * 2;
  const rr = radius * Math.sqrt(r());
  return { x: Math.cos(a) * rr, y: (r() - 0.5) * radius * flat, z: Math.sin(a) * rr };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
