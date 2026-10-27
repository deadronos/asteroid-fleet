import { BASE_STORAGE, HANGAR_TYPES, SHIP_STATS } from './config';
import { lvl } from './research';
import type { Sim, Hangar, ShipClass } from './types';

export function occupancy(s: Sim, h: Hangar): (number | null)[] {
  const occ: (number | null)[] = Array.from({ length: h.slots }, () => null);
  for (const it of h.items) {
    const ship = s.ships.find((sh) => sh.id === it.shipId);
    if (!ship) continue;
    const size = SHIP_STATS[ship.cls].slots;
    for (let i = 0; i < size; i++) if (it.start + i < h.slots) occ[it.start + i] = it.shipId;
  }
  return occ;
}

export function fits(s: Sim, h: Hangar, cls: ShipClass, start: number, ignoreShip = -1): boolean {
  const size = SHIP_STATS[cls].slots;
  if (start < 0 || start + size > h.slots) return false;
  const occ = occupancy(s, h);
  for (let i = start; i < start + size; i++)
    if (occ[i] !== null && occ[i] !== ignoreShip) return false;
  return true;
}

export function firstFit(s: Sim, h: Hangar, cls: ShipClass): number {
  for (let i = 0; i < h.slots; i++) if (fits(s, h, cls, i)) return i;
  return -1;
}

/** Find a hangar + slot for a new ship, preferring `preferred`. */
export function findSpace(
  s: Sim,
  cls: ShipClass,
  preferred?: number,
): { hangar: Hangar; start: number } | null {
  const order = [...s.hangars].sort((a, b) =>
    a.id === preferred ? -1 : b.id === preferred ? 1 : 0,
  );
  for (const h of order) {
    const start = firstFit(s, h, cls);
    if (start >= 0) return { hangar: h, start };
  }
  return null;
}

/** Ship ids directly next to `shipId` on its hangar board. */
export function neighbours(s: Sim, h: Hangar, shipId: number): number[] {
  const occ = occupancy(s, h);
  const idx = occ.indexOf(shipId);
  if (idx < 0) return [];
  let end = idx;
  while (end + 1 < occ.length && occ[end + 1] === shipId) end++;
  const out: number[] = [];
  if (idx > 0 && occ[idx - 1] !== null) out.push(occ[idx - 1]!);
  if (end + 1 < occ.length && occ[end + 1] !== null) out.push(occ[end + 1]!);
  return out;
}

export function hangarOf(s: Sim, shipId: number): Hangar | undefined {
  return s.hangars.find((h) => h.items.some((it) => it.shipId === shipId));
}

export function carrierStorage(s: Sim): number {
  return BASE_STORAGE + s.hangars.reduce((a, h) => a + HANGAR_TYPES[h.type].storage, 0);
}

/** Repair rate for a docked ship, including the repair-drone adjacency synergy. */
export function dockRepairRate(s: Sim, shipId: number): number {
  const h = hangarOf(s, shipId);
  if (!h) return 0;
  let rate = HANGAR_TYPES[h.type].repairRate;
  const ship = s.ships.find((x) => x.id === shipId);
  if (ship && (ship.cls === 'fighter' || ship.cls === 'barge')) {
    const adj = neighbours(s, h, shipId).some(
      (id) => s.ships.find((x) => x.id === id)?.cls === 'repair',
    );
    if (adj) rate *= 3;
  }
  if (ship?.cls === 'drone' && lvl(s, 'bargeBay') > 0) {
    if (neighbours(s, h, shipId).some((id) => s.ships.find((x) => x.id === id)?.cls === 'barge'))
      rate *= 2;
  }
  return rate * (1 + 0.3 * lvl(s, 'repair'));
}

/** Take a ship out of every hangar slot it occupies. */
export function removeFromHangars(s: Sim, shipId: number) {
  for (const h of s.hangars) h.items = h.items.filter((it) => it.shipId !== shipId);
}

export function moveShip(s: Sim, shipId: number, toHangar: number, start: number): boolean {
  const ship = s.ships.find((x) => x.id === shipId);
  const target = s.hangars.find((h) => h.id === toHangar);
  if (!ship || !target) return false;
  if (!fits(s, target, ship.cls, start, shipId)) return false;
  removeFromHangars(s, shipId);
  target.items.push({ shipId, start });
  ship.hangarId = target.id;
  return true;
}
