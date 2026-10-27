import {
  DEFAULT_STANCE,
  ENERGY_MAX,
  HANGAR_UPKEEP,
  HULLS,
  HULL_IDS,
  ORE_BY_TIER,
  SHIP_STATS,
  SHIP_UPKEEP,
  SOLAR_RATE,
  STARTER_RULES,
  refineRate,
  warpCost,
  ZONE_RULE_UNLOCKS,
  ZONE_UNLOCKS,
} from './config';
import { addPreset } from './cards';
import { findSpace } from './hangar';
import { onSphere, seeded, v3 } from './math';
import { lvl, repeatEffect } from './research';
import type {
  Asteroid,
  EventData,
  FieldRecord,
  GameState,
  Hangar,
  Hazard,
  HullId,
  Operation,
  RuleId,
  Ship,
  ShipClass,
  Severity,
  SimEvent,
  SimEventKind,
  Sim,
  StarSystem,
  Vec3,
} from './types';

/** Bump together with a `migrations[n]` step and a fixture. See README "Save migrations". */
export const SAVE_VERSION = 13;

/** Every `Operation` field. The `satisfies` below fails to compile when one is missing. */
export const OP_KEYS = [
  'id',
  'rng',
  'carrier',
  'hangars',
  'ships',
  'pirates',
  'asteroids',
  'containers',
  'hazards',
  'recon',
  'systemId',
  'warp',
  'wave',
  'storm',
  'reserveTimers',
  'incomeAvg',
  'miningIncomeAvg',
  'fx',
] as const satisfies readonly (keyof Operation)[];

type Missing<K, Listed> = Exclude<K, Listed> extends never ? true : Exclude<K, Listed>;
const opKeysComplete: Missing<keyof Operation, (typeof OP_KEYS)[number]> = true;
void opKeysComplete;

/**
 * A `Sim` over one GameState and one Operation. Plain accessors, one per field, keep every
 * read monomorphic in the hot loop; `implements Sim` fails to compile when one is missing.
 */
class SimView implements Sim {
  constructor(
    readonly g: GameState,
    readonly op: Operation,
  ) {}
  get version() {
    return this.g.version;
  }
  set version(v) {
    this.g.version = v;
  }
  get seed() {
    return this.g.seed;
  }
  set seed(v) {
    this.g.seed = v;
  }
  get time() {
    return this.g.time;
  }
  set time(v) {
    this.g.time = v;
  }
  get nextId() {
    return this.g.nextId;
  }
  set nextId(v) {
    this.g.nextId = v;
  }
  get credits() {
    return this.g.credits;
  }
  set credits(v) {
    this.g.credits = v;
  }
  get research() {
    return this.g.research;
  }
  set research(v) {
    this.g.research = v;
  }
  get marks() {
    return this.g.marks;
  }
  set marks(v) {
    this.g.marks = v;
  }
  get researchLevels() {
    return this.g.researchLevels;
  }
  set researchLevels(v) {
    this.g.researchLevels = v;
  }
  get unlocked() {
    return this.g.unlocked;
  }
  set unlocked(v) {
    this.g.unlocked = v;
  }
  get hulls() {
    return this.g.hulls;
  }
  set hulls(v) {
    this.g.hulls = v;
  }
  get unlockedRules() {
    return this.g.unlockedRules;
  }
  set unlockedRules(v) {
    this.g.unlockedRules = v;
  }
  get systems() {
    return this.g.systems;
  }
  set systems(v) {
    this.g.systems = v;
  }
  get fields() {
    return this.g.fields;
  }
  set fields(v) {
    this.g.fields = v;
  }
  get alerts() {
    return this.g.alerts;
  }
  set alerts(v) {
    this.g.alerts = v;
  }
  get doctrine() {
    return this.g.doctrine;
  }
  set doctrine(v) {
    this.g.doctrine = v;
  }
  get cards() {
    return this.g.cards;
  }
  set cards(v) {
    this.g.cards = v;
  }
  get automation() {
    return this.g.automation;
  }
  set automation(v) {
    this.g.automation = v;
  }
  get stats() {
    return this.g.stats;
  }
  set stats(v) {
    this.g.stats = v;
  }
  get lifetime() {
    return this.g.lifetime;
  }
  set lifetime(v) {
    this.g.lifetime = v;
  }
  get powerMode() {
    return this.g.powerMode;
  }
  set powerMode(v) {
    this.g.powerMode = v;
  }
  get log() {
    return this.g.log;
  }
  set log(v) {
    this.g.log = v;
  }
  get events() {
    return this.g.events;
  }
  set events(v) {
    this.g.events = v;
  }
  get savedAt() {
    return this.g.savedAt;
  }
  set savedAt(v) {
    this.g.savedAt = v;
  }
  get id() {
    return this.op.id;
  }
  set id(v) {
    this.op.id = v;
  }
  get rng() {
    return this.op.rng;
  }
  set rng(v) {
    this.op.rng = v;
  }
  get carrier() {
    return this.op.carrier;
  }
  set carrier(v) {
    this.op.carrier = v;
  }
  get hangars() {
    return this.op.hangars;
  }
  set hangars(v) {
    this.op.hangars = v;
  }
  get ships() {
    return this.op.ships;
  }
  set ships(v) {
    this.op.ships = v;
  }
  get pirates() {
    return this.op.pirates;
  }
  set pirates(v) {
    this.op.pirates = v;
  }
  get asteroids() {
    return this.op.asteroids;
  }
  set asteroids(v) {
    this.op.asteroids = v;
  }
  get containers() {
    return this.op.containers;
  }
  set containers(v) {
    this.op.containers = v;
  }
  get hazards() {
    return this.op.hazards;
  }
  set hazards(v) {
    this.op.hazards = v;
  }
  get recon() {
    return this.op.recon;
  }
  set recon(v) {
    this.op.recon = v;
  }
  get systemId() {
    return this.op.systemId;
  }
  set systemId(v) {
    this.op.systemId = v;
  }
  get warp() {
    return this.op.warp;
  }
  set warp(v) {
    this.op.warp = v;
  }
  get wave() {
    return this.op.wave;
  }
  set wave(v) {
    this.op.wave = v;
  }
  get storm() {
    return this.op.storm;
  }
  set storm(v) {
    this.op.storm = v;
  }
  get reserveTimers() {
    return this.op.reserveTimers;
  }
  set reserveTimers(v) {
    this.op.reserveTimers = v;
  }
  get incomeAvg() {
    return this.op.incomeAvg;
  }
  set incomeAvg(v) {
    this.op.incomeAvg = v;
  }
  get miningIncomeAvg() {
    return this.op.miningIncomeAvg;
  }
  set miningIncomeAvg(v) {
    this.op.miningIncomeAvg = v;
  }
  get fx() {
    return this.op.fx;
  }
  set fx(v) {
    this.op.fx = v;
  }
}

