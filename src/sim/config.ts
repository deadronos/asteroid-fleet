import type { HangarType, ModuleId, RuleId, ShipClass, Stance } from './types';

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
export const HANGAR_SLOT_COST = (slots: number) => Math.round(120 * Math.pow(1.45, slots - 6));
export const NEW_HANGAR_COST = (count: number) => Math.round(1500 * Math.pow(3, count - 2));
export const MAX_HANGAR_SLOTS = 12;
export const MAX_HANGARS = 5;

export const DEFAULT_STANCE: Stance = {
  engagement: 'defensive',
  underFire: 'retreatHull',
  retreatAt: 0.3,
  mining: 'safe',
};

export interface RuleDef {
  unit: string;
  when: string;
  then: string;
  param?: { label: string; min: number; max: number; step: number; fmt: (v: number) => string };
  defaultParam: number;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

export const RULE_DEFS: Record<RuleId, RuleDef> = {
  fightersEscortOnWave: {
    unit: 'All fighters',
    when: 'Pirate wave announced',
    then: 'Switch to Escort',
    defaultParam: 0,
  },
  bargeCallHauler: {
    unit: 'Barge',
    when: 'Cargo above',
    then: 'Call a hauler',
    param: { label: 'cargo', min: 0.2, max: 1, step: 0.05, fmt: pct },
    defaultParam: 0.8,
  },
  bargeFallBack: {
    unit: 'Barge',
    when: 'Pirate in range',
    then: 'Fall back to the carrier',
    defaultParam: 0,
  },
  droneUnloadAtBarge: {
    unit: 'Drone',
    when: 'Asteroid farther than',
    then: 'Unload at the nearest barge instead of the carrier',
    param: { label: 'distance', min: 0, max: 60, step: 5, fmt: (v) => `${v} km` },
    defaultParam: 15,
  },
  haulerPark: { unit: 'Hauler', when: 'No job', then: 'Park at the carrier', defaultParam: 0 },
  recallOnLowShields: {
    unit: 'All ships',
    when: 'Carrier shields below',
    then: 'Recall to the hangars',
    param: { label: 'shields', min: 0.05, max: 0.9, step: 0.05, fmt: pct },
    defaultParam: 0.2,
  },
  reserveWarpEnergy: {
    unit: 'Carrier',
    when: 'Energy below warp cost',
    then: 'Pause refining to keep a jump in reserve',
    defaultParam: 0,
  },
  harvesterStormShelter: {
    unit: 'Gas harvester',
    when: 'H2 storm',
    then: 'Shelter at the carrier until it passes',
    defaultParam: 0,
  },
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
export const warpCost = (from: number, to: number) => 250 + 150 * Math.abs(from - to);

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
