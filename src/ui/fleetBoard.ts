// Pure helpers shared by the Fleet panel's board, detail and shop pieces.
// The ship index is cached per ships array so a board stays O(slots) (#250).

import { tierHint } from '../sim/config';
import type { RepairSynergyKind } from '../sim/hangar';
import { SHIP_CLASSES, type Sim, type Ship, type ShipClass } from '../sim/types';

/** Panel wording for each rule in `repairSynergy`, so the text follows the sim's rules. */
export const SYNERGY_LABEL: Record<RepairSynergyKind, string> = {
  repair: 'Repair drone adjacent: repairs 3× faster when docked',
  bargeBay: 'Barge bay neighbour: docked drones repair 2× faster',
  boosting: 'Boosting the repairs of its neighbours',
};

const MODE_LABEL: Record<string, string> = {
  docked: 'docked',
  idle: 'idle',
  toAsteroid: 'to rock',
  mining: 'mining',
  toDropoff: 'to barge',
  toBarge: 'to barge',
  toCarrier: 'returning',
  station: 'on station',
  escort: 'escorting',
  attack: 'attacking',
  patrol: 'patrol',
  repairing: 'repairing',
  retreat: 'retreating',
  recall: 'recalled',
  carried: 'in barge bay',
};

// Haulers use `toDropoff` for salvage runs to a barge wreck's container.
export const modeLabel = (ship: Ship) =>
  ship.cls === 'hauler' && ship.mode === 'toDropoff' ? 'salvaging' : MODE_LABEL[ship.mode];

export const UNLOCK_HINT: Partial<Record<ShipClass, string>> = {
  fighter: tierHint(2),
  repair: tierHint(2),
  harvester: 'Research the fusion reactor',
};

const indexes = new WeakMap<Ship[], Map<number, Ship>>();

/** Ships by id, built once per ships array (a fleet board would otherwise be O(ships²)). */
export function shipIndex(s: Sim): Map<number, Ship> {
  let m = indexes.get(s.ships);
  if (!m) {
    m = new Map(s.ships.map((sh) => [sh.id, sh]));
    indexes.set(s.ships, m);
  }
  return m;
}

/** Per-class owned counts in one pass over the fleet. */
export function countByClass(ships: readonly { cls: ShipClass }[]): Record<ShipClass, number> {
  const counts = Object.fromEntries(SHIP_CLASSES.map((c) => [c, 0])) as Record<ShipClass, number>;
  for (const x of ships) counts[x.cls]++;
  return counts;
}