const views = new WeakMap<Operation, SimView>();

/** `g` and `op` as one `Sim`. Not serialisable: save `g` itself. */
export function bind(g: GameState, op: Operation): Sim {
  let v = views.get(op);
  if (!v || v.g !== g) {
    v = new SimView(g, op);
    views.set(op, v);
  }
  return v;
}

/** The run-wide state behind a bound `Sim`. */
export function stateOf(s: Sim): GameState {
  return (s as unknown as SimView).g;
}

/** The operation the player is looking at: `focusId`, or the first one. */
export function focusOp(g: GameState): Operation {
  if (g.focusId !== undefined) for (const op of g.ops) if (op.id === g.focusId) return op;
  return g.ops[0];
}

/** `bind` for the focused operation. */
export function focused(g: GameState): Sim {
  return bind(g, focusOp(g));
}

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
  s.wave = { timer: sys.tier === 1 ? Infinity : 60, warning: false, active: false, size: 0 };
  s.storm = { timer: sys.tier >= 2 || sys.gasGiant ? 90 + r() * 60 : Infinity, active: 0 };
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

export function maxHull(s: Sim, cls: ShipClass): number {
  let h = SHIP_STATS[cls].hull * (1 + 0.15 * lvl(s, 'armor'));
  if (cls === 'barge' && lvl(s, 'bargeBay') > 0) h *= 1.5;
  if (cls === 'drone') h *= 1 + 0.3 * lvl(s, 'droneHull');
  if (cls === 'hauler') h *= 1 + 0.4 * lvl(s, 'haulerHull');
  if (cls === 'fighter') h *= 1 + 0.25 * lvl(s, 'fighterHull');
  if (cls === 'harvester') h *= 1 + 0.3 * lvl(s, 'harvestHull');
  return h;
}

/** Carrier hull points: hull class times Reinforced frame. */
export function carrierMaxHull(s: Sim): number {
  return HULLS[s.carrier.hullClass].hull * (1 + 0.12 * lvl(s, 'frame'));
}

export function maxEnergy(s: Sim): number {
  return (
    ENERGY_MAX *
    HULLS[s.carrier.hullClass].energy *
    (1 + 0.25 * lvl(s, 'energyCap')) *
    (1 + repeatEffect(s, 'deepEnergy'))
  );
}

/** Refinery throughput, ore/s: level, hull class and void refining. */
export function refineThroughput(s: Sim): number {
  return (
    refineRate(s.carrier.refinery) *
    HULLS[s.carrier.hullClass].refinery *
    (1 + 0.1 * lvl(s, 'reactor')) *
    (1 + 0.25 * lvl(s, 'voidRefining'))
  );
}

