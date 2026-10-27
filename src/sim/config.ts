import {
  SHIP_CLASSES,
  type ActionKind,
  type ConditionKind,
  type HangarType,
  type HullId,
  type ModuleId,
  type RuleCard,
  type RuleId,
  type ShipClass,
  type Stance,
  type StanceSwitch,
} from './types';

export const TICK_HZ = 10;
export const DT = 1 / TICK_HZ;

export interface ShipStats {
  name: string;
  short: string;
  role: string;
  slots: number;
  cost: number;
  hull: number;
  speed: number;
  cargo: number;
  damage: number; // dps while in range
  range: number;
  sensor: number;
  color: string;
}

export const SHIP_STATS: Record<ShipClass, ShipStats> = {
  drone: {
    name: 'Mining drone',
    short: 'Drone',
    role: 'Mines ore, small load',
    slots: 1,
    cost: 40,
    hull: 20,
    speed: 11,
    cargo: 10,
    damage: 0,
    range: 0,
    sensor: 0,
    color: '#7fd4ff',
  },
  barge: {
    name: 'Mining barge',
    short: 'Barge',
    role: 'Mobile depot, compresses ore',
    slots: 4,
    cost: 600,
    hull: 220,
    speed: 3.2,
    cargo: 400,
    damage: 0,
    range: 0,
    sensor: 0,
    color: '#ffc861',
  },
  hauler: {
    name: 'Hauler',
    short: 'Hauler',
    role: 'Shuttles barge to carrier',
    slots: 2,
    cost: 280,
    hull: 90,
    speed: 6.5,
    cargo: 180,
    damage: 0,
    range: 0,
    sensor: 0,
    color: '#b6f27a',
  },
  fighter: {
    name: 'Fighter',
    short: 'Fighter',
    role: 'Escort and intercept',
    slots: 2,
    cost: 240,
    hull: 60,
    speed: 16,
    cargo: 0,
    damage: 9,
    range: 9,
    sensor: 55,
    color: '#ff7b8a',
  },
  scout: {
    name: 'Scout',
    short: 'Scout',
    role: 'Finds rich veins, early warning',
    slots: 1,
    cost: 200,
    hull: 25,
    speed: 18,
    cargo: 0,
    damage: 0,
    range: 0,
    sensor: 80,
    color: '#e4a8ff',
  },
  repair: {
    name: 'Repair drone',
    short: 'Repair',
    role: 'Heals barges and fighters',
    slots: 1,
    cost: 320,
    hull: 35,
    speed: 12,
    cargo: 0,
    damage: 0,
    range: 6,
    sensor: 60,
    color: '#6effc4',
  },
  harvester: {
    name: 'Gas harvester',
    short: 'Harvester',
    role: 'Skims H2 for fusion',
    slots: 3,
    cost: 800,
    hull: 120,
    speed: 4.5,
    cargo: 60,
    damage: 0,
    range: 0,
    sensor: 0,
    color: '#ff9f5a',
  },
};

export const MINING_RATE = 2.4; // ore units per second for a drone
export const DOCK_RADIUS = 4;
export const CARRIER_SENSOR = 45;
export const COVER_RADIUS = 28; // "safe" mining radius around carrier / escorted barges

export interface HangarTypeDef {
  name: string;
  blurb: string;
  launchInterval: number;
  repairRate: number; // hull fraction per second while docked
  storage: number; // extra carrier ore storage
  /** Furthest zone tier needed to install it. */
  tier: 1 | 2 | 3;
  /** Multiplier on reserve rebuild cooldowns while at least one is installed. */
  rebuildMult?: number;
}

export const HANGAR_TYPES: Record<HangarType, HangarTypeDef> = {
  launch: {
    name: 'Launch bay',
    blurb: 'Fast launch',
    launchInterval: 0.35,
    repairRate: 0.04,
    storage: 0,
    tier: 1,
  },
  drydock: {
    name: 'Dry dock',
    blurb: 'Fast repairs',
    launchInterval: 1.2,
    repairRate: 0.2,
    storage: 0,
    tier: 2,
  },
  cargo: {
    name: 'Cargo bay',
    blurb: '+1500 carrier ore storage',
    launchInterval: 1.0,
    repairRate: 0.04,
    storage: 1500,
    tier: 1,
  },
  fabricator: {
    name: 'Fabrication bay',
    blurb: 'Reserve rebuilds 40 % faster',
    launchInterval: 0.8,
    repairRate: 0.08,
    storage: 0,
    tier: 3,
    rebuildMult: 0.6,
  },
};

