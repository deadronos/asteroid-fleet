// Background (Tier B) and offline (Tier C) carrier model (#76).
//
// A carrier the player is not looking at runs here instead of in `stepOp`: one aggregate
// step per second, no ship positions, no pirates on the map. Waves still come on the same
// timers and are rolled with the operation's own rng, so the result depends only on the
// operation and the run-wide state, never on what else was stepped. A wave already on the
// map is rolled the same way when the carrier leaves Tier A, before its pirates are
// dropped (#177). `settleOffline` plays the same model over the time away (Tier C): that
// wave is reported; no new wave rolls offline (#179).

import {
  FUSION_H2,
  FUSION_RATE,
  SHIELD_REGEN,
  STORM_DURATION,
  STORM_GAP,
  WAVE_INTERVAL,
  WAVE_INTERVAL_JITTER,
} from './config';
import { queueRebuild } from './automation';
import { waveSize, waveWarning } from './combat';
import { removeFromHangars } from './hangar';
import { onSphere, rand, randRange } from './math';
import { lvl, reserveDefs } from './research';
import {
  createShip,
  emit,
  h2Storm,
  isStowed,
  maxEnergy,
  refineThroughput,
  solarRate,
  upkeepRate,
} from './state';
import type { Ship, ShipClass, Sim } from './types';

/** Seconds before the next wave when a carrier comes back from offline, at least. */
export const RETURN_GRACE_S = 60;

/** Seconds per background step. */
export const BG_DT = 1;

export interface BackgroundOpts {
  /** Share of the yield paid out: 1 in the background, `OFFLINE_EFFICIENCY` offline. */
  efficiency?: number;
  /** Emit wave, storm and rebuild events. Off for the quiet part of an offline settle. */
  events?: boolean;
  /** Roll pirate waves. Off for offline settlement, where no new wave comes (#179). */
  waves?: boolean;
  /** Count earned credits toward `stats.oreValueDelivered` (RP and challenges). Off offline (#230). */
  countsForRp?: boolean;
  /** Burn stored H2 for Fusion when energy is below capacity. Off offline (#230). */
  fusion?: boolean;
}

export interface BackgroundReport {
  credits: number;
  rebuilt: number;
  lost: number;
}

/** Classes a background wave may destroy, cheapest to lose first. Never a barge (Q9, #49). */
const BUFFER_ORDER: ShipClass[] = ['fighter', 'drone', 'scout', 'repair', 'hauler', 'harvester'];

/** A ship out in the field. Docked and carried ships are safe from a wave. */
const exposed = (x: Ship) => !isStowed(x);

/**
 * Ships a background wave may take: launched ones the free reserves will rebuild, plus
 * launched fighters, which are there to be shot at. Losses per wave are capped at this.
 */
export function lossBuffer(s: Sim): number {
  const reserve = new Set(
    reserveDefs(s)
      .filter(([, min]) => min > 0)
      .map(([cls]) => cls),
  );
  let n = 0;
  for (const x of s.ships)
    if (exposed(x) && (x.cls === 'fighter' || (x.cls !== 'barge' && reserve.has(x.cls)))) n++;
  return n;
}

function fusionActive(s: Sim, fusion: boolean): boolean {
  const c = s.carrier;
  return fusion && lvl(s, 'fusion') > 0 && c.h2 > 0 && c.energy < maxEnergy(s);
}

/**
 * Credits/s the operation earns in the background: the slowest of what the fleet was
 * mining when it left Tier A, what the refinery can turn into credits, and what the
 * energy pool can pay for.
 */
export function bottleneckYield(s: Sim, fusion = true): number {
  const mined = Math.max(0, s.miningIncomeAvg || 0);
  const c = s.carrier;
  const perOre = c.ore > 0 ? c.oreValue / c.ore : Infinity;
  const refined = refineThroughput(s) * perOre;
  // Refining stalls once the pool is empty and solar + active Fusion cannot cover upkeep.
  const powered = c.energy > 0 || energyNet(s, fusion) > 0 ? Infinity : 0;
  return Math.min(mined, refined, powered);
}

/**
 * Energy/s in the background: solar (boosted in a solar storm) plus Fusion when active,
 * minus upkeep.
 */