/** Jump energy between two system distances, with the hull's multiplier. */
export function jumpCost(s: Sim, from: number, to: number): number {
  return warpCost(from, to, HULLS[s.carrier.hullClass].warpCost * (1 - 0.05 * lvl(s, 'sensors')));
}

/** Unlock hull classes the run has earned: after the first prestige, by furthest tier. */
export function unlockHulls(s: Sim) {
  if (s.lifetime.prestiges < 1) return;
  for (const id of HULL_IDS)
    if (HULLS[id].tier <= s.stats.furthestTier && !s.hulls.includes(id)) s.hulls.push(id);
}

/** Solar recharge in the current system, energy/s, before storm boosts. */
export function solarRate(s: Sim): number {
  return SOLAR_RATE * s.systems[s.systemId].brightness * (1 + 0.2 * lvl(s, 'solar'));
}

/** Energy/s drawn by `count` hangars. */
export function hangarUpkeep(count: number): number {
  let e = 0;
  for (let i = 0; i < count; i++) e += HANGAR_UPKEEP(i);
  return e;
}

/** Energy/s the hangars and launched ships draw right now (#60). Docked ships are free. */
export function upkeepRate(s: Sim): number {
  let total = hangarUpkeep(s.hangars.length);
  for (const x of s.ships) if (x.mode !== 'docked') total += SHIP_UPKEEP[x.cls];
  return total;
}

export interface Upkeep {
  hangars: number;
  /** Energy/s for the hangars alone. */
  hangarRate: number;
  /** Launched (not docked) ships per class. */
  launched: Record<ShipClass, number>;
  /** Energy/s for all hangars and launched ships. */
  total: number;
}

/** `upkeepRate` broken down for the Power panel. */
export function upkeep(s: Sim): Upkeep {
  const launched = Object.fromEntries(Object.keys(SHIP_UPKEEP).map((c) => [c, 0])) as Record<
    ShipClass,
    number
  >;
  const hangarRate = hangarUpkeep(s.hangars.length);
  let total = hangarRate;
  for (const x of s.ships) {
    if (x.mode === 'docked') continue;
    launched[x.cls]++;
    total += SHIP_UPKEEP[x.cls];
  }
  return { hangars: s.hangars.length, hangarRate, launched, total };
}

export function createShip(
  s: Sim,
  cls: ShipClass,
  preferredHangar?: number,
  start?: number,
): Ship | null {
  let hangar: Hangar | undefined;
  let at = start ?? -1;
  if (preferredHangar !== undefined && start !== undefined) {
    hangar = s.hangars.find((h) => h.id === preferredHangar);
  } else {
    const space = findSpace(s, cls, preferredHangar);
    if (!space) return null;
    hangar = space.hangar;
    at = space.start;
  }
  if (!hangar || at < 0) return null;
  const ship: Ship = {
    id: s.nextId++,
    cls,
    hangarId: hangar.id,
    mode: 'docked',
    pos: { ...s.carrier.pos },
    hull: maxHull(s, cls),
    cargo: 0,
    cargoValue: 0,
    h2: 0,
    targetId: -1,
    escortId: -1,
    station: null,
    bargeId: -1,
    fireCooldown: 0,
    modules: [],
  };
  s.ships.push(ship);
  hangar.items.push({ shipId: ship.id, start: at });
  return ship;
}

export const SEVERITY: Record<SimEventKind, Severity> = {
  CarrierOnline: 'good',
  ShipLost: 'warn',
  ShipRetreating: 'warn',
  PirateWaveIncoming: 'warn',
  PiratesArrived: 'critical',
  WaveRepelled: 'good',
  StormStarted: 'warn',
  StormPassed: 'info',
  HazardCharted: 'warn',
  VeinFound: 'good',
  BargeWrecked: 'warn',
  BargeFallback: 'warn',
  ReserveRebuilt: 'good',
  ShipRebuilt: 'good',
  HangarInstalled: 'good',
  WarpCharging: 'warn',
  WarpCancelled: 'info',
  Warped: 'good',
  EmergencyJump: 'critical',
  Prestiged: 'good',
  Admiralty: 'good',
  WelcomeBack: 'good',
  Legacy: 'info',
};

const LOG_CAP = 40;
/** Bounds the outbox when nothing drains it (tests, headless balance runs). */
const OUTBOX_CAP = 256;

