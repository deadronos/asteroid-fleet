// Carrier systems and the environment: power, refining, hazards, the asteroid
// field, reserve rebuilds and carrier drift.

import {
  COVER_RADIUS,
  H2_STORM_DPS,
  H2_STORM_RADIUS,
  DT,
  FUSION_H2,
  FUSION_RATE,
  REFINE_ENERGY,
  HULLS,
} from './config';
import { SHIELD_HP, card, damageShip, inHazard, type Ctx } from './ctx';
import { oreNear } from './mining';
import { dist, dist2, moveToward, rand } from './math';
import { lvl, reserveDefs } from './research';
import {
  clusterCenters,
  createShip,
  gasGiantPos,
  h2Storm,
  emit,
  jumpCost,
  maxEnergy,
  refineThroughput,
  solarRate,
  spawnAsteroid,
  stateOf,
  upkeepRate,
} from './state';
import type { Sim, Vec3 } from './types';

export function power(s: Sim, dt: number, ctx: Ctx) {
  const c = s.carrier;
  const max = maxEnergy(s);
  let gain = solarRate(s) * (s.storm.active > 0 && !h2Storm(s) ? 1.6 : 1);
  if (lvl(s, 'fusion') > 0 && c.h2 > 0 && c.energy < max) {
    const burn = Math.min(c.h2, FUSION_H2 * dt);
    c.h2 -= burn;
    gain += FUSION_RATE * (burn / (FUSION_H2 * dt));
  }
  c.energy = Math.min(max, c.energy + gain * dt);
  // Upkeep is paid before shields and refining. Soft floor: what the pool cannot
  // cover is waived, and `powerShort` holds launches and docks returning ships.
  const due = upkeepRate(s) * dt;
  ctx.powerShort = c.energy < due;
  c.energy = Math.max(0, c.energy - due);
  // Shield regen costs energy; when the pool is empty the shields stay down.
  if (c.shield < 1 && c.energy > 0) {
    const mult = s.powerMode === 'defense' ? 2 : s.powerMode === 'income' ? 0.5 : 1;
    const regen = Math.min(
      1 - c.shield,
      0.03 * HULLS[c.hullClass].shield * (1 + 0.1 * lvl(s, 'reactor')) * mult * dt,
    );
    const cost = regen * SHIELD_HP * 0.4;
    if (c.energy >= cost) {
      c.energy -= cost;
      c.shield += regen;
    }
  }
}

export function refine(s: Sim, dt: number, ctx: Ctx) {
  const c = s.carrier;
  if (c.ore <= 0) return;
  const max = maxEnergy(s);
  let floor = s.powerMode === 'defense' ? 0.5 * max : s.powerMode === 'balanced' ? 0.15 * max : 0;
  if (card(s, ctx, 'reserveWarp', null)) {
    const sys = s.systems[s.systemId];
    floor = Math.max(floor, jumpCost(s, sys.distance, Math.max(0, sys.distance - 1)));
  }
  const avail = Math.max(0, c.energy - floor);
  const amount = Math.min(c.ore, refineThroughput(s) * dt, avail / REFINE_ENERGY);
  if (amount <= 0) return;
  const value = (c.oreValue / c.ore) * amount;
  c.ore -= amount;
  c.oreValue -= value;
  if (c.ore < 1e-6) {
    c.ore = 0;
    c.oreValue = 0;
  }
  c.energy -= amount * REFINE_ENERGY;
  s.credits += value;
  ctx.income += value;
  ctx.mining += value;
}