/** Why a hangar type can't be installed yet, or null. */
export function hangarLocked(type: HangarType, furthestTier: number): string | null {
  const t = HANGAR_TYPES[type].tier;
  if (furthestTier >= t) return null;
  return `${HANGAR_TYPES[type].name}s unlock in ${t === 2 ? 'the frontier' : 'deep space'}`;
}

export const BASE_STORAGE = 2000;
/** Past these the cost ramps much harder; there is no hard cap (#61). */
export const SOFT_HANGAR_SLOTS = 12;
export const SOFT_HANGARS = 5;
export const HANGAR_SLOT_COST = (slots: number) => {
  const base = 120 * Math.pow(1.45, slots - 6);
  const over = Math.max(0, slots - SOFT_HANGAR_SLOTS);
  return Math.round(base * Math.pow(1.5, over));
};
export const NEW_HANGAR_COST = (count: number) => {
  const base = 1500 * Math.pow(3, count - 2);
  const over = Math.max(0, count - SOFT_HANGARS);
  return Math.round(base * Math.pow(2, over));
};

export const DEFAULT_STANCE: Stance = {
  engagement: 'defensive',
  underFire: 'retreatHull',
  retreatAt: 0.3,
  mining: 'safe',
};

// ---------- Rule cards (#82) ----------
// Player-facing text for the vocabulary lives in ui/cardText.ts, out of the worker bundle.

/** Card slots on the Doctrine panel. A research/automation unlock can raise this later. */
export const CARD_SLOTS = 12;
export const MAX_CONDITIONS = 3;

export interface ValueDef {
  min: number;
  max: number;
  step: number;
  /** Fractions show as percent, otherwise km. */
  pct: boolean;
  def: number;
}

export interface ConditionDef {
  value?: ValueDef;
  /** Reads the unit itself (cargo, hull, position), so it cannot gate a carrier action. */
  ship: boolean;
}

const frac = (min: number, max: number, def: number): ValueDef => ({
  min,
  max,
  step: 0.05,
  pct: true,
  def,
});
const kms = (min: number, max: number, step: number, def: number): ValueDef => ({
  min,
  max,
  step,
  pct: false,
  def,
});

export const CONDITION_DEFS: Record<ConditionKind, ConditionDef> = {
  cargoAbove: { value: frac(0.05, 1, 0.8), ship: true },
  hullBelow: { value: frac(0.05, 0.95, 0.3), ship: true },
  // 0 means anywhere in the system. Without a unit it measures from the carrier.
  pirateWithin: { value: kms(0, 100, 2, 28), ship: false },
  wave: { ship: false },
  energyBelow: { value: frac(0.05, 0.95, 0.25), ship: false },
  shieldBelow: { value: frac(0.05, 0.9, 0.2), ship: false },
  storm: { ship: false },
  asteroidFarther: { value: kms(5, 100, 5, 30), ship: true },
  carrierFarther: { value: kms(0, 60, 5, 15), ship: true },
  always: { ship: false },
};

export interface ActionDef {
  /** Unlocking this preset unlocks the action for every card. */
  unlock: RuleId;
  /** Ship types the action affects; null for carrier actions (fleet scope only). */
  classes: ShipClass[] | null;
}

export const ACTION_DEFS: Record<ActionKind, ActionDef> = {
  stance: { unlock: 'fightersEscortOnWave', classes: SHIP_CLASSES },
  fallBack: { unlock: 'bargeFallBack', classes: SHIP_CLASSES },
  unloadAtBarge: { unlock: 'droneUnloadAtBarge', classes: ['drone'] },
  callHauler: { unlock: 'bargeCallHauler', classes: ['barge'] },
  park: { unlock: 'haulerPark', classes: ['hauler'] },
  recall: { unlock: 'recallOnLowShields', classes: SHIP_CLASSES },
  shelter: { unlock: 'harvesterStormShelter', classes: ['harvester'] },
  reserveWarp: { unlock: 'reserveWarpEnergy', classes: null },
};

export const STANCE_SWITCHES: StanceSwitch[] = [
  'engagement:aggressive',
  'engagement:defensive',
  'engagement:escort',
  'engagement:passive',
  'underFire:stand',
  'underFire:retreatHull',
  'underFire:retreatCargo',
  'mining:greedy',
  'mining:safe',
];