/** Report an event to the player. Write-only: the sim never reads events back. */
export function emit<K extends SimEventKind>(s: Sim, kind: K, data: EventData[K]) {
  const ev = {
    kind,
    carrierId: s.id,
    systemId: s.systemId,
    severity: SEVERITY[kind],
    t: s.time,
    count: 1,
    data,
  } as SimEvent;
  s.log.unshift(ev);
  if (s.log.length > LOG_CAP) s.log.length = LOG_CAP;
  s.events.push({ ...ev });
  if (s.events.length > OUTBOX_CAP) s.events.splice(0, s.events.length - OUTBOX_CAP);
}

interface Carry {
  research: number;
  researchLevels: Record<string, number>;
  unlocked: ShipClass[];
  unlockedRules: RuleId[];
  hulls?: HullId[];
  hullClass?: HullId;
  discovered: number[];
  lifetime: GameState['lifetime'];
  marks?: number;
  doctrine?: GameState['doctrine'];
  alerts?: GameState['alerts'];
  cards?: GameState['cards'];
  automation?: GameState['automation'];
}

export function newGame(seed = 1337, carry?: Carry): GameState {
  const slotsBonus = carry?.researchLevels.slots ?? 0;
  const hulls = carry?.hulls ?? ['standard'];
  const hullClass =
    carry?.hullClass && hulls.includes(carry.hullClass) ? carry.hullClass : 'standard';
  const hd = HULLS[hullClass];
  const op: Operation = {
    id: 0,
    rng: seed,
    carrier: {
      pos: v3(),
      target: null,
      hull: hd.hull * (1 + 0.12 * (carry?.researchLevels.frame ?? 0)),
      maxHull: hd.hull * (1 + 0.12 * (carry?.researchLevels.frame ?? 0)),
      energy: ENERGY_MAX * 0.6,
      shield: 1,
      ore: 0,
      oreValue: 0,
      h2: 0,
      stance: 'followRich',
      refinery: 0,
      hullClass,
    },
    hangars: hd.start.map((type, i) => ({
      id: i + 1,
      type,
      slots: hd.slots + slotsBonus,
      items: [],
      stance: {},
      launchOrder:
        type === 'launch'
          ? (['fighter', 'scout', 'drone', 'repair', 'hauler', 'barge', 'harvester'] as ShipClass[])
          : ([
              'fighter',
              'drone',
              'hauler',
              'barge',
              'repair',
              'scout',
              'harvester',
            ] as ShipClass[]),
      launchTimer: 0,
      target: {},
    })),
    ships: [],
    pirates: [],
    asteroids: [],
    hazards: [],
    recon: { clusters: [], veins: [], hazards: [] },
    systemId: 0,
    containers: [],
    warp: null,
    wave: { timer: Infinity, warning: false, active: false, size: 0 },
    storm: { timer: Infinity, active: 0 },
    reserveTimers: {},
    incomeAvg: 0,
    miningIncomeAvg: 0,
    fx: [],
  };
  const g: GameState = {
    version: SAVE_VERSION,
    seed,
    time: 0,
    nextId: 1,
    credits: 150 + 250 * (carry?.researchLevels.startCredits ?? 0),
    research: carry?.research ?? 0,
    researchLevels: carry?.researchLevels ?? {},
    unlocked: carry?.unlocked ?? [],
    unlockedRules: [],
    hulls: [...hulls],
    systems: makeSystems(seed),
    fields: {},
    doctrine: carry?.doctrine ?? {
      fleet: { ...DEFAULT_STANCE },
      byClass: { drone: { mining: 'safe' } },
    },
    alerts: carry?.alerts ?? { fleet: {}, byCarrier: {} },
    cards: carry?.cards ?? [],
    automation: carry?.automation
      ? { ...carry.automation, rebuildQueue: [], timer: 0 }
      : { autoBuy: false, autoRebuild: false, creditFloor: 0, rebuildQueue: [], timer: 0 },
    stats: {
      oreValueDelivered: 0,
      creditsEarned: 0,
      shipsLost: 0,
      piratesKilled: 0,
      furthestTier: 1,
    },
    lifetime: carry?.lifetime ?? {
      prestiges: 0,
      researchEarned: 0,
      admiralties: 0,
      marksEarned: 0,
    },
    marks: carry?.marks ?? 0,
    powerMode: 'balanced',
    log: [],
    events: [],
    savedAt: Date.now(),
    ops: [op],
  };
  const s = bind(g, op);
  // Carried presets stay unlocked without dealing their cards again.
  s.unlockedRules = [...(carry?.unlockedRules ?? [])];
  if (carry) for (const id of carry.discovered) if (s.systems[id]) s.systems[id].discovered = true;
  s.carrier.energy = maxEnergy(s) * 0.6;
  enterSystem(s, 0);
  for (let i = 0; i < 4; i++) createShip(s, 'drone', 1);
  emit(s, 'CarrierOnline', { system: s.systems[0].name });
  return g;
}
