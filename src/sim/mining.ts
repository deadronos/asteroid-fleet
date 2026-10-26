// Mining and logistics: drones, barges, haulers and gas harvesters.

import { DOCK_RADIUS, DRILL_VALUE, H2_STORM_YIELD, LASER_RATE, VEIN_BONUS } from './config';
import {
  CARRIER,
  cargoCap,
  covered,
  goHome,
  inHazard,
  miningRate,
  modCount,
  nearestPirate,
  speed,
  transfer,
  unloadAtCarrier,
  type Ctx,
} from './ctx';
import { rule } from './doctrine';
import { dist, dist2, moveToward, rand } from './math';
import { lvl } from './research';
import { clusterCenters, emit, gasGiantPos, h2Storm, maxHull } from './state';
import type { Asteroid, Container, GameState, Ship, Vec3 } from './types';

/** Drones a barge's drone bay holds per `bargeBay` level. */
export const BARGE_BAY_SLOTS = 1;
/** Share of a destroyed barge's cargo that survives as a salvage container. */
export const CONTAINER_SHARE = 0.5;
/** Seconds a salvage container lasts before it decays. */
export const CONTAINER_TTL = 90;

export function bargeBaySlots(s: GameState): number {
  return BARGE_BAY_SLOTS * lvl(s, 'bargeBay');
}

function bayFree(s: GameState, b: Ship): number {
  let aboard = 0;
  for (const x of s.ships) if (x.cls === 'drone' && x.bargeId === b.id) aboard++;
  return bargeBaySlots(s) - aboard;
}

/** Board docked drones onto a barge that is launching, while its bay has room. */
export function boardBargeBay(s: GameState, b: Ship) {
  let free = bayFree(s, b);
  for (const d of s.ships) {
    if (free <= 0) return;
    if (d.cls !== 'drone' || d.mode !== 'docked' || d.hull < maxHull(s, 'drone') * 0.9) continue;
    d.mode = 'carried';
    d.bargeId = b.id;
    d.pos = { ...b.pos };
    free--;
  }
}

/** A drone launching from the carrier makes a parked barge with a free bay its base. */
export function assignBargeBay(s: GameState, d: Ship, ctx: Ctx) {
  if (d.cls !== 'drone' || bargeBaySlots(s) <= 0) return;
  for (const b of ctx.byClass.barge) {
    if (b.mode === 'station' && bayFree(s, b) > 0) {
      d.bargeId = b.id;
      return;
    }
  }
}

/**
 * A drone in a barge's bay rides along, repairs, launches once the barge is
 * on station and docks at the carrier with it.
 */
export function carried(s: GameState, ship: Ship, dt: number, ctx: Ctx) {
  const b = ctx.ships.get(ship.bargeId);
  if (!b || b.hull <= 0) {
    ship.bargeId = -1;
    ship.mode = 'idle';
    return;
  }
  ship.pos.x = b.pos.x;
  ship.pos.y = b.pos.y;
  ship.pos.z = b.pos.z;
  if (b.mode === 'docked') {
    ship.bargeId = -1;
    ship.mode = 'docked';
    ship.pos = { ...s.carrier.pos };
    return;
  }
  const mh = maxHull(s, 'drone');
  ship.hull = Math.min(mh, ship.hull + 0.05 * mh * dt);
  if (b.mode === 'station' && ship.hull >= mh * 0.9) ship.mode = 'idle';
}

/** The drone's barge, while that barge is parked on station. */
function bayBarge(ship: Ship, ctx: Ctx): Ship | null {
  if (ship.bargeId < 0) return null;
  const b = ctx.ships.get(ship.bargeId);
  if (!b || b.hull <= 0 || b.mode === 'docked') {
    ship.bargeId = -1;
    return null;
  }
  return b.mode === 'station' ? b : null;
}

/** Drop part of a destroyed barge's cargo as a salvage container. */
export function dropContainer(s: GameState, b: Ship) {
  if (b.cargo <= 0) return;
  s.containers.push({
    id: s.nextId++,
    pos: { ...b.pos },
    cargo: b.cargo * CONTAINER_SHARE,
    cargoValue: b.cargoValue * CONTAINER_SHARE,
    ttl: CONTAINER_TTL,
  });
  emit(s, 'BargeWrecked', {});
}

