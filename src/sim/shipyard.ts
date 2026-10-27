import { HULLS, REFIT_COST, SHIP_STATS } from './config';
import { firstFit } from './hangar';
import { lvl } from './research';
import { maxEnergy } from './state';
import type { HullId, Sim } from './types';

/** Starter systems (tier 1) have a shipyard. */
export function hasShipyard(s: Sim): boolean {
  return s.systems[s.systemId].tier === 1;
}

/** Slots a hangar at `index` has on `hull`, before bought extras. */
const baseSlots = (hull: HullId, index: number, bonus: number) =>
  (index < HULLS[hull].start.length ? HULLS[hull].slots : HULLS[hull].newSlots) + bonus;

/**
 * Change hull class at a shipyard. Hangars keep their type, bought slots and ships;
 * only the base grid size changes. Ships that no longer fit move to free space
 * elsewhere, else are sold back at the scrap rate. The hull class is the only new
 * state, so no save migration.
 */
export function refit(s: Sim, to: HullId): string | null {
  const from = s.carrier.hullClass;
  if (!hasShipyard(s)) return 'Refit needs a shipyard: return to a starter system';
  if (!s.hulls.includes(to)) return 'Hull not unlocked';
  if (to === from) return null;
  if (s.warp) return 'Cancel the warp first';
  if (s.credits < REFIT_COST) return 'Not enough credits';

  const saved = structuredClone(s.hangars);
  const savedHome = new Map(s.ships.map((x) => [x.id, x.hangarId]));
  const bonus = lvl(s, 'slots');
  const displaced: number[] = [];
  s.hangars.forEach((h, i) => {
    h.slots = Math.max(1, h.slots - baseSlots(from, i, bonus) + baseSlots(to, i, bonus));
    for (const it of h.items) {
      const ship = s.ships.find((x) => x.id === it.shipId);
      if (!ship || it.start + SHIP_STATS[ship.cls].slots > h.slots) displaced.push(it.shipId);
    }
    h.items = h.items.filter((it) => !displaced.includes(it.shipId));
  });

  const sell: number[] = [];
  for (const id of displaced) {
    const ship = s.ships.find((x) => x.id === id);
    if (!ship) continue;
    let placed = false;
    for (const h of s.hangars) {
      const start = firstFit(s, h, ship.cls);
      if (start < 0) continue;
      h.items.push({ shipId: id, start });
      ship.hangarId = h.id;
      placed = true;
      break;
    }
    if (!placed) {
      if (ship.mode !== 'docked') {
        // A ship in flight cannot be sold; make the player recall it first.
        saved.forEach((h, i) => Object.assign(s.hangars[i], h));
        for (const x of s.ships) x.hangarId = savedHome.get(x.id) ?? x.hangarId;
        return 'Recall launched ships first: they no longer fit';
      }
      sell.push(ship.id);
    }
  }
  for (const id of sell) {
    const ship = s.ships.find((x) => x.id === id)!;
    s.credits += Math.round(SHIP_STATS[ship.cls].cost * 0.5);
    s.ships = s.ships.filter((x) => x.id !== id);
    for (const x of s.ships) {
      if (x.bargeId === id) x.bargeId = -1;
      if (x.escortId === id) x.escortId = -1;
      if (x.targetId === id) x.targetId = -1;
    }
    for (const p of s.pirates) if (p.targetId === id) p.targetId = -2;
  }
  s.credits -= REFIT_COST;

  const c = s.carrier;
  const frac = c.hull / c.maxHull;
  c.hullClass = to;
  c.maxHull = HULLS[to].hull;
  c.hull = frac * c.maxHull;
  c.energy = Math.min(c.energy, maxEnergy(s));
  return null;
}
