// Player-facing words for rule cards (#82). Kept out of sim/config.ts so the
// worker bundle carries only the numbers.

import type { ValueDef } from '../sim/config';
import type { ActionKind, ConditionKind, StanceSwitch } from '../sim/types';

export const CONDITION_LABEL: Record<ConditionKind, string> = {
  cargoAbove: 'Cargo at or above',
  hullBelow: 'Hull below',
  pirateWithin: 'Pirate within',
  wave: 'Pirate wave announced',
  energyBelow: 'Carrier energy below',
  shieldBelow: 'Carrier shields below',
  storm: 'Storm active',
  asteroidFarther: 'Nearest asteroid farther than',
  carrierFarther: 'Carrier farther than',
  always: 'Always',
};

export function fmtValue(def: ValueDef, v: number): string {
  if (def.pct) return `${Math.round(v * 100)} %`;
  // Only `pirateWithin` goes down to 0, meaning anywhere in the system.
  return v > 0 ? `${v} km` : 'anywhere';
}

export const ACTION_LABEL: Record<ActionKind, string> = {
  stance: 'Switch stance',
  fallBack: 'Fall back to the carrier',
  unloadAtBarge: 'Unload at the nearest barge',
  callHauler: 'Call a hauler (default: at 98 %)',
  park: 'Park at the carrier when idle',
  recall: 'Recall to the hangars',
  shelter: 'Shelter at the carrier',
  reserveWarp: 'Keep a jump in reserve (fleet only)',
};

export const STANCE_LABEL: Record<StanceSwitch, string> = {
  'engagement:aggressive': 'Aggressive',
  'engagement:defensive': 'Defensive',
  'engagement:escort': 'Escort',
  'engagement:passive': 'Passive',
  'underFire:stand': 'Stand under fire',
  'underFire:retreatHull': 'Retreat when damaged',
  'underFire:retreatCargo': 'Retreat with cargo',
  'mining:greedy': 'Greedy mining',
  'mining:safe': 'Safe mining',
};