export function decayContainers(s: GameState, dt: number) {
  let live = 0;
  for (const c of s.containers) {
    c.ttl -= dt;
    if (c.ttl > 0 && c.cargo > 1e-6) s.containers[live++] = c;
  }
  s.containers.length = live;
}

function salvageJob(s: GameState, ship: Ship): Container | null {
  let best: Container | null = null;
  let bd = Infinity;
  for (const c of s.containers) {
    const claimed = s.ships.some(
      (x) => x !== ship && x.cls === 'hauler' && x.mode === 'toDropoff' && x.targetId === c.id,
    );
    if (claimed) continue;
    const d = dist2(ship.pos, c.pos);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/**
 * Best asteroid for a drone. Walks the asteroid grid outward from the drone
 * and stops once no farther asteroid could beat the best score, so the result
 * (ties broken by array order) matches a full scan.
 */
function pickAsteroid(
  s: GameState,
  ship: Ship,
  ctx: Ctx,
  mining: 'greedy' | 'safe',
): Asteroid | null {
  const list = s.asteroids;
  // A revealed vein can score up to VEIN_BONUS times its value; keep the prune bound safe.
  const maxV = ctx.maxValue * (ctx.veins.size > 0 ? VEIN_BONUS : 1);
  const charted = s.recon.hazards;
  let best = -1;
  let bestScore = -Infinity;
  ctx.asteroidGrid.rings(
    ship.pos,
    (d) => (mining === 'safe' ? maxV / (d + 8) : (maxV * maxV) / (d + 25)) >= bestScore,
    (i) => {
      const a = list[i];
      if (a.ore <= 0) return;
      const crowd = ctx.miners.get(a.id) ?? 0;
      if (crowd >= 3) return;
      const d = dist(ship.pos, a.pos);
      const v = ctx.veins.has(a.id) ? a.value * VEIN_BONUS : a.value;
      let score: number;
      if (mining === 'safe') {
        score = v / (d + 8) - crowd * 0.05;
        // Cheap score check first; hazard and cover are the expensive part.
        if (score < bestScore || (score === bestScore && i > best)) return;
        if (inHazard(s, a.pos) || !covered(s, a.pos, ctx)) return;
      } else {
        score = (v * v) / (d + 25) - crowd * 0.2;
        // Greedy drones still steer clear of hazards a scout has charted.
        if (score < bestScore || (score === bestScore && i > best)) return;
        if (charted.length > 0 && inChartedHazard(s, a.pos)) return;
      }
      if (score > bestScore || (score === bestScore && i < best)) {
        bestScore = score;
        best = i;
      }
    },
  );
  return best < 0 ? null : list[best];
}

function inChartedHazard(s: GameState, p: Vec3): boolean {
  for (const i of s.recon.hazards) {
    const h = s.hazards[i];
    if (h && dist2(h.pos, p) < h.radius * h.radius) return true;
  }
  return false;
}

function bestDropoff(s: GameState, ship: Ship, ctx: Ctx): Ship | null {
  const bay = bayBarge(ship, ctx);
  if (bay && bay.cargo < cargoCap(s, 'barge', bay) - 1) return bay;
  const r = rule(s, 'droneUnloadAtBarge');
  if (!r) return null;
  if (dist(ship.pos, s.carrier.pos) <= r.param) return null;
  let best: Ship | null = null;
  let bd = dist(ship.pos, s.carrier.pos);
  for (const b of ctx.byClass.barge) {
    if (b.mode !== 'station') continue;
    if (b.cargo >= cargoCap(s, 'barge', b) - 1) continue;
    const d = dist(ship.pos, b.pos);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

export function drone(s: GameState, ship: Ship, dt: number, ctx: Ctx, mining: 'greedy' | 'safe') {
  const cap = cargoCap(s, 'drone', ship);
  const v = speed(s, ship) * dt;
  if (ship.mode === 'toCarrier' || ship.mode === 'toDropoff' || ship.cargo >= cap - 1e-6) {
    if (ship.mode !== 'toDropoff' && ship.mode !== 'toCarrier') {
      const b = bestDropoff(s, ship, ctx);
      ship.mode = b ? 'toDropoff' : 'toCarrier';
      ship.targetId = b ? b.id : CARRIER;
    }
    if (ship.mode === 'toDropoff') {
      const b = ctx.ships.get(ship.targetId);
      if (!b || b.mode !== 'station' || b.cargo >= cargoCap(s, 'barge', b) - 1) {
        ship.mode = 'toCarrier';
        ship.targetId = CARRIER;
        return;
      }
      if (moveToward(ship.pos, b.pos, v, 2.5)) {
        transfer(ship, b, cargoCap(s, 'barge', b));
        if (ship.cargo === 0) ship.mode = 'idle';
      }
      return;
    }
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS * 0.6)) {
      if (unloadAtCarrier(s, ship)) ship.mode = 'idle';
    }
    return;
  }
  let a = ctx.asteroids.get(ship.targetId);
  if (ship.mode === 'idle' || !a || a.ore <= 0) {
    a = pickAsteroid(s, ship, ctx, mining) ?? undefined;
    if (!a) {
      const bay = bayBarge(ship, ctx);
      if (ship.cargo > 0) ship.mode = 'toCarrier';
      else if (bay) {
        // Dock in the barge's bay instead of flying back to the carrier.
        if (moveToward(ship.pos, bay.pos, speed(s, ship) * dt, 2)) ship.mode = 'carried';
      } else goHome(s, ship, dt);
      return;
    }
    ship.targetId = a.id;
    ship.mode = 'toAsteroid';
    ctx.miners.set(a.id, (ctx.miners.get(a.id) ?? 0) + 1);
  }
  if (ship.mode === 'toAsteroid') {
    if (moveToward(ship.pos, a.pos, v, a.radius + 1)) ship.mode = 'mining';
    return;
  }
  if (ship.mode === 'mining') {
    const amt = Math.min(a.ore, miningRate(s, ctx, ship) * dt, cap - ship.cargo);
    a.ore -= amt;
    ship.cargo += amt;
    ship.cargoValue += amt * a.value * DRILL_VALUE ** modCount(ship, 'drill');
    if (a.ore <= 0) {
      a.ore = 0;
      a.respawn = 40 + rand(s) * 40;
      ship.mode = 'idle';
    }
    return;
  }
  ship.mode = 'idle';
}

export function oreNear(s: GameState, p: Vec3, r: number): number {
  let v = 0;
  const r2 = r * r;
  for (const a of s.asteroids) if (dist2(a.pos, p) < r2) v += a.ore * a.value;
  return v;
}

export function barge(s: GameState, ship: Ship, dt: number, ctx: Ctx, mining: 'greedy' | 'safe') {
  const cap = cargoCap(s, 'barge', ship);
  const v = speed(s, ship) * dt;
  if (rule(s, 'bargeFallBack') && nearestPirate(s, ship.pos, 28)) {
    ship.mode = 'retreat';
    emit(s, 'BargeFallback', {});
    return;
  }
  const haulersExist = ctx.byClass.hauler.length > 0;
  if (ship.mode === 'toCarrier' || (ship.cargo >= cap * 0.98 && !haulersExist)) {
    ship.mode = 'toCarrier';
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS)) {
      unloadAtCarrier(s, ship);
      ship.mode = 'idle';
    }
    return;
  }
  // Re-pick the station when it is unset or the local field has run dry.
  if (
    !ship.station ||
    (ship.mode === 'station' &&
      Math.floor(s.time * 10) % 50 === ship.id % 50 &&
      oreNear(s, ship.station, 14) < 200)
  ) {
    ship.station = pickStation(s, ship, ctx, mining);
    ship.mode = 'idle';
  }
  if (!ship.station) {
    if (ship.cargo > 0) ship.mode = 'toCarrier';
    else goHome(s, ship, dt);
    return;
  }
  if (ship.mode !== 'station') {
    if (moveToward(ship.pos, ship.station, v, 0.5)) ship.mode = 'station';
  }
}

