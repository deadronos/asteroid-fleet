import { ZONE_RULE_UNLOCKS, ZONE_UNLOCKS, ORE_BY_TIER, STARTER_RULES } from './config';
import { addPreset } from './cards';
import { challengeBonus } from './modifiers';
import { onSphere, seeded, v3 } from './math';
import { lvl } from './research';
import { unlockHulls } from './economy';
import type { Asteroid, FieldRecord, Hazard, RuleId, Sim, StarSystem, Vec3 } from './types';

const NAMES = [
  'Kestrel',
  'Lumen',
  'Harrow',
  'Vesper',
  'Cinder',
  'Tamsin',
  'Orrery',
  'Ashfall',
  'Nadir',
  'Umbra',
];

export function makeSystems(seed: number): StarSystem[] {
  const r = seeded(seed ^ 0x51f15e);
  const layout: { tier: 1 | 2 | 3; distance: number; gas?: boolean }[] = [
    { tier: 1, distance: 0 },
    { tier: 1, distance: 1 },
    { tier: 2, distance: 2 },
    { tier: 2, distance: 3, gas: true },
    { tier: 2, distance: 3 },
    { tier: 2, distance: 4 },
    { tier: 3, distance: 5 },
    { tier: 3, distance: 6, gas: true },
    { tier: 3, distance: 6 },
    { tier: 3, distance: 7 },
  ];
  return layout.map((l, i) => ({
    id: i,
    name: `${NAMES[i]} ${['I', 'II', 'III', 'IV'][Math.floor(r() * 4)]}`,
    tier: l.tier,
    distance: l.distance,
    oreMult: 1 + l.distance * 0.12,
    brightness: Math.round((0.6 + r() * 0.9) * 100) / 100,
    gasGiant: !!l.gas,
    discovered: l.distance <= 1,
    seed: Math.floor(r() * 1e9),
  }));
}

/** Storms in gas giant systems are H2 storms around the planet, not solar storms. */
export function h2Storm(s: Sim): boolean {
  return s.storm.active > 0 && s.systems[s.systemId].gasGiant;
}

export function gasGiantPos(sys: StarSystem): Vec3 {
  const r = seeded(sys.seed ^ 0x9a5);
  const a = r() * Math.PI * 2;
  return { x: Math.cos(a) * 120, y: -10, z: Math.sin(a) * 120 };
}

function pickOre(r: () => number, tier: number) {
  const table = ORE_BY_TIER[tier];
  const total = table.reduce((a, o) => a + o.weight, 0);
  let x = r() * total;
  for (const o of table) {
    x -= o.weight;
    if (x <= 0) return o;
  }
  return table[0];
}

export function spawnAsteroid(
  s: Sim,
  r: () => number,
  center: Vec3,
  sys: StarSystem,
  richBonus = 0,
): Asteroid {
  const off = onSphere(r, 9, 0.6);
  const pos = { x: center.x + off.x, y: center.y + off.y, z: center.z + off.z };
  const far = Math.sqrt(center.x * center.x + center.z * center.z);
  const ore = pickOre(r, sys.tier);
  const maxOre = Math.round(80 + r() * 220);
  // Always draw the roll, so researching rare ore never shifts the rocks after this one.
  const rareRoll = r();
  const rare = rareRoll < 0.04 * lvl(s, 'rare') ? 2.5 : 1;
  return {
    id: s.nextId++,
    pos,
    ore: maxOre,
    maxOre,
    value:
      ore.value *
      sys.oreMult *
      (1 + far / 140) *
      (1 + 0.1 * lvl(s, 'rich')) *
      (1 + richBonus) *
      (1 + challengeBonus(s)) *
      rare,
    radius: 0.8 + (maxOre / 300) * 1.6,
    respawn: 0,
  };
}

