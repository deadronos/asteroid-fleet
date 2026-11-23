// Combat: fighters, scouts, repair drones, pirate waves and pirate AI.

import {
  AGGRESSIVE_CARRIER_SENSOR_MULT,
  AGGRESSIVE_ORBIT_RADIUS,
  CARRIER_SENSOR,
  HULLS,
  DEFENSIVE_VICTIM_RANGE,
  ESCORT_ATTACKER_RANGE,
  ESCORT_NEAR,
  ESCORT_ORBIT_RADIUS,
  FIGHTER_TRACKING,
  GAS_PIRATE_HARVESTER_BIAS,
  HEAT_CARGO_PER_TIER,
  HEAT_FACTOR_CAP,
  PATROL_ORBIT_RADIUS,
  PIRATE_BASE,
  PIRATE_DAMAGE_PER_DISTANCE,
  PIRATE_HULL_PER_DISTANCE,
  PIRATE_SPAWN_HEIGHT,
  PIRATE_SPAWN_JITTER,
  PIRATE_SPAWN_RADIUS,
  PIRATE_TYPES,
  SCOUT_ORBIT_RADIUS,
  STORM_DURATION,
  STORM_GAP,
  TURRET_DAMAGE_PER_LEVEL,
  TURRET_RANGE_PER_LEVEL,
  TURRETS,
  WAVE_BOMBER_CHANCE_DEEP,
  WAVE_BOMBER_CHANCE_FAR,
  WAVE_BOMBER_DISTANCE,
  WAVE_INTERCEPTOR_CHANCE,
  WAVE_INTERVAL_JITTER,
  WAVE_SIZE_BASE,
  WAVE_SIZE_PER_DISTANCE,
  WAVE_SIZE_PER_TIER,
  SHIP_STATS,
  type TurretMount,
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
import { clamp, copy, dist, dist2, moveToward, rand, randRange, seeded, shortestArc } from './math';
import {
  lvl,
  SCALE_COMBAT_FIGHTERRANGE,
  SCALE_COMBAT_WARNINGPERRELAY,
  SCALE_COMBAT_WARNINGPERSENSORS,
  SCALE_DEEP_SCAN,
  SCALE_REPAIR_BEAM,
  SCALE_REPAIR_FIELD,
} from './research';
import { clusterCenters, emit, isStowed, maxHull } from './state';
import type { Sim, Pirate, PirateKind, Ship, Vec3 } from './types';

/** Scout survey reach, widened by Deep scan research (#245). */
export const surveyRadius = (s: Sim) => SURVEY_RADIUS * (1 + SCALE_DEEP_SCAN * lvl(s, 'deepScan'));

/** Radius in which a surveyed cluster marks rich rocks as veins (#245). */
export const veinScanRadius = (s: Sim) =>
  VEIN_SCAN_RADIUS * (1 + SCALE_DEEP_SCAN * lvl(s, 'deepScan'));

export function cargoHeat(s: Sim): number {
  let v = s.carrier.oreValue;
  for (const sh of s.ships) if (sh.mode !== 'docked') v += sh.cargoValue;
  return v;
}

export function heatFactor(s: Sim): number {
  const tier = s.systems[s.systemId].tier;
  return 1 + Math.min(HEAT_FACTOR_CAP, cargoHeat(s) / (HEAT_CARGO_PER_TIER * tier));
}

/**
 * Whether a mount can bring its cone to bear on `to`. A cone of π covers every bearing;
 * otherwise the bearing to the target must fall within `arc` of `heading + mount.bearing` (#161).
 */
export function inFiringArc(
  heading: number,
  mount: Pick<TurretMount, 'bearing' | 'arc'>,
  from: Vec3,
  to: Vec3,
): boolean {
  if (mount.arc >= Math.PI) return true;
  const bearing = Math.atan2(to.x - from.x, to.z - from.z);
  return Math.abs(shortestArc(heading + mount.bearing, bearing)) <= mount.arc;
}

/** Floor below which even the best evasion cannot push a weapon's hit chance (#161). */
export const HIT_CHANCE_MIN = 0.15;

/** Expected fraction of a weapon's damage that lands: tracking minus target evasion (#161). */
export function hitChance(tracking: number, evasion: number): number {
  return clamp(0.5 + tracking - evasion, HIT_CHANCE_MIN, 1);
}

/** Pirates in the next wave: grows with system distance and tier, scaled by cargo heat. */
export function waveSize(s: Sim): number {
  const sys = s.systems[s.systemId];
  const base =
    WAVE_SIZE_BASE + sys.distance * WAVE_SIZE_PER_DISTANCE + (sys.tier - 2) * WAVE_SIZE_PER_TIER;
  return Math.max(1, Math.round(base * heatFactor(s)));
}

export function waveWarning(s: Sim): number {
  let scouts = 0;
  for (const x of s.ships) if (x.cls === 'scout' && x.mode !== 'docked') scouts++;
  return (
    WAVE_WARNING +
    SCALE_COMBAT_WARNINGPERSENSORS * lvl(s, 'sensors') +
    (lvl(s, 'scoutRelay') > 0 ? SCALE_COMBAT_WARNINGPERRELAY * scouts : 0)
  );
}

function fighterTarget(s: Sim, ship: Ship, ctx: Ctx, engagement: string): Pirate | null {
  const sensor = SHIP_STATS.fighter.sensor;
  if (engagement === 'passive') return null;
  if (engagement === 'aggressive')
    return (
      nearestPirate(s, ship.pos, sensor) ??
      nearestPirate(s, s.carrier.pos, sensor * AGGRESSIVE_CARRIER_SENSOR_MULT)
    );
  if (engagement === 'escort') {
    const ward = ctx.ships.get(ship.escortId);
    const anchor = ward ? ward.pos : s.carrier.pos;
    let best: Pirate | null = null;
    let bd = Infinity;
    for (const p of s.pirates) {
      const d = dist(p.pos, anchor);
      if ((p.targetId === ship.escortId && d < ESCORT_ATTACKER_RANGE) || d < ESCORT_NEAR) {
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
    const engaged = victim && dist(p.pos, victim) < DEFENSIVE_VICTIM_RANGE;
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
    {
      x: c.x + Math.cos(a) * r,
      y: c.y + Math.sin(a * 0.7) * 2,
      z: c.z + Math.sin(a) * r,
    },
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
    const range =
      SHIP_STATS.fighter.range * (1 + SCALE_COMBAT_FIGHTERRANGE * lvl(s, 'fighterRange'));
    moveToward(ship.pos, target.pos, v, range * 0.7);
    if (dist(ship.pos, target.pos) <= range) {
      const hc = hitChance(FIGHTER_TRACKING, PIRATE_TYPES[target.kind].evasion);
      target.hull -= fighterDamage(s, ctx, ship) * hc * dt;
      if (ship.fireCooldown <= 0) {
        s.fx.push({
          kind: 'laser',
          a: copy(ship.pos),
          b: copy(target.pos),
          ttl: 0.15,
        });
        ship.fireCooldown = 0.35;
      }
    }
    return;
  }
  ship.targetId = -1;
  const ward = ctx.ships.get(ship.escortId);
  if (engagement === 'escort' && ward) {
    ship.mode = 'escort';
    orbit(ship.pos, ward.pos, ESCORT_ORBIT_RADIUS, s.time, ship.id, v);
  } else if (engagement === 'aggressive') {
    ship.mode = 'patrol';
    orbit(ship.pos, s.carrier.pos, AGGRESSIVE_ORBIT_RADIUS, s.time * 0.5, ship.id, v);
  } else {
    ship.mode = 'patrol';
    orbit(ship.pos, s.carrier.pos, PATROL_ORBIT_RADIUS, s.time, ship.id, v);
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
    orbit(ship.pos, s.carrier.pos, SCOUT_ORBIT_RADIUS, s.time * 0.15, ship.id * 1.7, v);
    // A full lap later, sweep again.
    if (r.clusters.length >= centers.length && Math.floor(s.time * 10) % 600 === ship.id % 600)
      r.clusters.length = 0;
    return;
  }
  ship.mode = 'toAsteroid';
  ship.targetId = target;
  if (moveToward(ship.pos, centers[target], v, surveyRadius(s))) surveyCluster(s, target, ctx);
}

/** Mark cluster `i` surveyed and its rich rocks as veins. */
export function surveyCluster(s: Sim, i: number, ctx: Ctx) {
  const r = s.recon;
  if (!r.clusters.includes(i)) r.clusters.push(i);
  const c = clusterCenters(s.systems[s.systemId])[i];
  // Drop veins whose rock was mined out and replaced.
  r.veins = r.veins.filter((id) => ctx.asteroids.has(id));
  const rich = ctx.maxValue * VEIN_VALUE_SHARE;
  const scanR = veinScanRadius(s);
  const r2 = scanR * scanR;
  let found = 0;
  for (const a of s.asteroids) {
    if (a.ore <= 0 || a.value < rich || dist2(a.pos, c) > r2 || r.veins.includes(a.id)) continue;
    r.veins.push(a.id);
    ctx.veins.add(a.id);
    found++;
  }
  if (found > 0) emit(s, 'VeinFound', { veins: found });
}

function damagedShips(s: Sim, ctx: Ctx): readonly Ship[] {
  if (!ctx.damagedBuilt) {
    ctx.damagedBuilt = true;
    for (const o of s.ships) if (o.hull < maxHull(s, o.cls)) ctx.damaged.push(o);
  }
  return ctx.damaged;
}

export function repairDrone(s: Sim, ship: Ship, dt: number, ctx: Ctx) {
  const v = speed(s, ship) * dt;
  const damaged = damagedShips(s, ctx);
  let patient = ctx.ships.get(ship.targetId);
  if (!patient || isStowed(patient) || patient.hull >= maxHull(s, patient.cls) * 0.98) {
    patient = undefined;
    let worst = 0.85;
    for (const o of damaged) {
      if (o.id === ship.id || isStowed(o)) continue;
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
  const heal =
    7 *
    (1 + SCALE_REPAIR_FIELD * lvl(s, 'repair')) *
    (1 + SCALE_REPAIR_BEAM * lvl(s, 'repairBeam')) *
    dt;
  const nano = lvl(s, 'repairNano') > 0;
  if (nano) {
    for (const o of damaged) {
      if (isStowed(o) || dist(o.pos, ship.pos) > range) continue;
      o.hull = Math.min(maxHull(s, o.cls), o.hull + heal);
    }
  } else if (dist(patient.pos, ship.pos) <= range) {
    patient.hull = Math.min(maxHull(s, patient.cls), patient.hull + heal);
  }
  ship.fireCooldown -= dt;
  if (ship.fireCooldown <= 0 && dist(patient.pos, ship.pos) <= range) {
    s.fx.push({
      kind: 'repair',
      a: copy(ship.pos),
      b: copy(patient.pos),
      ttl: 0.3,
    });
    ship.fireCooldown = 0.5;
  }
}

/** One pirate's hull type, drawn from the run's rng; bombers need depth or distance (#161). */
function waveKind(s: Sim): PirateKind {
  const sys = s.systems[s.systemId];
  const bomber =
    sys.tier >= 3
      ? WAVE_BOMBER_CHANCE_DEEP
      : sys.distance >= WAVE_BOMBER_DISTANCE
        ? WAVE_BOMBER_CHANCE_FAR
        : 0;
  const r = rand(s);
  if (r < bomber) return 'bomber';
  if (r < bomber + WAVE_INTERCEPTOR_CHANCE) return 'interceptor';
  return 'gunship';
}

/** Spawn a mixed wave of `count` pirates around the carrier, drawing only from `rand(s)` (#161). */
export function spawnWave(s: Sim, count: number) {
  const sys = s.systems[s.systemId];
  const r = seeded(s.rng ^ 0x77);
  const a = r() * Math.PI * 2;
  const hullScale = 1 + sys.distance * PIRATE_HULL_PER_DISTANCE;
  const damageScale = 1 + sys.distance * PIRATE_DAMAGE_PER_DISTANCE;
  for (let i = 0; i < count; i++) {
    const kind = waveKind(s);
    const def = PIRATE_TYPES[kind];
    const hull = PIRATE_BASE.hull * def.hull * hullScale;
    s.pirates.push({
      id: s.nextId++,
      kind,
      pos: {
        x:
          s.carrier.pos.x +
          Math.cos(a) * PIRATE_SPAWN_RADIUS +
          randRange(s, -PIRATE_SPAWN_JITTER, PIRATE_SPAWN_JITTER),
        y: randRange(s, -PIRATE_SPAWN_HEIGHT, PIRATE_SPAWN_HEIGHT),
        z:
          s.carrier.pos.z +
          Math.sin(a) * PIRATE_SPAWN_RADIUS +
          randRange(s, -PIRATE_SPAWN_JITTER, PIRATE_SPAWN_JITTER),
      },
      hull,
      maxHull: hull,
      damage: PIRATE_BASE.damage * def.damage * damageScale,
      speed: PIRATE_BASE.speed * def.speed,
      targetId: -1,
      fireCooldown: 0,
    });
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
    w.size = waveSize(s);
    emit(s, 'PirateWaveIncoming', { size: w.size, eta: Math.ceil(w.timer) });
  }
  if (w.timer <= 0) {
    w.warning = false;
    w.active = true;
    spawnWave(s, w.size);
    emit(s, 'PiratesArrived', { size: w.size });
    w.timer = WAVE_INTERVAL(sys.tier) * randRange(s, ...WAVE_INTERVAL_JITTER);
  }
  // Solar storms in the frontier and beyond; H2 storms at gas giants.
  const st = s.storm;
  if (st.active > 0) {
    st.active -= dt;
    if (st.active <= 0) emit(s, 'StormPassed', { h2: s.systems[s.systemId].gasGiant });
  } else {
    st.timer -= dt;
    if (st.timer <= 0) {
      st.active = STORM_DURATION;
      st.timer = randRange(s, ...STORM_GAP);
      emit(s, 'StormStarted', { h2: s.systems[s.systemId].gasGiant });
    }
  }
}

/** Gas giant pirates hunt harvesters: H2 is easy to fence. */
function gasGiantTargetBias(s: Sim, sh: Ship): number {
  if (sh.cls !== 'harvester' || !s.systems[s.systemId].gasGiant) return 1;
  return GAS_PIRATE_HARVESTER_BIAS;
}

/** Kind-specific priority: interceptors hunt miners and fighters, bombers prefer cargo and the carrier. */
function kindTargetBias(kind: PirateKind, sh: Ship): number {
  if (kind === 'interceptor') {
    if (sh.cls === 'drone' || sh.cls === 'harvester' || sh.cls === 'fighter') return 2.5;
    if (sh.cls === 'barge' || sh.cls === 'hauler') return 0.5;
    return 1;
  }
  if (kind === 'bomber') {
    if (sh.cls === 'barge') return 1.8;
    if (sh.cls === 'hauler' || sh.cls === 'harvester') return 1.2;
    if (sh.cls === 'fighter' || sh.cls === 'drone' || sh.cls === 'scout' || sh.cls === 'repair')
      return 0.6;
    return 1;
  }
  return 1;
}

/** Attractiveness of `sh` to `kind`, before distance; stowed ships are never targeted. */
export function pirateTargetScore(s: Sim, sh: Ship, kind: PirateKind = 'gunship'): number {
  if (isStowed(sh)) return 0;
  return baseTargetScore(s, sh) * kindTargetBias(kind, sh) * gasGiantTargetBias(s, sh);
}

function baseTargetScore(s: Sim, sh: Ship): number {
  if (sh.cls === 'barge') return 4 + (sh.cargo / cargoCap(s, 'barge', sh)) * 6; // full barges first
  if (sh.cls === 'hauler' || sh.cls === 'harvester') return 2 + sh.cargo / 60;
  if (sh.cls === 'fighter') return 1.5;
  return 1;
}

export function pirateStep(s: Sim, dt: number, ctx: Ctx) {
  for (const p of s.pirates) {
    const def = PIRATE_TYPES[p.kind];
    let tgtPos: Vec3 | null =
      p.targetId === CARRIER ? s.carrier.pos : (ctx.ships.get(p.targetId)?.pos ?? null);
    const t = ctx.ships.get(p.targetId);
    if (!tgtPos || (t && isStowed(t)) || rand(s) < dt / 3) {
      let best = CARRIER;
      let bs = (0.6 * def.carrierBias) / (dist(p.pos, s.carrier.pos) + 30);
      for (const sh of ctx.ships.values()) {
        const sc = pirateTargetScore(s, sh, p.kind);
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
      const victim = p.targetId === CARRIER ? null : (ctx.ships.get(p.targetId) ?? null);
      const evasion = victim ? SHIP_STATS[victim.cls].evasion : 0;
      const dmg = p.damage * hitChance(def.tracking, evasion) * dt;
      if (p.targetId === CARRIER) damageCarrier(s, dmg);
      else if (victim) damageShip(s, victim, dmg);
      if (p.fireCooldown <= 0) {
        s.fx.push({
          kind: 'pirateLaser',
          a: copy(p.pos),
          b: copy(tgtPos),
          ttl: 0.15,
        });
        p.fireCooldown = 0.5;
      }
    }
  }
}

/**
 * Carrier turrets (#160, #161): every hull fires on pirates in range, so a run without fighters
 * can still clear a wave. Point-defense takes the nearest pirate, heavy batteries the toughest,
 * and a mount only acquires targets inside its cone around the carrier's heading.
 */
export function carrierTurrets(s: Sim, dt: number) {
  if (s.pirates.length === 0) return;
  const c = s.carrier.pos;
  const dmgMul = 1 + TURRET_DAMAGE_PER_LEVEL * lvl(s, 'turretDamage');
  const rangeMul = 1 + TURRET_RANGE_PER_LEVEL * lvl(s, 'turretRange');
  for (const mount of HULLS[s.carrier.hullClass].turrets) {
    const t = TURRETS[mount.kind];
    const r2 = (t.range * rangeMul) ** 2;
    let target: Pirate | null = null;
    let best = Infinity;
    for (const p of s.pirates) {
      if (p.hull <= 0) continue;
      const d2 = dist2(p.pos, c);
      if (d2 > r2 || !inFiringArc(s.carrier.heading, mount, c, p.pos)) continue;
      const score = mount.kind === 'pd' ? d2 : -p.hull;
      if (score < best) {
        best = score;
        target = p;
      }
    }
    if (!target) continue;
    const hc = hitChance(t.tracking, PIRATE_TYPES[target.kind].evasion);
    target.hull -= t.damage * dmgMul * hc * dt;
    // Beams on a fixed beat from sim time, so firing draws no randomness.
    if (Math.floor(s.time / t.period) !== Math.floor((s.time - dt) / t.period))
      s.fx.push({
        kind: 'turretLaser',
        a: copy(c),
        b: copy(target.pos),
        ttl: 0.15,
      });
  }
}