function pickStation(s: GameState, ship: Ship, ctx: Ctx, mining: 'greedy' | 'safe'): Vec3 | null {
  let best: Vec3 | null = null;
  let bs = -Infinity;
  const others = ctx.byClass.barge.filter((x) => x.id !== ship.id && x.station);
  const sys = s.systems[s.systemId];
  for (const c of clusterCenters(sys)) {
    const d = dist(c, s.carrier.pos);
    if (mining === 'safe' && d > 55) continue;
    if (inHazard(s, c)) continue;
    if (others.some((o) => dist(o.station!, c) < 12)) continue;
    const value = oreNear(s, c, 14);
    if (value < 100) continue;
    const score = (mining === 'greedy' ? value : value / (d + 20)) * (covered(s, c, ctx) ? 1.2 : 1);
    if (score > bs) {
      bs = score;
      best = { x: c.x * 0.85, y: c.y, z: c.z * 0.85 };
    }
  }
  return best;
}

export function haulerJob(s: GameState, ship: Ship, ctx: Ctx): Ship | null {
  const r = rule(s, 'bargeCallHauler');
  const threshold = r ? r.param : 0.98;
  let best: Ship | null = null;
  let bf = 0;
  for (const b of ctx.byClass.barge) {
    if (b.mode !== 'station') continue;
    if (ctx.haulerClaims.has(b.id) && ship.targetId !== b.id) continue;
    const fill = b.cargo / cargoCap(s, 'barge', b);
    if (fill >= threshold && fill > bf) {
      bf = fill;
      best = b;
    }
  }
  return best;
}

