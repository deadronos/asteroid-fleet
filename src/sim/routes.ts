// Supply routes (#80): a standing flow of one per-carrier resource (ore, H2 or energy) from
// one carrier to another. Credits and RP are shared, so they never travel (Q10, #49).
//
// Routes work on the carriers' pools only, never on the map, so they behave the same for a
// carrier at Tier A, Tier B or settled offline. Each route has its own rng for the
// interception roll, so the outcome depends on the route and the run clock alone.

import { TICK_HZ } from './config';
import { carrierStorage } from './hangar';
import { mulberry } from './math';
import { bind, maxEnergy } from './state';
import type { GameState, RouteResource } from './types';
import { ROUTE_RESOURCES } from './types';
import { ENERGY_FLOOR, MAX_ROUTES, ROUTE_RATES, interceptChance } from './routeinfo';

export { ENERGY_FLOOR, MAX_ROUTES, ROUTE_RATES, interceptChance, routeChance } from './routeinfo';

/** Seconds between route shipments. */
export const ROUTE_STEP_S = 1;
export function addRoute(
  g: GameState,
  from: number,
  to: number,
  resource: RouteResource,
  rate: number,
): string | null {
  const has = (id: number) => g.ops.some((o) => o.id === id);
  if (
    !has(from) ||
    !has(to) ||
    from === to ||
    !ROUTE_RESOURCES.includes(resource) ||
    !ROUTE_RATES.includes(rate) ||
    g.routes.some((r) => r.from === from && r.to === to && r.resource === resource)
  )
    return 'Invalid route';
  if (g.routes.length >= MAX_ROUTES) return 'Too many routes';
  const id = g.nextId++;
  g.routes.push({
    id,
    from,
    to,
    resource,
    rate,
    rng: (g.seed ^ Math.imul(id, 0x9e3779b1)) | 0,
    moved: 0,
    lost: 0,
  });
  return null;
}

export function removeRoute(g: GameState, id: number): string | null {
  const i = g.routes.findIndex((r) => r.id === id);
  if (i < 0) return 'No such route';
  g.routes.splice(i, 1);
  return null;
}

/**
 * Run the routes once the run clock has crossed a whole `ROUTE_STEP_S`. Called once per
 * step; counts ticks so the cadence has no float drift.
 */
export function stepRoutes(g: GameState) {
  if (g.routes.length === 0) return;
  const perStep = Math.round(ROUTE_STEP_S * TICK_HZ);
  const tick = Math.round(g.time * TICK_HZ);
  if (tick % perStep !== 0) return;
  routeTick(g, ROUTE_STEP_S);
}

/** One shipment round of `dt` seconds for every route, in route order. */
export function routeTick(g: GameState, dt: number) {
  for (const r of g.routes) {
    const src = g.ops.find((o) => o.id === r.from);
    const dst = g.ops.find((o) => o.id === r.to);
    if (!src || !dst) continue;
    const a = bind(g, src);
    const b = bind(g, dst);
    const from = a.carrier;
    const to = b.carrier;

    let have: number;
    let room: number;
    if (r.resource === 'ore') {
      have = from.ore;
      room = carrierStorage(b) - to.ore;
    } else if (r.resource === 'h2') {
      have = from.h2;
      room = Infinity;
    } else {
      have = Math.max(0, from.energy - ENERGY_FLOOR * maxEnergy(a));
      room = maxEnergy(b) - to.energy;
    }
    const amt = Math.min(r.rate * dt, have, room);
    if (!(amt > 1e-9)) continue;

    const [roll, next] = mulberry(r.rng);
    r.rng = next;

    let value = 0;
    if (r.resource === 'ore') {
      value = (from.oreValue / from.ore) * amt;
      from.ore -= amt;
      from.oreValue -= value;
      if (from.ore < 1e-6) {
        from.ore = 0;
        from.oreValue = 0;
      }
    } else if (r.resource === 'h2') from.h2 -= amt;
    else from.energy -= amt;

    if (roll < interceptChance(g, src.systemId, dst.systemId)) {
      r.lost += amt;
      continue;
    }
    r.moved += amt;
    if (r.resource === 'ore') {
      to.ore += amt;
      to.oreValue += value;
    } else if (r.resource === 'h2') to.h2 += amt;
    else to.energy += amt;
  }
}
