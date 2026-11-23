import { HANGAR_TYPES, ZONE_RULE_UNLOCKS } from './config';
import { carrierMaxHull, unlockRule } from './state';
import type { Sim, ShipClass } from './types';

export type Branch =
  | 'Logistics'
  | 'Mining'
  | 'Combat'
  | 'Carrier'
  | 'Reserves'
  | 'Automation'
  | ShipClass;

export interface ResearchNode {
  id: string;
  branch: Branch;
  name: string;
  maxLevel: number;
  cost: (level: number) => number; // cost of buying the next level
  requires?: string;
  /** Furthest zone tier this run must have reached before buying a level. */
  tier?: 2 | 3;
  /** Repeatable sink (#64): no max level, needs `base` maxed, soft-capped effect. */
  repeat?: Repeat;
}

export interface Repeat {
  /** Finite node that must be maxed first. */
  base: string;
  /** Effect approached as the level grows (0.5 = +50 %). */
  cap: number;
  /** Text for the current effect, e.g. "+12 % mining yield". */
  label: (effect: number) => string;
}

/** Each level closes this share of the remaining gap to the cap. */
export const SOFTCAP_STEP = 0.08;

/** Per-level research scalars (#250). */
export const SCALE_HULL_ARMOR = 0.15;
export const SCALE_HULL_DRONE = 0.3;
export const SCALE_HULL_HAULER = 0.4;
export const SCALE_HULL_FIGHTER = 0.25;
export const SCALE_HULL_HARVESTER = 0.3;
export const SCALE_HULL_FRAME = 0.12;
export const SCALE_HULL_BARGEBAYFLAT = 1.5;
export const SCALE_HULL_HAULERARMORFLAT = 0.6;
export const SCALE_ENERGY_CAPACITY = 0.25;
export const SCALE_ENERGY_REACTOR = 0.1;
export const SCALE_ENERGY_VOIDREFINING = 0.25;
export const SCALE_ENERGY_SOLAR = 0.2;
export const SCALE_ENERGY_LAUNCHINTERVAL = 0.08;
export const SCALE_ENERGY_WARPCHARGE = 0.15;
export const SCALE_ENERGY_JUMPCOST = 0.05;
export const SCALE_CARGO_BARGE = 0.2;
export const SCALE_CARGO_DRONE = 0.2;
export const SCALE_CARGO_HAULER = 0.25;
export const SCALE_CARGO_HARVESTER = 0.25;
export const SCALE_SPEED_HAULER = 0.12;
export const SCALE_SPEED_DRONE = 0.15;
export const SCALE_SPEED_BARGE = 0.25;
export const SCALE_SPEED_SCOUT = 0.25;
export const SCALE_SPEED_REPAIR = 0.25;
export const SCALE_SPEED_HARVESTER = 0.2;
export const SCALE_SPEED_DRIFT = 0.2;
export const SCALE_COMBAT_DAMAGE = 0.15;
export const SCALE_COMBAT_FIGHTERACEFLAT = 1.25;
export const SCALE_COMBAT_FIGHTERRANGE = 0.2;
export const SCALE_COMBAT_BARGESHELL = 0.25;
export const SCALE_COMBAT_STORMSHIELDING = 0.3;
export const SCALE_COMBAT_WARNINGPERSENSORS = 5;
export const SCALE_COMBAT_WARNINGPERRELAY = 10;
export const SCALE_MINING_YIELD = 0.15;
export const SCALE_MINING_SWARMPERDRONE = 0.1;
export const SCALE_MINING_SWARMCAP = 0.5;
export const SCALE_REPAIR_FIELD = 0.3;
export const SCALE_REPAIR_BEAM = 0.25;
export const SCALE_WORLD_RARECHANCE = 0.04;
export const SCALE_WORLD_RAREVALUEFLAT = 2.5;
export const SCALE_WORLD_RICHVALUE = 0.1;
export const SCALE_WORLD_SCOUTSURVEY = 0.5;
export const SCALE_WORLD_STARTCREDITS = 250;
export const SCALE_WORLD_RESERVECD = 0.2;
export const SCALE_WORLD_DEEPFABRICATION = 0.15;