export function energyNet(s: Sim, fusion = true): number {
  const boost = s.storm.active > 0 && !h2Storm(s) ? 1.6 : 1;
  return solarRate(s) * boost + (fusionActive(s, fusion) ? FUSION_RATE : 0) - upkeepRate(s);
}

/**
 * Leave Tier A. An active wave is resolved first, with one background roll per pirate
 * still alive, so a focus switch is not a free escape (#177). `events` defaults on;
 * pass false to apply the roll without reporting it. Then everything that only exists
 * on the map is dropped. Ships keep their mode, cargo and hull, so upkeep and the loss
 * buffer read the same as they did in the last Tier A step.
 */
export function dematerialise(s: Sim, opts: Pick<BackgroundOpts, 'events'> = {}) {
  // Resolve now. A later background step has no pirates to fight, and leaving the wave
  // active would clear it for free if focus came back before that step (#177).
  const ev = opts.events ?? true;
  if (s.wave.active) {
    let remaining = 0;
    for (const p of s.pirates) if (p.hull > 0) remaining++;
    if (remaining > 0) rollWave(s, remaining, ev);
    s.wave.active = false;
    if (ev) emit(s, 'WaveRepelled', {});
  }
  s.pirates.length = 0;
  s.fx.length = 0;
  s.containers.length = 0;
}

/**
 * Enter Tier A: put launched ships back around the carrier with no job, so their
 * behaviours pick fresh targets on the next `stepOp`. Positions come from the op's rng.
 */
export function materialise(s: Sim) {
  const c = s.carrier.pos;
  for (const x of s.ships) {
    x.targetId = -1;
    if (isStowed(x)) continue;
    x.mode = 'idle';
    x.station = null;
    const off = onSphere(() => rand(s), 6, 0.5);
    x.pos = { x: c.x + off.x, y: c.y + off.y, z: c.z + off.z };
  }
}

/** One background step of `dt` seconds (at most `BG_DT`). The run clock is not moved. */
export function stepBackground(s: Sim, dt = BG_DT, opts: BackgroundOpts = {}): BackgroundReport {
  const ev = opts.events ?? true;
  const countsForRp = opts.countsForRp ?? true;
  const fusion = opts.fusion ?? true;
  const rep: BackgroundReport = { credits: 0, rebuilt: 0, lost: 0 };

  const credits = bottleneckYield(s, fusion) * dt * (opts.efficiency ?? 1);
  s.credits += credits;
  s.stats.creditsEarned += credits;
  if (countsForRp) s.stats.oreValueDelivered += credits;
  rep.credits = credits;

  const c = s.carrier;
  const max = maxEnergy(s);
  const boost = s.storm.active > 0 && !h2Storm(s) ? 1.6 : 1;
  let fusionGain = 0;
  if (dt > 0 && fusionActive(s, fusion)) {
    const burn = Math.min(c.h2, FUSION_H2 * dt);
    c.h2 -= burn;
    fusionGain = FUSION_RATE * (burn / (FUSION_H2 * dt)) * dt;
  }
  const net = (solarRate(s) * boost - upkeepRate(s)) * dt + fusionGain;
  c.energy = Math.min(max, Math.max(0, c.energy + net));
  if (c.energy > 0) c.shield = Math.min(1, c.shield + SHIELD_REGEN * dt);

  rep.lost = timers(s, dt, ev, opts.waves ?? true);
  rep.rebuilt = rebuild(s, dt, ev);
  return rep;
}

/** `stepBackground` over `seconds`, in whole steps plus one partial step. */
export function runBackground(
  s: Sim,
  seconds: number,
  opts: BackgroundOpts = {},
): BackgroundReport {
  const rep: BackgroundReport = { credits: 0, rebuilt: 0, lost: 0 };
  let left = Math.max(0, seconds);
  while (left > 1e-9) {
    const dt = Math.min(BG_DT, left);
    const r = stepBackground(s, dt, opts);
    rep.credits += r.credits;
    rep.rebuilt += r.rebuilt;
    rep.lost += r.lost;
    left -= dt;
  }
  return rep;
}