export interface PresetDef {
  card: Pick<RuleCard, 'scope' | 'when' | 'then'>;
  /** Index of the condition whose value the old rule's `param` set. */
  param?: number;
}

const preset = (
  scope: RuleCard['scope'],
  when: RuleCard['when'],
  then: RuleCard['then'],
  param?: number,
): PresetDef => ({ card: { scope, when, then }, param });
const cls = (c: ShipClass): RuleCard['scope'] => ({ kind: 'class', cls: c });
const FLEET: RuleCard['scope'] = { kind: 'fleet' };
const ALWAYS = [{ kind: 'always' as const }];

/** The fixed rules from before #82, as cards. Behaviour is identical (cards.golden.test.ts). */
export const PRESETS: Record<RuleId, PresetDef> = {
  fightersEscortOnWave: preset(cls('fighter'), [{ kind: 'wave' }], {
    kind: 'stance',
    to: 'engagement:escort',
  }),
  bargeCallHauler: preset(
    cls('barge'),
    [{ kind: 'cargoAbove', value: 0.8 }],
    { kind: 'callHauler' },
    0,
  ),
  bargeFallBack: preset(cls('barge'), [{ kind: 'pirateWithin', value: 28 }], { kind: 'fallBack' }),
  droneUnloadAtBarge: preset(
    cls('drone'),
    [{ kind: 'carrierFarther', value: 15 }],
    { kind: 'unloadAtBarge' },
    0,
  ),
  haulerPark: preset(cls('hauler'), ALWAYS, { kind: 'park' }),
  recallOnLowShields: preset(
    FLEET,
    [{ kind: 'shieldBelow', value: 0.2 }, { kind: 'pirateWithin' }],
    { kind: 'recall' },
    0,
  ),
  reserveWarpEnergy: preset(FLEET, ALWAYS, { kind: 'reserveWarp' }),
  harvesterStormShelter: preset(cls('harvester'), [{ kind: 'storm' }], { kind: 'shelter' }),
};

export const STARTER_RULES: RuleId[] = ['droneUnloadAtBarge', 'bargeCallHauler', 'haulerPark'];

// ---------- Zones ----------

export const TIER_NAMES = { 1: 'Starter', 2: 'Frontier', 3: 'Deep space' } as const;

export const ORE_BY_TIER: Record<number, { name: string; value: number; weight: number }[]> = {
  1: [
    { name: 'Ferrite', value: 1, weight: 6 },
    { name: 'Silicate', value: 2, weight: 3 },
    { name: 'Cobaltite', value: 4, weight: 1 },
  ],
  2: [
    { name: 'Cobaltite', value: 4, weight: 5 },
    { name: 'Iridium', value: 8, weight: 3 },
    { name: 'Palladium', value: 14, weight: 1 },
  ],
  3: [
    { name: 'Palladium', value: 14, weight: 4 },
    { name: 'Xenotite', value: 28, weight: 3 },
    { name: 'Void crystal', value: 60, weight: 1 },
  ],
};

export const ZONE_UNLOCKS: Record<number, ShipClass[]> = {
  1: ['drone', 'barge', 'hauler', 'scout'],
  2: ['fighter', 'repair'],
  3: [],
};
/** Deep space also unlocks the fabrication bay (see HANGAR_TYPES tiers). */
export const ZONE_RULE_UNLOCKS: Record<number, RuleId[]> = {
  1: STARTER_RULES,
  2: ['fightersEscortOnWave', 'bargeFallBack', 'recallOnLowShields', 'reserveWarpEnergy'],
  3: ['harvesterStormShelter'],
};

// ---------- Power ----------

export const ENERGY_MAX = 1000;
export const SOLAR_RATE = 6; // energy/s at brightness 1
export const REFINE_RATE = 12; // ore units/s at refinery level 0
export const refineRate = (level: number) => REFINE_RATE * (1 + 0.5 * level);
export const REFINERY_COST = (level: number) => Math.round(600 * Math.pow(2.2, level));
export const MAX_REFINERY = 8;
export const REFINE_ENERGY = 0.35; // energy per ore unit
export const FUSION_RATE = 25; // energy/s while burning H2
export const FUSION_H2 = 0.5; // H2 per second burnt
/**
 * Power upkeep (#60), energy/s. Each hangar draws more than the one before it
 * (`HANGAR_UPKEEP(i)` for the i-th, 0-based), and every ship that is out of the
 * carrier (not docked) draws its class rate on top. Docked ships cost nothing.
 * Upkeep is paid before shields and refining, so it eats into the refinery's
 * share of the pool: energy, not a ship count, is what limits a fleet. At zero
 * the carrier is never stranded: solar keeps trickling, unpaid upkeep is waived,
 * hangars hold launches, and ships between jobs dock until the pool can pay.
 */
