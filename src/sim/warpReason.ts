import { warpPayment } from './config';
import { jumpCost } from './state';
import type { Sim } from './types';

/** Why a warp to `systemId` can't start right now, or null. Shared with the Carrier panel. */
export function warpBlocked(s: Sim, systemId: number): string | null {
  if (s.warp) return 'Already charging a jump';
  const from = s.systems[s.systemId];
  const to = s.systems[systemId];
  if (!to || !to.discovered || to.id === from.id) return 'Unknown system';
  const cost = jumpCost(s, from.distance, to.distance);
  if (!warpPayment(cost, s.carrier.energy, s.carrier.h2))
    return `Needs ${cost} energy (or H2 to cover the gap)`;
  return null;
}
