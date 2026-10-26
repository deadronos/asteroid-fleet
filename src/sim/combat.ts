// Combat: fighters, scouts, repair drones, pirate waves and pirate AI.

import {
  CARRIER_SENSOR,
  GAS_PIRATE_HARVESTER_BIAS,
  PIRATE_BASE,
  SHIP_STATS,
  SURVEY_RADIUS,
  VEIN_SCAN_RADIUS,
  VEIN_VALUE_SHARE,
  WAVE_INTERVAL,
  WAVE_WARNING,
} from './config';
import {
  CARRIER,
  cargoCap,
  damageCarrier,
  damageShip,
  fighterDamage,
  goHome,
  nearestPirate,
  speed,
  type Ctx,
} from './ctx';
import { copy, dist, dist2, moveToward, rand, randRange, seeded } from './math';
import { lvl } from './research';
import { clusterCenters, emit, maxHull } from './state';
import type { Sim, Pirate, Ship, Vec3 } from './types';

export function cargoHeat(s: Sim): number {
  let v = s.carrier.oreValue;
  for (const sh of s.ships) if (sh.mode !== 'docked') v += sh.cargoValue;
  return v;
}

export function heatFactor(s: Sim): number {
  const tier = s.systems[s.systemId].tier;
  return 1 + Math.min(2, cargoHeat(s) / (2500 * tier));
}

export function waveWarning(s: Sim): number {
  let scouts = 0;
  for (const x of s.ships) if (x.cls === 'scout' && x.mode !== 'docked') scouts++;
  return WAVE_WARNING + (lvl(s, 'scoutRelay') > 0 ? 10 * scouts : 0);
}