/** Soft-capped effect of a repeatable node: cap × (1 − (1 − step)^level). */
export function softcap(level: number, cap: number): number {
  return cap * (1 - Math.pow(1 - SOFTCAP_STEP, level));
}

/** Geometric cost for repeatable nodes. */
const geo = (base: number, ratio: number) => (lvl: number) => Math.ceil(base * ratio ** lvl);

const lin = (base: number, step: number) => (lvl: number) => base + step * lvl;

export const RESEARCH: ResearchNode[] = [
  // Global branches carry the steady incremental growth.
  {
    id: 'bargeCap',
    branch: 'Logistics',
    name: 'Compression',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'haulSpeed',
    branch: 'Logistics',
    name: 'Hauler thrusters',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'yield',
    branch: 'Mining',
    name: 'Drill heads',
    maxLevel: 8,
    cost: lin(1, 1),
  },
  {
    id: 'droneCargo',
    branch: 'Mining',
    name: 'Drone holds',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'rich',
    branch: 'Mining',
    name: 'Vein mapping',
    maxLevel: 5,
    cost: lin(2, 2),
    requires: 'yield',
  },
  {
    id: 'damage',
    branch: 'Combat',
    name: 'Pulse lasers',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'turretDamage',
    branch: 'Combat',
    name: 'Turret capacitors',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'turretRange',
    branch: 'Combat',
    name: 'Fire control',
    maxLevel: 3,
    cost: lin(1, 1),
    requires: 'turretDamage',
  },
  {
    id: 'armor',
    branch: 'Combat',
    name: 'Composite armor',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'repair',
    branch: 'Combat',
    name: 'Field repair',
    maxLevel: 3,
    cost: lin(1, 2),
  },
  {
    id: 'energyCap',
    branch: 'Carrier',
    name: 'Capacitors',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'solar',
    branch: 'Carrier',
    name: 'Solar sails',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'warpCharge',
    branch: 'Carrier',
    name: 'Jump spool',
    maxLevel: 3,
    cost: lin(2, 1),
  },
  {
    id: 'fusion',
    branch: 'Carrier',
    name: 'Fusion reactor',
    maxLevel: 1,
    cost: () => 4,
  },
  {
    id: 'slots',
    branch: 'Carrier',
    name: 'Hangar frames',
    maxLevel: 3,
    cost: lin(2, 2),
  },
  {
    id: 'startCredits',
    branch: 'Carrier',
    name: 'Venture capital',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'reserveDrone',
    branch: 'Reserves',
    name: 'Drone reserve',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'reserveFighter',
    branch: 'Reserves',
    name: 'Fighter reserve',
    maxLevel: 3,
    cost: lin(2, 2),
  },
  {
    id: 'reserveCd',
    branch: 'Reserves',
    name: 'Fabricator',
    maxLevel: 3,
    cost: lin(2, 1),
    requires: 'reserveDrone',
  },
  {
    id: 'rare',
    branch: 'Mining',
    name: 'Rare strikes',
    maxLevel: 5,
    cost: lin(2, 1),
    requires: 'yield',
  },
  {
    id: 'sublight',
    branch: 'Carrier',
    name: 'Sublight drive',
    maxLevel: 4,
    cost: lin(1, 1),
  },
  {
    id: 'reserveBarge',
    branch: 'Reserves',
    name: 'Barge reserve',
    maxLevel: 2,
    cost: lin(3, 3),
  },
  {
    id: 'reserveHauler',
    branch: 'Reserves',
    name: 'Hauler reserve',
    maxLevel: 2,
    cost: lin(2, 2),
  },
  // Automation is the reward for research: the fleet starts running itself.
  {
    id: 'tactics',
    branch: 'Automation',
    name: 'Tactical doctrine',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'autoRebuild',
    branch: 'Automation',
    name: 'Replacement orders',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'autoBuy',
    branch: 'Automation',
    name: 'Fleet requisition',
    maxLevel: 1,
    cost: () => 4,
    requires: 'autoRebuild',
  },
  // Deep-space research: only for fleets that made it to tier 3 this run.
  {
    id: 'voidRefining',
    branch: 'Carrier',
    name: 'Void refining',
    maxLevel: 3,
    cost: lin(4, 2),
    tier: 3,
  },
  {
    id: 'stormShielding',
    branch: 'Combat',
    name: 'Storm shielding',
    maxLevel: 2,
    cost: lin(3, 2),
    tier: 3,
  },
  {
    id: 'deepFabrication',
    branch: 'Reserves',
    name: 'Deep fabrication',
    maxLevel: 2,
    cost: lin(4, 2),
    requires: 'reserveCd',
    tier: 3,
  },
  // Per-class branches feed build identity on the hangar board.
  {
    id: 'droneSwarm',
    branch: 'drone',
    name: 'Swarm logic',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'bargeBay',
    branch: 'barge',
    name: 'Barge drone bay',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'haulerArmor',
    branch: 'hauler',
    name: 'Armored holds',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'fighterAce',
    branch: 'fighter',
    name: 'Ace wings',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'scoutRelay',
    branch: 'scout',
    name: 'Sensor relay',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'repairNano',
    branch: 'repair',
    name: 'Nano swarm',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'droneSpeed',
    branch: 'drone',
    name: 'Ion drives',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'droneHull',
    branch: 'drone',
    name: 'Hardened drills',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'bargeThrust',
    branch: 'barge',
    name: 'Barge thrusters',
    maxLevel: 2,
    cost: lin(2, 1),
  },
  {
    id: 'bargeShell',
    branch: 'barge',
    name: 'Reinforced shell',
    maxLevel: 2,
    cost: lin(2, 2),
  },
  {
    id: 'haulerHold',
    branch: 'hauler',
    name: 'Extended holds',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'haulerHull',
    branch: 'hauler',
    name: 'Bulkheads',
    maxLevel: 2,
    cost: lin(1, 1),
  },
  {
    id: 'fighterRange',
    branch: 'fighter',
    name: 'Long-range optics',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'fighterHull',
    branch: 'fighter',
    name: 'Ablative plating',
    maxLevel: 3,
    cost: lin(1, 2),
  },
  {
    id: 'scoutSpeed',
    branch: 'scout',
    name: 'Scout engines',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'scoutSurvey',
    branch: 'scout',
    name: 'Deep survey',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'repairBeam',
    branch: 'repair',
    name: 'Focused beams',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'repairSpeed',
    branch: 'repair',
    name: 'Repair thrusters',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'harvestCargo',
    branch: 'harvester',
    name: 'Larger tanks',
    maxLevel: 3,
    cost: lin(1, 1),
    requires: 'fusion',
  },
  {
    id: 'harvestSpeed',
    branch: 'harvester',
    name: 'Skimmer thrusters',
    maxLevel: 3,
    cost: lin(1, 1),
    requires: 'fusion',
  },
  {
    id: 'harvestHull',
    branch: 'harvester',
    name: 'Gas-proof hull',
    maxLevel: 2,
    cost: lin(1, 2),
    requires: 'fusion',
  },
  // Carrier frame, reactor, bays and sensors (#67): improve the hull class stats.
  {
    id: 'frame',
    branch: 'Carrier',
    name: 'Reinforced frame',
    maxLevel: 5,
    cost: lin(2, 1),
  },
  {
    id: 'reactor',
    branch: 'Carrier',
    name: 'Reactor tuning',
    maxLevel: 5,
    cost: lin(2, 1),
  },
  {
    id: 'bays',
    branch: 'Carrier',
    name: 'Catapult bays',
    maxLevel: 4,
    cost: lin(2, 2),
    requires: 'slots',
  },
  {
    id: 'sensors',
    branch: 'Carrier',
    name: 'Long-range sensors',
    maxLevel: 4,
    cost: lin(2, 1),
  },
  // Repeatable sinks (#64): unlimited levels, geometric cost, diminishing returns.
  {
    id: 'deepYield',
    branch: 'Mining',
    name: 'Deep-core drilling',
    maxLevel: Infinity,
    cost: geo(10, 1.25),
    repeat: {
      base: 'yield',
      cap: 1,
      label: (e) => `+${pct(e)} % mining yield`,
    },
  },
  {
    id: 'deepEnergy',
    branch: 'Carrier',
    name: 'Superconducting banks',
    maxLevel: Infinity,
    cost: geo(10, 1.25),
    repeat: {
      base: 'energyCap',
      cap: 1,
      label: (e) => `+${pct(e)} % energy capacity`,
    },
  },
  {
    id: 'deepLaunch',
    branch: 'Carrier',
    name: 'Catapult rails',
    maxLevel: Infinity,
    cost: geo(10, 1.25),
    // No finite node touches launch speed; Hangar frames is the closest hangar node.
    repeat: {
      base: 'slots',
      cap: 0.5,
      label: (e) => `−${pct(e)} % launch interval`,
    },
  },
];

