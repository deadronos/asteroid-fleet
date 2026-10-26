import { automation } from './automation';
// One fixed simulation step. Behaviour lives in mining.ts, combat.ts, world.ts
// and warp.ts; ctx.ts holds the per-tick lookups they share.

import { DT, HANGAR_TYPES, PIRATE_BASE } from './config';
import { fighter, pirateStep, repairDrone, scout, threats } from './combat';
import {
  buildCtx,
  destroyShip,
  dockRepair,
  goHome,
  card,
  nearestPirate,
  recalled,
  speed,
  stanceOf,
  type Ctx,
} from './ctx';
import {
  assignBargeBay,
  barge,
  boardBargeBay,
  carried,
  decayContainers,
  drone,
  dropContainer,
  harvester,
  hauler,
  haulerJob,
} from './mining';
import { copy, moveAway, onSphere, rand } from './math';
import { lvl } from './research';
import { bind, emit, maxHull } from './state';
import { carrierDisabled, executeJump, warpStep } from './warp';
import { drift, field, hazards, power, refine, reserves } from './world';
import type { GameState, Operation, Sim, Ship, ShipClass } from './types';

export { cargoCap, damageShip, SHIELD_HP } from './ctx';
export { cargoHeat, heatFactor, waveWarning } from './combat';
export { executeJump };

// ---------- main step ----------

/**
 * Advance the run clock by one step and play `op` through it. Only call this once per step:
 * with several carriers (#76) the clock moves here and the others go through `stepOp`.
 */
export function step(g: GameState, op: Operation, dt = DT) {
  g.time += dt;
  stepOp(bind(g, op), dt);
}

/** `step` for a single bound operation: headless runs, tests and benchmarks. */
export function stepSim(s: Sim, dt = DT) {
  s.time += dt;
  stepOp(s, dt);
}

/** One operation's share of a step. The run clock has already moved. */
export function stepOp(s: Sim, dt = DT) {
  const ctx = buildCtx(s);

  let live = 0;
  for (const f of s.fx) {
    f.ttl -= dt;
    if (f.ttl > 0) s.fx[live++] = f;
  }
  s.fx.length = live;

  power(s, dt, ctx);
  threats(s, dt);
  launch(s, dt, ctx);
  for (const ship of s.ships) {
    if (ship.mode === 'docked') {
      ship.pos.x = s.carrier.pos.x;
      ship.pos.y = s.carrier.pos.y;
      ship.pos.z = s.carrier.pos.z;
      const mh = maxHull(s, ship.cls);
      ship.hull = Math.min(mh, ship.hull + dockRepair(s, ctx, ship) * mh * dt);
      continue;
    }
    if (ship.mode === 'carried') {
      carried(s, ship, dt, ctx);
      continue;
    }
    behave(s, ship, dt, ctx);
  }
  pirateStep(s, dt, ctx);
  hazards(s, dt);
  refine(s, dt, ctx);
  field(s, dt);
  decayContainers(s, dt);
  reserves(s, dt, ctx);
  automation(s, dt);
  drift(s, dt);

  // cleanup: compact in place, keeping order
  let alive = 0;
  for (const sh of s.ships) {
    if (sh.hull > 0) s.ships[alive++] = sh;
    else {
      if (sh.cls === 'barge') dropContainer(s, sh);
      destroyShip(s, sh, 'destroyed');
    }
  }
  s.ships.length = alive;
  const tier = s.systems[s.systemId].tier;
  alive = 0;
  for (const p of s.pirates) {
    if (p.hull > 0) {
      s.pirates[alive++] = p;
      continue;
    }
    const salvage = Math.round(12 * tier * (p.maxHull / PIRATE_BASE.hull));
    s.credits += salvage;
    ctx.income += salvage;
    s.stats.piratesKilled++;
    s.fx.push({ kind: 'explosion', a: copy(p.pos), b: copy(p.pos), ttl: 0.8 });
  }
  s.pirates.length = alive;
  if (s.wave.active && s.pirates.length === 0) {
    s.wave.active = false;
    emit(s, 'WaveRepelled', {});
  }
  if (s.carrier.hull <= 0) carrierDisabled(s);

  s.stats.creditsEarned += ctx.income;
  const a = Math.min(1, dt / 120);
  s.incomeAvg = s.incomeAvg * (1 - a) + (ctx.income / dt) * a;
  s.miningIncomeAvg = s.miningIncomeAvg * (1 - a) + (ctx.mining / dt) * a;
  warpStep(s, dt);
}

