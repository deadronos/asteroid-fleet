// Per-class module loadout templates (#244). The templates live on GameState, so they are
// shared by every carrier and survive both prestige layers. Fitting is pure sim code: the
// UI only sends the orders and reads the templates back through the snapshot.

import { MODULES, MODULE_SLOTS, moduleLocked } from './config';
import { SHIP_CLASSES, type ModuleId, type Ship, type ShipClass, type Sim } from './types';

/**
 * Validate and store a template for `cls`. Returns null on success or a short refusal.
 * A `null` slot means "leave empty"; a missing trailing slot is left as the ship has it.
 */
export function setLoadout(s: Sim, cls: ShipClass, list: (ModuleId | null)[]): string | null {
  if (!SHIP_CLASSES.includes(cls)) return 'No such class';
  if (!Array.isArray(list) || list.length > MODULE_SLOTS[cls]) return 'Too many module slots';
  for (const m of list) {
    if (m === null) continue;
    if (typeof m !== 'string' || !Object.hasOwn(MODULES, m)) return 'Unknown module';
    if (!MODULES[m].fits.includes(cls)) return 'Module does not fit this class';
  }
  s.loadouts[cls] = [...list];
  return null;
}

/**
 * Fit `ship`'s class template into its module slots, buying what is unlocked and affordable.
 * `floor` is the credit reserve automated purchases must respect. Returns credits spent.
 */
export function fitLoadout(s: Sim, ship: Ship, floor = 0): number {
  const list = s.loadouts[ship.cls];
  if (!list || ship.mode !== 'docked') return 0;
  let spent = 0;
  const fitted: ModuleId[] = [];
  for (let i = 0; i < MODULE_SLOTS[ship.cls]; i++) {
    const want = i < list.length ? list[i] : (ship.modules[i] ?? null);
    if (want === null) continue;
    const have = ship.modules[i];
    if (have === want) {
      fitted.push(want);
      continue;
    }
    if (moduleLocked(want, ship.cls, s.stats.furthestTier)) {
      if (have) fitted.push(have);
      continue;
    }
    const cost = MODULES[want].cost;
    if (s.credits - cost < floor) {
      if (have) fitted.push(have);
      continue;
    }
    s.credits -= cost;
    spent += cost;
    fitted.push(want);
  }
  ship.modules = fitted;
  return spent;
}

/** Refit every docked ship of `cls` on this carrier; returns how many were touched. */
export function applyLoadout(s: Sim, cls: ShipClass): number {
  let n = 0;
  for (const ship of s.ships)
    if (ship.cls === cls && ship.mode === 'docked') {
      fitLoadout(s, ship);
      n++;
    }
  return n;
}