function pct(e: number): string {
  return (e * 100).toFixed(1);
}

/** Current effect of a repeatable node (0 for anything else). */
export function repeatEffect(s: Sim, id: string): number {
  const r = RESEARCH_BY_ID[id]?.repeat;
  return r ? softcap(lvl(s, id), r.cap) : 0;
}

/** True when the node's prerequisites (requires, maxed base) are not met. */
export function researchLocked(s: Sim, node: ResearchNode): boolean {
  if (node.requires && lvl(s, node.requires) === 0) return true;
  const base = node.repeat && RESEARCH_BY_ID[node.repeat.base];
  return !!base && lvl(s, base.id) < base.maxLevel;
}

export const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((r) => [r.id, r])) as Record<
  string,
  ResearchNode
>;

export function lvl(s: Sim, id: string): number {
  return s.researchLevels[id] ?? 0;
}

const RESERVE_SPECS: readonly [ShipClass, string, number, number][] = [
  ['drone', 'reserveDrone', 2, 120],
  ['fighter', 'reserveFighter', 1, 300],
  ['barge', 'reserveBarge', 1, 480],
  ['hauler', 'reserveHauler', 1, 300],
];

const reserveScratch: [ShipClass, number, number][] = [
  ['drone', 0, 0],
  ['fighter', 0, 0],
  ['barge', 0, 0],
  ['hauler', 0, 0],
];

