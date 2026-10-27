import type { GameState, SupplyRoute } from './types';

/** Units per second a route may be set to. */
export const ROUTE_RATES = [1, 2, 5, 10];
export const MAX_ROUTES = 6;
/** An energy route never drains its source below this share of its pool. */
export const ENERGY_FLOOR = 0.25;

/** Chance a shipment is lost: nothing inside a system, then more with each hop and tier. */
export function interceptChance(
  g: Pick<GameState, 'systems'>,
  fromSystem: number,
  toSystem: number,
): number {
  if (fromSystem === toSystem) return 0;
  const a = g.systems[fromSystem];
  const b = g.systems[toSystem];
  if (!a || !b) return 0;
  const hops = 1 + Math.abs(a.distance - b.distance);
  const tier = Math.max(a.tier, b.tier);
  return Math.min(0.5, 0.03 * hops + 0.05 * (tier - 1));
}

/** Chance for `route` right now, from where its two carriers are. */
export function routeChance(
  systems: Pick<GameState, 'systems'>,
  ops: readonly { id: number; systemId: number }[],
  r: SupplyRoute,
): number {
  const a = ops.find((o) => o.id === r.from);
  const b = ops.find((o) => o.id === r.to);
  return a && b ? interceptChance(systems, a.systemId, b.systemId) : 0;
}