export const HANGAR_UPKEEP = (index: number) => 0.03 * Math.pow(1.9, index);
export const SHIP_UPKEEP: Record<ShipClass, number> = {
  drone: 0.006,
  barge: 0.04,
  hauler: 0.02,
  fighter: 0.02,
  scout: 0.01,
  repair: 0.02,
  harvester: 0.03,
};
export const SHIELD_ENERGY_PER_DMG = 1.2;
export const SHIELD_REGEN = 0.03; // per second
export const SHIELD_REGEN_ENERGY = 4; // energy/s while regenerating
export const WARP_CHARGE = 15;
export const warpCost = (from: number, to: number, mult = 1) =>
  Math.round((250 + 150 * Math.abs(from - to)) * mult);
// Emergency warp fuel: H2 per missing energy. Fusion yields 50 energy per H2 (0.02 H2/energy),
// so burning H2 at the drive (0.1 H2/energy) is 5x worse and the reactor stays the efficient path.
export const WARP_H2_PER_ENERGY = 0.1;
/** Split a warp cost between energy and H2 (energy first); null if both together can't cover it. */
export const warpPayment = (cost: number, energy: number, h2: number) => {
  const e = Math.min(cost, Math.max(0, energy));
  const gap = cost - e;
  const need = Math.ceil(gap * WARP_H2_PER_ENERGY);
  return h2 + 1e-9 < need ? null : { energy: e, h2: need };
};

// ---------- Hull classes (#65) ----------

export interface HullDef {
  name: string;
  blurb: string;
  /** Hangars a new run starts with, and the slots in each. */
  start: HangarType[];
  slots: number;
  /** Slots in a hangar bought later (before the `slots` research). */
  newSlots: number;
  hull: number; // carrier hull points
  energy: number; // multiplier on the energy pool
  refinery: number; // multiplier on refinery throughput
  warpCharge: number; // multiplier on charge time
  warpCost: number; // multiplier on jump energy
  shield: number; // multiplier on shield regeneration
  /** Unlocks once this zone tier has been reached on a run after the first prestige. */
  tier: 1 | 2 | 3;
}

export const HULLS: Record<HullId, HullDef> = {
  standard: {
    name: 'Standard carrier',
    blurb: 'Balanced',
    start: ['launch', 'cargo'],
    slots: 6,
    newSlots: 4,
    hull: 2000,
    energy: 1,
    refinery: 1,
    warpCharge: 1,
    warpCost: 1,
    shield: 1,
    tier: 1,
  },
  light: {
    name: 'Light carrier',
    blurb: 'Fast, cheap warps; one hangar to start; frail',
    start: ['launch'],
    slots: 6,
    newSlots: 4,
    hull: 1200,
    energy: 0.8,
    refinery: 0.8,
    warpCharge: 0.5,
    warpCost: 0.6,
    shield: 1,
    tier: 2,
  },
  fleet: {
    name: 'Fleet carrier',
    blurb: 'Three hangars to start, big energy pool; slow warps',
    start: ['launch', 'cargo', 'launch'],
    slots: 6,
    newSlots: 6,
    hull: 2600,
    energy: 1.4,
    refinery: 1,
    warpCharge: 1.3,
    warpCost: 1.3,
    shield: 1,
    tier: 2,
  },
  mining: {
    name: 'Mining mothership',
    blurb: 'Double refinery throughput; small hangars',
    start: ['launch', 'cargo'],
    slots: 4,
    newSlots: 3,
    hull: 2000,
    energy: 1.2,
    refinery: 2,
    warpCharge: 1.2,
    warpCost: 1.2,
    shield: 1,
    tier: 3,
  },
  bastion: {
    name: 'Bastion',
    blurb: 'Heavy hull, shields regenerate twice as fast; weak refinery',
    start: ['launch', 'cargo'],
    slots: 5,
    newSlots: 4,
    hull: 3500,
    energy: 1.5,
    refinery: 0.7,
    warpCharge: 1.5,
    warpCost: 1.4,
    shield: 2,
    tier: 3,
  },
};

