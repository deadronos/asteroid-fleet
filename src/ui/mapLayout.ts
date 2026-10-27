import type { StarSystem } from '../sim/types';

export const MAP_W = 760;
export const MAP_H = 300;

export interface MapNode {
  id: number;
  x: number;
  y: number;
}

/**
 * Where each system sits on the map: one column per jump distance, systems of a column
 * spread down it, nudged by the system's own seed so the map is stable and not a grid.
 */
export function layoutSystems(systems: readonly StarSystem[]): MapNode[] {
  const maxD = Math.max(1, ...systems.map((s) => s.distance));
  const columns = new Map<number, StarSystem[]>();
  for (const s of systems) columns.set(s.distance, [...(columns.get(s.distance) ?? []), s]);
  return systems.map((s) => {
    const col = columns.get(s.distance)!;
    const i = col.indexOf(s);
    const slot = (i + 1) / (col.length + 1);
    const jitter = (((s.seed >>> 3) % 1000) / 1000 - 0.5) * 36;
    return {
      id: s.id,
      x: 50 + (s.distance / maxD) * (MAP_W - 100),
      y: Math.round(MAP_H * (col.length === 1 ? 0.35 + 0.3 * ((s.seed % 7) / 6) : slot) + jitter),
    };
  });
}
