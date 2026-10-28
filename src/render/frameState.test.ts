import { describe, expect, it } from 'vitest';
import { asteroidById, CLASSES, fillFleetFrame, PIRATE_CLASS } from './frameState';

const ship = (id: number, cls: string, x: number, mode = 'idle') =>
  ({ id, cls, mode, pos: { x, y: 0, z: 0 } }) as never;

describe('fillFleetFrame', () => {
  const prev = new Map([
    [1, { x: 0, y: 0, z: 0 }],
    [3, { x: 10, y: 0, z: 0 }],
  ]);

  it('interpolates once and buckets by class, skipping docked ships', () => {
    const ships = [ship(1, 'drone', 10), ship(2, 'barge', 5, 'docked'), ship(3, 'drone', 20)];
    const f = fillFleetFrame(ships, [ship(9, 'x', 4)], prev, 0.5);
    expect(f.count).toBe(3);
    expect(Array.from(f.ids.slice(0, 3))).toEqual([1, 3, 9]);
    expect(f.pos[0]).toBe(5);
    expect(f.pos[3]).toBe(15);
    // A pirate with no previous position sits at its current one.
    expect(f.pos[6]).toBe(4);
    expect(Array.from(f.shipEntity.slice(0, 3))).toEqual([0, -1, 1]);
    const drone = CLASSES.indexOf('drone');
    expect(f.bucketLen[drone]).toBe(2);
    expect(Array.from(f.bucket[drone].slice(0, 2))).toEqual([0, 1]);
    expect(f.bucketLen[PIRATE_CLASS]).toBe(1);
    expect(f.bucketLen[CLASSES.indexOf('barge')]).toBe(0);
    expect(f.step[0]).toBe(10);
    expect(f.step[2]).toBe(0);
    expect(f.entityOf(3)).toBe(1);
    expect(f.entityOf(2)).toBe(-1);
  });

  it('skips a carried drone the way it skips a docked ship (#181)', () => {
    const ships = [ship(1, 'drone', 10, 'carried'), ship(2, 'drone', 5, 'idle')];
    const f = fillFleetFrame(ships, [], prev, 1);
    expect(f.count).toBe(1);
    expect(Array.from(f.ids.slice(0, 1))).toEqual([2]);
    expect(Array.from(f.shipEntity.slice(0, 2))).toEqual([-1, 0]);
  });

  it('resets between frames', () => {
    const f = fillFleetFrame([ship(1, 'drone', 1)], [], prev, 1);
    expect(f.count).toBe(1);
    fillFleetFrame([], [], prev, 1, f);
    expect(f.count).toBe(0);
    expect(f.bucketLen[CLASSES.indexOf('drone')]).toBe(0);
  });
});

describe('asteroidById', () => {
  it('rebuilds only for a new list', () => {
    const list = [{ id: 7 }, { id: 8 }] as never[];
    const m = asteroidById(list);
    expect(m.get(8)).toBe(list[1]);
    expect(asteroidById(list)).toBe(m);
    expect(asteroidById([{ id: 1 }] as never[]).has(8)).toBe(false);
  });
});
