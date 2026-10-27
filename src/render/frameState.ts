import { useFrame } from '@react-three/fiber';
import { engine } from '../game/engine';
import type { Asteroid, Pirate, Ship, Vec3 } from '../sim/types';
import { SHIP_CLASSES } from '../sim/types';
import { advanceHeading, pruneHeadings } from './heading';
import type { ModelClass } from './models';

/** Render classes in layer order: the ship classes, then pirates. */
export const CLASSES: ModelClass[] = [...SHIP_CLASSES, 'pirate'];
const CLASS_INDEX: Record<string, number> = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
export const PIRATE_CLASS = CLASSES.length - 1;

/** Room for the 1000-ship sim cap plus pirates. */
export const MAX_ENTITIES = 2048;

/**
 * Every live (not docked) ship and pirate, interpolated once per frame. Entity `i` is
 * `ids[i]`, at `pos[3i..3i+2]`, facing `hdg[3i..]`, having moved `step[i]` last tick.
 * `bucket[c]` lists the entity indices of class `c` in `[0, bucketLen[c])`.
 */
export const fleetFrame = {
  count: 0,
  ids: new Int32Array(MAX_ENTITIES),
  cls: new Uint8Array(MAX_ENTITIES),
  pos: new Float32Array(MAX_ENTITIES * 3),
  hdg: new Float32Array(MAX_ENTITIES * 3),
  step: new Float32Array(MAX_ENTITIES),
  bucket: CLASSES.map(() => new Int32Array(MAX_ENTITIES)),
  bucketLen: new Int32Array(CLASSES.length),
  /** Entity index of `view.ships[i]`, or -1 when docked or over the cap. */
  shipEntity: new Int32Array(MAX_ENTITIES).fill(-1),
  /** Entity index of the ship with this id, for camera follow; -1 if not live. */
  entityOf(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.ids[i] === id) return i;
    return -1;
  },
};

export type FleetFrame = typeof fleetFrame;

/** Interpolates the fleet between the previous and current sim state into `out`. */
export function fillFleetFrame(
  ships: readonly Ship[],
  pirates: readonly Pirate[],
  prev: ReadonlyMap<number, Vec3>,
  a: number,
  out: FleetFrame = fleetFrame,
): FleetFrame {
  out.bucketLen.fill(0);
  let n = 0;
  const put = (e: Ship | Pirate, c: number): number => {
    if (n >= MAX_ENTITIES) return -1;
    const p = prev.get(e.id) ?? e.pos;
    const i = n++;
    const o = i * 3;
    out.pos[o] = p.x + (e.pos.x - p.x) * a;
    out.pos[o + 1] = p.y + (e.pos.y - p.y) * a;
    out.pos[o + 2] = p.z + (e.pos.z - p.z) * a;
    advanceHeading(e.id, e.pos, prev.get(e.id), out.hdg, o);
    out.step[i] = prev.has(e.id) ? Math.hypot(e.pos.x - p.x, e.pos.y - p.y, e.pos.z - p.z) : 0;
    out.ids[i] = e.id;
    out.cls[i] = c;
    out.bucket[c][out.bucketLen[c]++] = i;
    return i;
  };
  for (let k = 0; k < ships.length && k < MAX_ENTITIES; k++) {
    const sh = ships[k];
    out.shipEntity[k] = sh.mode === 'docked' ? -1 : put(sh, CLASS_INDEX[sh.cls]);
  }
  for (const p of pirates) put(p, PIRATE_CLASS);
  out.count = n;
  return out;
}

let rockSource: readonly Asteroid[] | null = null;
let rockSize = -1;
const rockById = new Map<number, Asteroid>();

/** Asteroids by id, rebuilt only when the snapshot hands over a new list. */
export function asteroidById(list: readonly Asteroid[]): ReadonlyMap<number, Asteroid> {
  if (list !== rockSource || list.length !== rockSize) {
    rockSource = list;
    rockSize = list.length;
    rockById.clear();
    for (const r of list) rockById.set(r.id, r);
  }
  return rockById;
}

/** Runs before every other frame callback, so the layers just read `fleetFrame`. */
export function FleetPass() {
  useFrame(() => {
    const s = engine.view;
    pruneHeadings();
    fillFleetFrame(s.ships, s.pirates, engine.prev, engine.alpha());
  }, -10);
  return null;
}