function fighterTarget(s: Sim, ship: Ship, ctx: Ctx, engagement: string): Pirate | null {
  const sensor = SHIP_STATS.fighter.sensor;
  if (engagement === 'passive') return null;
  if (engagement === 'aggressive')
    return nearestPirate(s, ship.pos, sensor) ?? nearestPirate(s, s.carrier.pos, sensor * 1.5);
  if (engagement === 'escort') {
    const ward = ctx.ships.get(ship.escortId);
    const anchor = ward ? ward.pos : s.carrier.pos;
    let best: Pirate | null = null;
    let bd = Infinity;
    for (const p of s.pirates) {
      const d = dist(p.pos, anchor);
      if ((p.targetId === ship.escortId && d < 40) || d < 18) {
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    return best;
  }
  // defensive: hostiles attacking own ships, or close to the carrier
  let best: Pirate | null = null;
  let bd = Infinity;
  for (const p of s.pirates) {
    const victim = p.targetId === CARRIER ? s.carrier.pos : ctx.ships.get(p.targetId)?.pos;
    const engaged = victim && dist(p.pos, victim) < 20;
    const nearCarrier = dist(p.pos, s.carrier.pos) < CARRIER_SENSOR;
    if (!engaged && !nearCarrier) continue;
    const d = dist(p.pos, ship.pos);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function pickWard(ctx: Ctx): number {
  let best = -1;
  let bs = -Infinity;
  for (const w of ctx.wards) {
    if (w.mode === 'docked') continue;
    const n = ctx.escorts.get(w.id) ?? 0;
    const score = (w.cls === 'barge' ? 3 : 1) + w.cargo / 200 - n * 2.5;
    if (score > bs) {
      bs = score;
      best = w.id;
    }
  }
  return best;
}

function orbit(p: Vec3, c: Vec3, r: number, t: number, phase: number, step: number) {
  const a = t * 0.35 + phase;
  moveToward(
    p,
    { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a * 0.7) * 2, z: c.z + Math.sin(a) * r },
    step,
  );
}

export function fighter(s: Sim, ship: Ship, dt: number, ctx: Ctx, engagement: string) {
  const v = speed(s, ship) * dt;
  if (engagement === 'escort') {
    const ward = ctx.ships.get(ship.escortId);
    if (!ward || ward.mode === 'docked') {
      const prev = ship.escortId;
      if (prev >= 0) ctx.escorts.set(prev, Math.max(0, (ctx.escorts.get(prev) ?? 1) - 1));
      ship.escortId = pickWard(ctx);
      if (ship.escortId >= 0)
        ctx.escorts.set(ship.escortId, (ctx.escorts.get(ship.escortId) ?? 0) + 1);
    }
  } else ship.escortId = -1;

  const target = fighterTarget(s, ship, ctx, engagement);
  ship.fireCooldown -= dt;
  if (target) {
    ship.mode = 'attack';
    ship.targetId = target.id;
    const range = SHIP_STATS.fighter.range * (1 + 0.2 * lvl(s, 'fighterRange'));
    moveToward(ship.pos, target.pos, v, range * 0.7);
    if (dist(ship.pos, target.pos) <= range) {
      target.hull -= fighterDamage(s, ctx, ship) * dt;
      if (ship.fireCooldown <= 0) {
        s.fx.push({ kind: 'laser', a: copy(ship.pos), b: copy(target.pos), ttl: 0.15 });
        ship.fireCooldown = 0.35;
      }
    }
    return;
  }
  ship.targetId = -1;
  const ward = ctx.ships.get(ship.escortId);
  if (engagement === 'escort' && ward) {
    ship.mode = 'escort';
    orbit(ship.pos, ward.pos, 5, s.time, ship.id, v);
  } else if (engagement === 'aggressive') {
    ship.mode = 'patrol';
    orbit(ship.pos, s.carrier.pos, 32, s.time * 0.5, ship.id, v);
  } else {
    ship.mode = 'patrol';
    orbit(ship.pos, s.carrier.pos, 12, s.time, ship.id, v);
  }
}

/**
 * Scouts survey asteroid clusters one by one, marking rich veins for drones,
 * and chart every hazard that comes within sensor range. Once the whole
 * system is surveyed they patrol and start a fresh sweep, so respawned rocks
 * get scanned too.
 */
export function scout(s: Sim, ship: Ship, dt: number, ctx: Ctx) {
  const r = s.recon;
  const sensor2 = SHIP_STATS.scout.sensor * SHIP_STATS.scout.sensor;
  for (let i = 0; i < s.hazards.length; i++) {
    if (r.hazards.includes(i)) continue;
    const h = s.hazards[i];
    if (dist2(h.pos, ship.pos) < sensor2) {
      r.hazards.push(i);
      emit(s, 'HazardCharted', { hazard: h.kind });
    }
  }
  const centers = clusterCenters(s.systems[s.systemId]);
  let target = -1;
  let bd = Infinity;
  for (let i = 0; i < centers.length; i++) {
    if (r.clusters.includes(i)) continue;
    // Other scouts' targets are left to them.
    if (ctx.byClass.scout.some((o) => o !== ship && o.targetId === i && o.mode === 'toAsteroid'))
      continue;
    const d = dist2(ship.pos, centers[i]);
    if (d < bd) {
      bd = d;
      target = i;
    }
  }
  const v = speed(s, ship) * dt;
  if (target < 0) {
    ship.mode = 'patrol';
    ship.targetId = -1;
    orbit(ship.pos, s.carrier.pos, 75, s.time * 0.15, ship.id * 1.7, v);
    // A full lap later, sweep again.
    if (r.clusters.length >= centers.length && Math.floor(s.time * 10) % 600 === ship.id % 600)
      r.clusters.length = 0;
    return;
  }
  ship.mode = 'toAsteroid';
  ship.targetId = target;
  if (moveToward(ship.pos, centers[target], v, SURVEY_RADIUS)) surveyCluster(s, target, ctx);
}

/** Mark cluster `i` surveyed and its rich rocks as veins. */
export function surveyCluster(s: Sim, i: number, ctx: Ctx) {
  const r = s.recon;
  if (!r.clusters.includes(i)) r.clusters.push(i);
  const c = clusterCenters(s.systems[s.systemId])[i];
  // Drop veins whose rock was mined out and replaced.
  r.veins = r.veins.filter((id) => ctx.asteroids.has(id));
  const rich = ctx.maxValue * VEIN_VALUE_SHARE;
  const r2 = VEIN_SCAN_RADIUS * VEIN_SCAN_RADIUS;
  let found = 0;
  for (const a of s.asteroids) {
    if (a.ore <= 0 || a.value < rich || dist2(a.pos, c) > r2 || r.veins.includes(a.id)) continue;
    r.veins.push(a.id);
    ctx.veins.add(a.id);
    found++;
  }
  if (found > 0) emit(s, 'VeinFound', { veins: found });
}

export function repairDrone(s: Sim, ship: Ship, dt: number, ctx: Ctx) {
  const v = speed(s, ship) * dt;
  let patient = ctx.ships.get(ship.targetId);
  if (!patient || patient.mode === 'docked' || patient.hull >= maxHull(s, patient.cls) * 0.98) {
    patient = undefined;
    let worst = 0.85;
    for (const o of ctx.ships.values()) {
      if (o.id === ship.id || o.mode === 'docked') continue;
      let frac = o.hull / maxHull(s, o.cls);
      if (o.cls === 'barge' || o.cls === 'fighter') frac -= 0.1;
      if (frac < worst) {
        worst = frac;
        patient = o;
      }
    }
    ship.targetId = patient ? patient.id : -1;
  }
  if (!patient) {
    goHome(s, ship, dt);
    return;
  }
  ship.mode = 'repairing';
  const range = SHIP_STATS.repair.range;
  moveToward(ship.pos, patient.pos, v, range * 0.6);
  const heal = 7 * (1 + 0.3 * lvl(s, 'repair')) * (1 + 0.25 * lvl(s, 'repairBeam')) * dt;
  const nano = lvl(s, 'repairNano') > 0;
  if (nano) {
    for (const o of ctx.ships.values()) {
      if (o.mode === 'docked' || dist(o.pos, ship.pos) > range) continue;
      o.hull = Math.min(maxHull(s, o.cls), o.hull + heal);
    }
  } else if (dist(patient.pos, ship.pos) <= range) {
    patient.hull = Math.min(maxHull(s, patient.cls), patient.hull + heal);
  }
  ship.fireCooldown -= dt;
  if (ship.fireCooldown <= 0 && dist(patient.pos, ship.pos) <= range) {
    s.fx.push({ kind: 'repair', a: copy(ship.pos), b: copy(patient.pos), ttl: 0.3 });
    ship.fireCooldown = 0.5;
  }
}

export function threats(s: Sim, dt: number) {
  const sys = s.systems[s.systemId];
  if (sys.tier === 1) return;
  const w = s.wave;
  w.timer -= dt;
  const warn = waveWarning(s);
  if (!w.warning && w.timer <= warn) {
    w.warning = true;
    w.size = Math.max(1, Math.round((1 + sys.distance * 0.7 + (sys.tier - 2) * 2) * heatFactor(s)));
    emit(s, 'PirateWaveIncoming', { size: w.size, eta: Math.ceil(w.timer) });
  }
  if (w.timer <= 0) {
    w.warning = false;
    w.active = true;
    const r = seeded(s.rng ^ 0x77);
    const a = r() * Math.PI * 2;
    const scale = 1 + sys.distance * 0.25;
    for (let i = 0; i < w.size; i++) {
      const pos = {
        x: s.carrier.pos.x + Math.cos(a) * 110 + randRange(s, -10, 10),
        y: randRange(s, -6, 6),
        z: s.carrier.pos.z + Math.sin(a) * 110 + randRange(s, -10, 10),
      };
      s.pirates.push({
        id: s.nextId++,
        pos,
        hull: PIRATE_BASE.hull * scale,
        maxHull: PIRATE_BASE.hull * scale,
        damage: PIRATE_BASE.damage * (1 + sys.distance * 0.15),
        speed: PIRATE_BASE.speed,
        targetId: -1,
        fireCooldown: 0,
      });
    }
    emit(s, 'PiratesArrived', { size: w.size });
    w.timer = WAVE_INTERVAL(sys.tier) * randRange(s, 0.8, 1.2);
  }
  // Solar storms in the frontier and beyond; H2 storms at gas giants.
  const st = s.storm;
  if (st.active > 0) {
    st.active -= dt;
    if (st.active <= 0) emit(s, 'StormPassed', { h2: s.systems[s.systemId].gasGiant });
  } else {
    st.timer -= dt;
    if (st.timer <= 0) {
      st.active = 20;
      st.timer = randRange(s, 120, 220);
      emit(s, 'StormStarted', { h2: s.systems[s.systemId].gasGiant });
    }
  }
}

/** Gas giant pirates hunt harvesters: H2 is easy to fence. */
function gasGiantTargetBias(s: Sim, sh: Ship): number {
  if (sh.cls !== 'harvester' || !s.systems[s.systemId].gasGiant) return 1;
  return GAS_PIRATE_HARVESTER_BIAS;
}

export function pirateTargetScore(s: Sim, sh: Ship): number {
  if (sh.mode === 'docked') return 0;
  return baseTargetScore(s, sh) * gasGiantTargetBias(s, sh);
}

function baseTargetScore(s: Sim, sh: Ship): number {
  if (sh.cls === 'barge') return 4 + (sh.cargo / cargoCap(s, 'barge', sh)) * 6; // full barges first
  if (sh.cls === 'hauler' || sh.cls === 'harvester') return 2 + sh.cargo / 60;
  if (sh.cls === 'fighter') return 1.5;
  return 1;
}

export function pirateStep(s: Sim, dt: number, ctx: Ctx) {
  for (const p of s.pirates) {
    let tgtPos: Vec3 | null =
      p.targetId === CARRIER ? s.carrier.pos : (ctx.ships.get(p.targetId)?.pos ?? null);
    const t = ctx.ships.get(p.targetId);
    if (!tgtPos || (t && t.mode === 'docked') || rand(s) < dt / 3) {
      let best = CARRIER;
      let bs = 0.6 / (dist(p.pos, s.carrier.pos) + 30);
      for (const sh of ctx.ships.values()) {
        const sc = pirateTargetScore(s, sh);
        if (sc <= 0) continue;
        const v = sc / (dist(p.pos, sh.pos) + 30);
        if (v > bs) {
          bs = v;
          best = sh.id;
        }
      }
      p.targetId = best;
      tgtPos = best === CARRIER ? s.carrier.pos : ctx.ships.get(best)!.pos;
    }
    const range = p.targetId === CARRIER ? 12 : 7;
    moveToward(p.pos, tgtPos, p.speed * dt, range * 0.8);
    p.fireCooldown -= dt;
    if (dist(p.pos, tgtPos) <= range) {
      const dmg = p.damage * dt;
      if (p.targetId === CARRIER) damageCarrier(s, dmg);
      else {
        const victim = ctx.ships.get(p.targetId);
        if (victim) damageShip(s, victim, dmg);
      }
      if (p.fireCooldown <= 0) {
        s.fx.push({ kind: 'pirateLaser', a: copy(p.pos), b: copy(tgtPos), ttl: 0.15 });
        p.fireCooldown = 0.5;
      }
    }
  }
}