function reserveCd(s: Sim): number {
  // A fabrication bay speeds rebuilds; more than one doesn't stack.
  let mult = 1;
  for (const h of s.hangars) {
    const m = HANGAR_TYPES[h.type].rebuildMult;
    if (m !== undefined && m < mult) mult = m;
  }
  return (
    (1 - SCALE_WORLD_RESERVECD * lvl(s, 'reserveCd')) *
    (1 - SCALE_WORLD_DEEPFABRICATION * lvl(s, 'deepFabrication')) *
    mult
  );
}

/** Zero-allocation read of `reserveDefs` into a shared tuple array; valid until the next call (#241). */
export function reserveDefsView(s: Sim): readonly (readonly [ShipClass, number, number])[] {
  const cd = reserveCd(s);
  for (let i = 0; i < RESERVE_SPECS.length; i++) {
    const [cls, node, mult, baseCd] = RESERVE_SPECS[i];
    reserveScratch[i][0] = cls;
    reserveScratch[i][1] = mult * lvl(s, node);
    reserveScratch[i][2] = baseCd * cd;
  }
  return reserveScratch;
}

/** Reserve classes, their minimum count and rebuild cooldown (seconds). */
export function reserveDefs(s: Sim): [ShipClass, number, number][] {
  const cd = reserveCd(s);
  return RESERVE_SPECS.map(([cls, node, mult, baseCd]) => [cls, mult * lvl(s, node), baseCd * cd]);
}

export function canBuyResearch(s: Sim, id: string): boolean {
  const node = RESEARCH_BY_ID[id];
  if (!node) return false;
  const l = lvl(s, id);
  if (l >= node.maxLevel) return false;
  if (researchLocked(s, node)) return false;
  if (node.tier && s.stats.furthestTier < node.tier) return false;
  return s.research >= node.cost(l);
}

export function buyResearch(s: Sim, id: string): boolean {
  if (!canBuyResearch(s, id)) return false;
  const node = RESEARCH_BY_ID[id];
  s.research -= node.cost(lvl(s, id));
  s.researchLevels[id] = lvl(s, id) + 1;
  if (id === 'fusion' && !s.unlocked.includes('harvester')) s.unlocked.push('harvester');
  if (id === 'frame') {
    const c = s.carrier;
    const max = carrierMaxHull(s);
    c.hull += max - c.maxHull;
    c.maxHull = max;
  }
  if (id === 'tactics') for (const rid of ZONE_RULE_UNLOCKS[2]) unlockRule(s, rid);
  return true;
}