export const HULL_IDS = Object.keys(HULLS) as HullId[];

// ---------- Pirates ----------

export const WAVE_INTERVAL = (tier: number) => (tier >= 3 ? 70 : 110);
export const WAVE_WARNING = 15;
export const PIRATE_BASE = { hull: 45, damage: 5, speed: 9 };

// ---------- Gas giants ----------

/** H2 storms hit ships within this distance of the gas giant, cover or not. */
export const H2_STORM_RADIUS = 45;
export const H2_STORM_DPS = 3;
/** Harvesters skim this much faster while an H2 storm churns the clouds. */
export const H2_STORM_YIELD = 2;
/** Pirates in gas giant systems weigh harvesters this much more. */
export const GAS_PIRATE_HARVESTER_BIAS = 3;

// ---------- Prestige ----------

/**
 * RP = floor(sqrt(ore value delivered / D)) * furthest tier.
 * The concept doc's placeholder uses D = 1,000,000; this build uses 10,000 so a
 * first run pays out in about an hour. Tune here.
 */
export const RP_DIVISOR = 10_000;
export const OFFLINE_EFFICIENCY = 0.5;
export const OFFLINE_CAP_S = 12 * 3600;

// ---------- Modules ----------

export interface ModuleDef {
  name: string;
  short: string;
  desc: string;
  cost: number;
  /** Classes that can fit it. */
  fits: ShipClass[];
  /** Furthest zone tier needed to fit it. */
  tier: 1 | 2;
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  laser: {
    name: 'Mining laser',
    short: 'Laser',
    desc: '+30 % mining and skimming rate; fighters +20 % damage',
    cost: 160,
    fits: ['drone', 'harvester', 'fighter'],
    tier: 1,
  },
  drill: {
    name: 'Core drill',
    short: 'Drill',
    desc: 'Mined ore is worth +15 %',
    cost: 180,
    fits: ['drone'],
    tier: 1,
  },
  tractor: {
    name: 'Tractor beam',
    short: 'Tractor',
    desc: '+25 % speed',
    cost: 120,
    fits: ['drone', 'barge', 'hauler', 'scout', 'repair', 'harvester'],
    tier: 1,
  },
  shield: {
    name: 'Shield emitter',
    short: 'Shield',
    desc: '-35 % damage taken',
    cost: 150,
    fits: ['drone', 'barge', 'hauler', 'fighter', 'scout', 'repair', 'harvester'],
    tier: 2,
  },
  compressor: {
    name: 'Ore compressor',
    short: 'Compr.',
    desc: '+40 % cargo hold',
    cost: 140,
    fits: ['drone', 'barge', 'hauler', 'harvester'],
    tier: 1,
  },
};

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];

/** Module slots per ship class. */
export const MODULE_SLOTS: Record<ShipClass, number> = {
  drone: 1,
  barge: 2,
  hauler: 1,
  fighter: 2,
  scout: 1,
  repair: 1,
  harvester: 2,
};

export const LASER_RATE = 1.3;
export const LASER_DAMAGE = 1.2;
export const DRILL_VALUE = 1.15;
export const TRACTOR_SPEED = 1.25;
export const SHIELD_TAKEN = 0.65;
export const COMPRESSOR_CARGO = 1.4;

/** Why a module can't go on this class yet, or null. */
export function moduleLocked(id: ModuleId, cls: ShipClass, furthestTier: number): string | null {
  const m = MODULES[id];
  if (!m.fits.includes(cls)) return `${m.name} does not fit a ${SHIP_STATS[cls].short}`;
  if (furthestTier < m.tier) return `${m.name}s unlock in the frontier`;
  return null;
}

// ---------- Scouts ----------

/** A scout counts a cluster surveyed once it is this close to its center. */
export const SURVEY_RADIUS = 8;
/** Rocks within this distance of a surveyed center are scanned for veins. */
export const VEIN_SCAN_RADIUS = 18;
/** Rocks worth at least this share of the system's best ore are marked as veins. */
export const VEIN_VALUE_SHARE = 0.5;
/** Drones score a revealed vein this much higher. */
export const VEIN_BONUS = 1.5;