/** Wave and storm timers, as in `threats`. Returns ships lost to a wave. */
function timers(s: Sim, dt: number, ev: boolean, waves: boolean): number {
  const sys = s.systems[s.systemId];
  if (sys.tier === 1) return 0;
  let lost = 0;
  const w = s.wave;
  if (waves) {
    w.timer -= dt;
    if (!w.warning && w.timer <= waveWarning(s)) {
      w.warning = true;
      w.size = waveSize(s);
      if (ev) emit(s, 'PirateWaveIncoming', { size: w.size, eta: Math.ceil(w.timer) });
    }
    if (w.timer <= 0) {
      w.warning = false;
      lost = rollWave(s, w.size, ev);
      if (ev) emit(s, 'WaveRepelled', {});
      w.timer = WAVE_INTERVAL(sys.tier) * randRange(s, ...WAVE_INTERVAL_JITTER);
    }
  }
  const st = s.storm;
  if (st.active > 0) {
    st.active -= dt;
    if (st.active <= 0 && ev) emit(s, 'StormPassed', { h2: sys.gasGiant });
  } else {
    st.timer -= dt;
    if (st.timer <= 0) {
      st.active = STORM_DURATION;
      st.timer = randRange(s, ...STORM_GAP);
      if (ev) emit(s, 'StormStarted', { h2: sys.gasGiant });
    }
  }
  return lost;
}

/**
 * Resolve a wave of `size` against the launched fighters: each pirate the fighters
 * cannot hold off takes one ship, capped at the loss buffer and taken from it in
 * `BUFFER_ORDER`. Docked and carried ships, the carrier and barges are never lost here.
 */
function rollWave(s: Sim, size: number, ev: boolean): number {
  let defence = 0;
  for (const x of s.ships) if (x.cls === 'fighter' && exposed(x)) defence++;
  const p = size / (size + 2 * defence + 1);
  let hits = 0;
  for (let i = 0; i < size; i++) if (rand(s) < p) hits++;
  const n = Math.min(hits, lossBuffer(s));
  const reserve = new Set(
    reserveDefs(s)
      .filter(([, min]) => min > 0)
      .map(([cls]) => cls),
  );
  let lost = 0;
  for (const cls of BUFFER_ORDER) {
    if (cls !== 'fighter' && !reserve.has(cls)) continue;
    for (let i = s.ships.length - 1; i >= 0 && lost < n; i--) {
      const x = s.ships[i];
      if (x.cls !== cls || !exposed(x)) continue;
      s.ships.splice(i, 1);
      lose(s, x, ev);
      lost++;
    }
  }
  // Pirates that got a hit in escaped; the rest were shot down.
  s.stats.piratesKilled += size - hits;
  return lost;
}

/**
 * `destroyShip` without the map: no explosion fx (nothing ticks fx in the background, so
 * they would pile up and replay on `materialise`), and `ShipLost` only when events are on.
 */
function lose(s: Sim, ship: Ship, ev: boolean) {
  removeFromHangars(s, ship.id);
  s.stats.shipsLost++;
  queueRebuild(s, ship);
  if (ev) emit(s, 'ShipLost', { cls: ship.cls, cause: 'destroyed' });
}

/** Free reserve rebuilds, as in `reserves`. */
function rebuild(s: Sim, dt: number, ev: boolean): number {
  let n = 0;
  for (const [cls, min, cooldown] of reserveDefs(s)) {
    if (min <= 0 || !s.unlocked.includes(cls)) continue;
    let have = 0;
    for (const x of s.ships) if (x.cls === cls) have++;
    if (have >= min) {
      s.reserveTimers[cls] = cooldown;
      continue;
    }
    const t = (s.reserveTimers[cls] ?? cooldown) - dt;
    s.reserveTimers[cls] = t;
    if (t > 0) continue;
    if (createShip(s, cls)) {
      n++;
      if (ev) emit(s, 'ReserveRebuilt', { cls });
      const q = s.rebuildQueue;
      const i = q.findIndex((x) => x.cls === cls);
      if (i >= 0) q.splice(i, 1);
    }
    s.reserveTimers[cls] = cooldown;
  }
  return n;
}
