// Warp jumps and the emergency jump when the carrier is disabled.

import { DOCK_RADIUS } from './config';
import { destroyShip, dock } from './ctx';
import { copy, dist } from './math';
import { emit, enterSystem } from './state';
import type { Sim, Ship } from './types';

export function carrierDisabled(s: Sim) {
  emit(s, 'EmergencyJump', {});
  const lost = s.ships.filter((x) => x.mode !== 'docked');
  for (const l of lost) destroyShip(s, l, 'emergencyJump');
  s.ships = s.ships.filter((x) => x.mode === 'docked');
  s.carrier.hull = s.carrier.maxHull * 0.5;
  s.carrier.shield = 0;
  s.carrier.ore = 0;
  s.carrier.oreValue = 0;
  s.warp = null;
  enterSystem(s, 0);
}

// ---------- warp ----------

export function warpStep(s: Sim, dt: number) {
  if (!s.warp) return;
  s.warp.charge -= dt;
  if (s.warp.charge > 0) return;
  executeJump(s);
}

/**
 * Whether a ship makes the jump: docked, within DOCK_RADIUS of the carrier
 * (it docks a tick or two later anyway), or riding in a barge that does.
 */
function aboard(s: Sim, ship: Ship, byId: Map<number, Ship>): boolean {
  const host = ship.mode === 'carried' ? byId.get(ship.bargeId) : ship;
  if (!host || host.hull <= 0) return false;
  return host.mode === 'docked' || dist(host.pos, s.carrier.pos) <= DOCK_RADIUS;
}

/** Ships that would be lost if the carrier jumped now. Shared with the HUD count. */
export function leftBehind(s: Sim): Ship[] {
  const byId = new Map(s.ships.map((x) => [x.id, x]));
  return s.ships.filter((x) => !aboard(s, x, byId));
}

export function executeJump(s: Sim) {
  if (!s.warp) return;
  const target = s.warp.targetSystem;
  const outside = leftBehind(s);
  const lost = new Set(outside);
  // Barges before their bay drones, so a drone's barge has unloaded first.
  for (const x of s.ships)
    if (x.mode !== 'docked' && x.mode !== 'carried' && !lost.has(x)) dock(s, x);
  for (const x of s.ships) if (x.mode === 'carried' && !lost.has(x)) dock(s, x);
  for (const l of outside) destroyShip(s, l, 'leftBehind');
  s.ships = s.ships.filter((x) => x.mode === 'docked');
  s.fx.push({ kind: 'warp', a: copy(s.carrier.pos), b: copy(s.carrier.pos), ttl: 1.5 });
  s.warp = null;
  enterSystem(s, target);
  for (const sh of s.ships) sh.pos = copy(s.carrier.pos);
  emit(s, 'Warped', { system: s.systems[target].name });
}