/** Cluster centres for a system; the field keeps refilling around them. */
export function clusterCenters(sys: StarSystem): Vec3[] {
  const r = seeded(sys.seed);
  const out: Vec3[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.6;
    const d = 22 + i * 10 + r() * 8;
    out.push({ x: Math.cos(a) * d, y: (r() - 0.5) * 10, z: Math.sin(a) * d });
  }
  return out;
}

/** Seconds for a partly mined rock to refill completely while the carrier is away. */
export const FIELD_REFILL_SECS = 300;

/** Snapshot the current field's depletion so a later visit can restore it. */
export function recordField(s: Sim): FieldRecord {
  const rocks: [number, number, number][] = [];
  for (let i = 0; i < s.asteroids.length; i++) {
    const a = s.asteroids[i];
    const frac = Math.round((a.ore / a.maxOre) * 1000) / 1000;
    if (frac >= 1) continue;
    rocks.push([i, frac, frac > 0 ? 0 : Math.round(a.respawn * 10) / 10]);
  }
  return { left: s.time, rocks };
}

/** Apply a depletion record to a freshly seeded field, refilling for the time away. */
export function applyField(s: Sim, rec: FieldRecord) {
  const away = Math.max(0, s.time - rec.left);
  for (const [i, frac, respawn] of rec.rocks) {
    const a = s.asteroids[i];
    if (!a) continue;
    if (frac > 0) {
      a.ore = a.maxOre * Math.min(1, frac + away / FIELD_REFILL_SECS);
    } else if (respawn > away) {
      a.ore = 0;
      a.respawn = respawn - away;
    }
  }
}

export function enterSystem(s: Sim, id: number) {
  if (s.asteroids.length > 0 && s.systemId !== id) s.fields[s.systemId] = recordField(s);
  const sys = s.systems[id];
  s.systemId = id;
  s.pirates = [];
  s.containers = [];
  s.fx = [];
  s.carrier.pos = v3();
  s.carrier.target = null;
  s.asteroids = [];
  const r = seeded(sys.seed);
  for (const c of clusterCenters(sys)) {
    const n = 8 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) s.asteroids.push(spawnAsteroid(s, r, c, sys));
  }
  const rec = s.fields[id];
  if (rec) {
    applyField(s, rec);
    delete s.fields[id];
  }
  s.hazards = [];
  s.recon = { clusters: [], veins: [], hazards: [] };
  const hz = sys.tier === 1 ? 0 : sys.tier === 2 ? 2 : 3;
  for (let i = 0; i < hz; i++) {
    const p = onSphere(r, 90, 0.2);
    const h: Hazard = {
      pos: p,
      radius: 10 + r() * 10,
      dps: sys.tier === 2 ? 2 : 6,
      kind: sys.tier === 2 ? 'debris' : 'radiation',
    };
    if (Math.hypot(p.x, p.z) > 25) s.hazards.push(h);
  }
  s.wave = {
    timer: sys.tier === 1 ? Infinity : 60,
    warning: false,
    active: false,
    size: 0,
  };
  s.storm = {
    timer: sys.tier >= 2 || sys.gasGiant ? 90 + r() * 60 : Infinity,
    active: 0,
  };
  for (const o of s.systems) if (o.distance <= sys.distance + 1) o.discovered = true;
  if (sys.tier > s.stats.furthestTier) s.stats.furthestTier = sys.tier;
  for (let t = 1; t <= sys.tier; t++) {
    for (const c of ZONE_UNLOCKS[t]) if (!s.unlocked.includes(c)) s.unlocked.push(c);
    for (const rid of ZONE_RULE_UNLOCKS[t]) unlockRule(s, rid);
  }
  unlockHulls(s);
}

/** Unlock a preset: its action becomes usable, and its card is dealt once if a slot is free. */
export function unlockRule(s: Sim, id: RuleId) {
  if (s.unlockedRules.includes(id)) return;
  s.unlockedRules.push(id);
  addPreset(s, id, STARTER_RULES.includes(id));
}