export function hauler(s: GameState, ship: Ship, dt: number, ctx: Ctx) {
  const cap = cargoCap(s, 'hauler', ship);
  const v = speed(s, ship) * dt;
  if (ship.mode === 'toCarrier') {
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS)) {
      if (unloadAtCarrier(s, ship)) ship.mode = 'idle';
    }
    return;
  }
  if (ship.mode === 'toBarge') {
    const b = ctx.ships.get(ship.targetId);
    if (!b || b.mode !== 'station') {
      ship.mode = ship.cargo > 0 ? 'toCarrier' : 'idle';
      return;
    }
    if (moveToward(ship.pos, b.pos, v, 2.5)) {
      transfer(b, ship, cap);
      ship.mode = 'toCarrier';
    }
    return;
  }
  if (ship.mode === 'toDropoff') {
    const c = s.containers.find((x) => x.id === ship.targetId);
    if (!c) {
      ship.mode = ship.cargo > 0 ? 'toCarrier' : 'idle';
      return;
    }
    if (moveToward(ship.pos, c.pos, v, 2.5)) {
      const amt = Math.min(c.cargo, cap - ship.cargo);
      const val = (c.cargoValue / c.cargo) * amt;
      ship.cargo += amt;
      ship.cargoValue += val;
      c.cargo -= amt;
      c.cargoValue -= val;
      ship.mode = 'toCarrier';
    }
    return;
  }
  const job = haulerJob(s, ship, ctx);
  if (job) {
    ship.mode = 'toBarge';
    ship.targetId = job.id;
    ctx.haulerClaims.add(job.id);
    return;
  }
  const wreck = ship.cargo < cap * 0.5 ? salvageJob(s, ship) : null;
  if (wreck) {
    ship.mode = 'toDropoff';
    ship.targetId = wreck.id;
    return;
  }
  if (ship.cargo > 0) {
    ship.mode = 'toCarrier';
    return;
  }
  if (rule(s, 'haulerPark')) goHome(s, ship, dt);
  else moveToward(ship.pos, s.carrier.pos, v, 8);
}

export function harvester(s: GameState, ship: Ship, dt: number) {
  const sys = s.systems[s.systemId];
  const v = speed(s, ship) * dt;
  if (!sys.gasGiant) {
    goHome(s, ship, dt);
    return;
  }
  const cap = cargoCap(s, 'harvester', ship);
  const storm = h2Storm(s);
  if (storm && rule(s, 'harvesterStormShelter')) {
    if (ship.h2 > 0) ship.mode = 'toCarrier';
    else {
      goHome(s, ship, dt);
      return;
    }
  }
  if (ship.h2 >= cap || ship.mode === 'toCarrier') {
    ship.mode = 'toCarrier';
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS)) {
      unloadAtCarrier(s, ship);
      ship.mode = 'idle';
    }
    return;
  }
  const g = gasGiantPos(sys);
  if (moveToward(ship.pos, g, v, 30)) {
    ship.mode = 'station';
    ship.h2 = Math.min(
      cap,
      ship.h2 + 1.2 * (storm ? H2_STORM_YIELD : 1) * LASER_RATE ** modCount(ship, 'laser') * dt,
    );
  } else ship.mode = 'toAsteroid';
}