// ---------- launching ----------

function wantsLaunch(s: Sim, ship: Ship, ctx: Ctx): boolean {
  if (recalled(ctx, ship)) return false;
  const mh = maxHull(s, ship.cls);
  if (ship.hull < mh * 0.9) return false;
  const sys = s.systems[s.systemId];
  switch (ship.cls) {
    case 'barge':
      // Barges launch only once the zone is secured.
      return s.pirates.length === 0;
    case 'hauler':
      return (
        !card(s, ctx, 'park', ship) || haulerJob(s, ship, ctx) !== null || s.containers.length > 0
      );
    case 'harvester':
      return sys.gasGiant && lvl(s, 'fusion') > 0 && s.pirates.length === 0;
    case 'repair':
      return s.ships.some((x) => x.mode !== 'docked' && x.hull < maxHull(s, x.cls) * 0.85);
    default:
      return true;
  }
}

function launch(s: Sim, dt: number, ctx: Ctx) {
  // Launches wait while the pool cannot pay upkeep; the timers keep running.
  const hold = ctx.powerShort;
  for (const h of s.hangars) {
    h.launchTimer -= dt;
    if (h.launchTimer > 0 || hold) continue;
    const docked = h.items
      .map((it) => ctx.ships.get(it.shipId))
      .filter((x): x is Ship => !!x && x.mode === 'docked');
    if (!docked.length) continue;
    const rank = (c: ShipClass) => {
      const i = h.launchOrder.indexOf(c);
      return i < 0 ? 99 : i;
    };
    docked.sort((a, b) => rank(a.cls) - rank(b.cls));
    const next = docked.find((x) => wantsLaunch(s, x, ctx));
    if (!next) continue;
    next.mode = 'idle';
    const off = onSphere(() => rand(s), 3, 0.5);
    next.pos = {
      x: s.carrier.pos.x + off.x,
      y: s.carrier.pos.y + off.y,
      z: s.carrier.pos.z + off.z,
    };
    if (next.cls === 'barge') boardBargeBay(s, next);
    else assignBargeBay(s, next, ctx);
    h.launchTimer = HANGAR_TYPES[h.type].launchInterval;
  }
}

function behave(s: Sim, ship: Ship, dt: number, ctx: Ctx) {
  const st = stanceOf(s, ctx, ship);
  const mh = maxHull(s, ship.cls);

  const recall = recalled(ctx, ship);
  if (recall) ship.mode = 'recall';
  if (ship.mode === 'recall' || ship.mode === 'retreat') {
    if (!recall && ship.mode === 'recall') ship.mode = 'idle';
    else {
      goHome(s, ship, dt);
      return;
    }
  }
  // Power short (#60): ships between jobs stand down and dock, so upkeep shrinks
  // until the pool can pay it. Launches resume once it can.
  if (ctx.powerShort && ship.mode === 'idle' && ship.cargo === 0 && ship.h2 === 0) {
    ship.mode = 'retreat';
    goHome(s, ship, dt);
    return;
  }
  // Under-fire stances.
  if (st.underFire === 'retreatHull' && ship.hull < mh * st.retreatAt) {
    ship.mode = 'retreat';
    emit(s, 'ShipRetreating', { cls: ship.cls });
    return;
  }
  const threat = nearestPirate(s, ship.pos, ship.cls === 'fighter' ? 0 : 18);
  if (threat && st.underFire === 'retreatCargo' && ship.cargo > 0 && ship.cls !== 'barge') {
    ship.mode = 'toCarrier';
  }
  if (threat && st.engagement === 'passive' && ship.cls !== 'fighter') {
    moveAway(ship.pos, threat.pos, speed(s, ship) * dt);
    return;
  }

  if (card(s, ctx, 'fallBack', ship)) {
    ship.mode = 'retreat';
    if (ship.cls === 'barge') emit(s, 'BargeFallback', {});
    else emit(s, 'ShipRetreating', { cls: ship.cls });
    return;
  }
  switch (ship.cls) {
    case 'drone':
      return drone(s, ship, dt, ctx, st.mining);
    case 'barge':
      return barge(s, ship, dt, ctx, st.mining);
    case 'hauler':
      return hauler(s, ship, dt, ctx);
    case 'fighter':
      return fighter(s, ship, dt, ctx, st.engagement);
    case 'scout':
      return scout(s, ship, dt, ctx);
    case 'repair':
      return repairDrone(s, ship, dt, ctx);
    case 'harvester':
      return harvester(s, ship, dt, ctx);
  }
}
