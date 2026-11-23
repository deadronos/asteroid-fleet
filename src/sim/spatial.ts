import type { Vec3 } from './types';

/**
 * Points with |x| or |z| beyond this, or NaN, do not size the grid: they sit in an edge
 * cell, which never lies farther than the point itself, so searches still find them.
 * Caps the grid at (2 * 4000 / cell)^2 cells however bad a position gets.
 */
export const GRID_LIMIT = 4000;

/**
 * Uniform grid over the x/z plane, rebuilt from scratch each tick. Points are
 * bucketed by a stable counting sort, so each cell lists its points in array order and
 * searches can break ties by index exactly like a linear scan would.
 * Holds no game state: nothing here is saved.
 */
export class PointGrid {
  minX = 0;
  minZ = 0;
  nx = 0;
  nz = 0;
  /** `items[start[c] .. start[c + 1])` are the point indices in cell `c`. */
  start = new Int32Array(2);
  items = new Int32Array(0);
  private cellOf = new Int32Array(0);
  private cursor = new Int32Array(0);

  constructor(readonly cell: number) {}

  build(points: readonly { pos: Vec3 }[]) {
    const n = points.length;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = points[i].pos;
      // Non-finite or far-flung points still get a cell (an edge one), but cannot size the grid.
      if (!(Math.abs(p.x) <= GRID_LIMIT && Math.abs(p.z) <= GRID_LIMIT)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    if (minX > maxX) minX = maxX = minZ = maxZ = 0;
    this.minX = minX;
    this.minZ = minZ;
    this.nx = Math.floor((maxX - minX) / this.cell) + 1;
    this.nz = Math.floor((maxZ - minZ) / this.cell) + 1;
    const cells = this.nx * this.nz;
    if (this.start.length < cells + 1) this.start = new Int32Array(cells + 1);
    if (this.items.length < n) {
      this.items = new Int32Array(n);
      this.cellOf = new Int32Array(n);
    }
    const start = this.start;
    start.fill(0, 0, cells + 1);
    for (let i = 0; i < n; i++) {
      const p = points[i].pos;
      const c = this.cx(p.x) + this.cz(p.z) * this.nx;
      this.cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    if (this.cursor.length < cells) this.cursor = new Int32Array(cells);
    this.cursor.set(start.subarray(0, cells));
    for (let i = 0; i < n; i++) this.items[this.cursor[this.cellOf[i]]++] = i;
  }

  /** Column of x, clamped into the grid. NaN lands in column 0. */
  cx(x: number): number {
    const c = Math.floor((x - this.minX) / this.cell);
    return c >= this.nx ? this.nx - 1 : c > 0 ? c : 0;
  }

  /** Row of z, clamped into the grid. */
  cz(z: number): number {
    const c = Math.floor((z - this.minZ) / this.cell);
    return c >= this.nz ? this.nz - 1 : c > 0 ? c : 0;
  }

  /**
   * Visit cells ring by ring around `p`. Before each ring `k`, `bound` receives
   * a lower bound on the distance of any point in that ring and may return
   * false to stop. `visit` gets every point index in the ring and may return
   * false to stop immediately.
   */
  rings(p: Vec3, bound: (minDist: number) => boolean, visit: (i: number) => unknown) {
    const x0 = this.cx(p.x);
    const z0 = this.cz(p.z);
    const kMax = Math.max(x0, this.nx - 1 - x0, z0, this.nz - 1 - z0);
    for (let k = 0; k <= kMax; k++) {
      if (!bound(Math.max(0, k - 1) * this.cell)) return;
      const zLo = Math.max(0, z0 - k);
      const zHi = Math.min(this.nz - 1, z0 + k);
      for (let z = zLo; z <= zHi; z++) {
        const edgeRow = z === z0 - k || z === z0 + k;
        const step = edgeRow ? 1 : 2 * k;
        for (let x = x0 - k; x <= x0 + k; x += step) {
          if (x < 0 || x >= this.nx) continue;
          const c = x + z * this.nx;
          for (let j = this.start[c]; j < this.start[c + 1]; j++) {
            if (visit(this.items[j]) === false) return;
          }
        }
      }
    }
  }
}