export function hazards(s: Sim, dt: number) {
  const shield = 1 - 0.3 * lvl(s, 'stormShielding');
  const h2 = h2Storm(s);
  const solarStorm = s.storm.active > 0 && !h2;
  const gas = h2 ? gasGiantPos(s.systems[s.systemId]) : null;
  for (const sh of s.ships) {
    if (sh.mode === 'docked') continue;
    for (const h of s.hazards)
      if (dist2(h.pos, sh.pos) < h.radius * h.radius) damageShip(s, sh, h.dps * dt);
    if (solarStorm && dist(sh.pos, s.carrier.pos) > COVER_RADIUS)
      damageShip(s, sh, 0.6 * shield * dt);
    if (h2 && dist(sh.pos, gas!) < H2_STORM_RADIUS) damageShip(s, sh, H2_STORM_DPS * shield * dt);
  }
}

// ---------- field, reserves, carrier ----------

export function field(s: Sim, dt: number) {
  // Carriers sharing a field (#176) must not each tick it: the first one holding it does.
  const first = stateOf(s).ops.find((op) => op.asteroids === s.asteroids);
  if (first && first.id !== s.id) return;
  const sys = s.systems[s.systemId];
  let scouts = -1;
  let centers: Vec3[] | null = null;
  for (let i = 0; i < s.asteroids.length; i++) {
    const a = s.asteroids[i];
    if (a.ore > 0 || a.respawn <= 0) continue;
    a.respawn -= dt;
    if (a.respawn <= 0) {
      if (scouts < 0) {
        scouts = 0;
        for (const x of s.ships) if (x.cls === 'scout' && x.mode !== 'docked') scouts++;
      }
      centers ??= clusterCenters(sys);
      const c = centers[Math.floor(rand(s) * centers.length)];
      const fresh = spawnAsteroid(
        s,
        () => rand(s),
        c,
        sys,
        Math.min(0.3, scouts * 0.06 * (1 + 0.5 * lvl(s, 'scoutSurvey'))),
      );
      s.asteroids[i] = fresh;
    }
  }
}

export function reserves(s: Sim, dt: number, ctx: Ctx) {
  const defs = reserveDefs(s);
  for (const [cls, min, cooldown] of defs) {
    if (min <= 0 || !s.unlocked.includes(cls)) continue;
    const n = ctx.byClass[cls].length;
    if (n >= min) {
      s.reserveTimers[cls] = cooldown;
      continue;
    }
    const t = (s.reserveTimers[cls] ?? cooldown) - dt;
    s.reserveTimers[cls] = t;
    if (t <= 0) {
      if (createShip(s, cls)) {
        emit(s, 'ReserveRebuilt', { cls });
        // The free reserve covered this loss; do not also pay for it.
        const q = s.rebuildQueue;
        const i = q.findIndex((x) => x.cls === cls);
        if (i >= 0) q.splice(i, 1);
      }
      s.reserveTimers[cls] = cooldown;
    }
  }
}

export function drift(s: Sim, dt: number) {
  // Hold still while the warp charges, so recalled ships aren't chasing the carrier.
  if (s.warp) return;
  const c = s.carrier;
  if (c.stance === 'followRich' && (!c.target || Math.round(s.time / DT) % 300 === 0)) {
    let best: Vec3 | null = null;
    let bv = 0;
    for (const cc of clusterCenters(s.systems[s.systemId])) {
      if (inHazard(s, cc)) continue;
      const v = oreNear(s, cc, 14) / (dist(cc, c.pos) + 30);
      if (v > bv) {
        bv = v;
        best = cc;
      }
    }
    if (best) {
      // park just short of the cluster so it sits inside carrier cover
      const d = dist(best, c.pos) || 1;
      const f = Math.max(0, (d - 22) / d);
      c.target = { x: c.pos.x + (best.x - c.pos.x) * f, y: 0, z: c.pos.z + (best.z - c.pos.z) * f };
    } else c.target = null;
  }
  if (c.stance === 'hold') c.target = null;
  if (c.target && c.energy > maxEnergy(s) * 0.1) {
    if (!moveToward(c.pos, c.target, 1.2 * (1 + 0.2 * lvl(s, 'sublight')) * dt)) c.energy -= 1 * dt;
  }
}
