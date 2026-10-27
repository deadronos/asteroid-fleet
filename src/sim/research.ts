import { HANGAR_TYPES, ZONE_RULE_UNLOCKS } from './config';
import { unlockRule } from './state';
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
  desc: string;
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
    desc: '+20 % barge capacity',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'haulSpeed',
    branch: 'Logistics',
    name: 'Hauler thrusters',
    desc: '+12 % hauler speed',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'yield',
    branch: 'Mining',
    name: 'Drill heads',
    desc: '+15 % mining yield',
    maxLevel: 8,
    cost: lin(1, 1),
  },
  {
    id: 'droneCargo',
    branch: 'Mining',
    name: 'Drone holds',
    desc: '+20 % drone cargo',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'rich',
    branch: 'Mining',
    name: 'Vein mapping',
    desc: '+10 % ore value',
    maxLevel: 5,
    cost: lin(2, 2),
    requires: 'yield',
  },
  {
    id: 'damage',
    branch: 'Combat',
    name: 'Pulse lasers',
    desc: '+15 % fighter damage',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'armor',
    branch: 'Combat',
    name: 'Composite armor',
    desc: '+15 % hull for all ships',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'repair',
    branch: 'Combat',
    name: 'Field repair',
    desc: '+30 % repair speed',
    maxLevel: 3,
    cost: lin(1, 2),
  },
  {
    id: 'energyCap',
    branch: 'Carrier',
    name: 'Capacitors',
    desc: '+25 % energy capacity',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'solar',
    branch: 'Carrier',
    name: 'Solar sails',
    desc: '+20 % solar recharge',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'warpCharge',
    branch: 'Carrier',
    name: 'Jump spool',
    desc: '-15 % warp charge time',
    maxLevel: 3,
    cost: lin(2, 1),
  },
  {
    id: 'fusion',
    branch: 'Carrier',
    name: 'Fusion reactor',
    desc: 'Burns H2 from gas giants for energy; unlocks the gas harvester',
    maxLevel: 1,
    cost: () => 4,
  },
  {
    id: 'slots',
    branch: 'Carrier',
    name: 'Hangar frames',
    desc: 'Every run starts with +1 slot per hangar',
    maxLevel: 3,
    cost: lin(2, 2),
  },
  {
    id: 'startCredits',
    branch: 'Carrier',
    name: 'Venture capital',
    desc: '+250 starting credits',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'reserveDrone',
    branch: 'Reserves',
    name: 'Drone reserve',
    desc: 'Keep at least 2 drones per level; one rebuilt every 2 min',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'reserveFighter',
    branch: 'Reserves',
    name: 'Fighter reserve',
    desc: 'Keep at least 1 fighter per level; one rebuilt every 5 min',
    maxLevel: 3,
    cost: lin(2, 2),
  },
  {
    id: 'reserveCd',
    branch: 'Reserves',
    name: 'Fabricator',
    desc: '-20 % rebuild cooldown',
    maxLevel: 3,
    cost: lin(2, 1),
    requires: 'reserveDrone',
  },
  {
    id: 'rare',
    branch: 'Mining',
    name: 'Rare strikes',
    desc: '+4 % chance per level that a new asteroid is rare ore (x2.5 value)',
    maxLevel: 5,
    cost: lin(2, 1),
    requires: 'yield',
  },
  {
    id: 'sublight',
    branch: 'Carrier',
    name: 'Sublight drive',
    desc: '+20 % carrier drift speed',
    maxLevel: 4,
    cost: lin(1, 1),
  },
  {
    id: 'reserveBarge',
    branch: 'Reserves',
    name: 'Barge reserve',
    desc: 'Keep at least 1 barge per level; one rebuilt every 8 min',
    maxLevel: 2,
    cost: lin(3, 3),
  },
  {
    id: 'reserveHauler',
    branch: 'Reserves',
    name: 'Hauler reserve',
    desc: 'Keep at least 1 hauler per level; one rebuilt every 5 min',
    maxLevel: 2,
    cost: lin(2, 2),
  },
  // Automation is the reward for research: the fleet starts running itself.
  {
    id: 'tactics',
    branch: 'Automation',
    name: 'Tactical doctrine',
    desc: 'Unlocks engagement stances and the frontier rule cards without reaching the frontier',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'autoRebuild',
    branch: 'Automation',
    name: 'Replacement orders',
    desc: 'Lost ships of any class are rebuilt into their hangar, paid with credits',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'autoBuy',
    branch: 'Automation',
    name: 'Fleet requisition',
    desc: 'Spare credits buy toward each hangar target composition',
    maxLevel: 1,
    cost: () => 4,
    requires: 'autoRebuild',
  },
  // Deep-space research: only for fleets that made it to tier 3 this run.
  {
    id: 'voidRefining',
    branch: 'Carrier',
    name: 'Void refining',
    desc: '+25 % refinery throughput',
    maxLevel: 3,
    cost: lin(4, 2),
    tier: 3,
  },
  {
    id: 'stormShielding',
    branch: 'Combat',
    name: 'Storm shielding',
    desc: '-30 % storm damage to ships',
    maxLevel: 2,
    cost: lin(3, 2),
    tier: 3,
  },
  {
    id: 'deepFabrication',
    branch: 'Reserves',
    name: 'Deep fabrication',
    desc: '-15 % rebuild cooldown, stacks with Fabricator',
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
    desc: 'Drones mine 10 % faster per drone in the same hangar (max +50 %)',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'bargeBay',
    branch: 'barge',
    name: 'Barge drone bay',
    desc: 'Barges get +50 % hull, repair docked drones and carry a drone that launches from and docks at the barge',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'haulerArmor',
    branch: 'hauler',
    name: 'Armored holds',
    desc: 'Haulers take 40 % less damage',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'fighterAce',
    branch: 'fighter',
    name: 'Ace wings',
    desc: 'Fighters in a hangar of only fighters gain +25 % damage',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'scoutRelay',
    branch: 'scout',
    name: 'Sensor relay',
    desc: 'Each scout adds +10 s pirate wave warning',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'repairNano',
    branch: 'repair',
    name: 'Nano swarm',
    desc: 'Repair drones heal everything in range',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'droneSpeed',
    branch: 'drone',
    name: 'Ion drives',
    desc: '+15 % drone speed',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'droneHull',
    branch: 'drone',
    name: 'Hardened drills',
    desc: '+30 % drone hull',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'bargeThrust',
    branch: 'barge',
    name: 'Barge thrusters',
    desc: '+25 % barge speed',
    maxLevel: 2,
    cost: lin(2, 1),
  },
  {
    id: 'bargeShell',
    branch: 'barge',
    name: 'Reinforced shell',
    desc: '-25 % damage to barges',
    maxLevel: 2,
    cost: lin(2, 2),
  },
  {
    id: 'haulerHold',
    branch: 'hauler',
    name: 'Extended holds',
    desc: '+25 % hauler cargo',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'haulerHull',
    branch: 'hauler',
    name: 'Bulkheads',
    desc: '+40 % hauler hull',
    maxLevel: 2,
    cost: lin(1, 1),
  },
  {
    id: 'fighterRange',
    branch: 'fighter',
    name: 'Long-range optics',
    desc: '+20 % fighter range',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'fighterHull',
    branch: 'fighter',
    name: 'Ablative plating',
    desc: '+25 % fighter hull',
    maxLevel: 3,
    cost: lin(1, 2),
  },
  {
    id: 'scoutSpeed',
    branch: 'scout',
    name: 'Scout engines',
    desc: '+25 % scout speed',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'scoutSurvey',
    branch: 'scout',
    name: 'Deep survey',
    desc: 'Scouts raise the rich-ore bonus of respawned asteroids by +50 %',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'repairBeam',
    branch: 'repair',
    name: 'Focused beams',
    desc: '+25 % repair-drone healing',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'repairSpeed',
    branch: 'repair',
    name: 'Repair thrusters',
    desc: '+25 % repair-drone speed',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'harvestCargo',
    branch: 'harvester',
    name: 'Larger tanks',
    desc: '+25 % harvester H2 capacity',
    maxLevel: 3,
    cost: lin(1, 1),
    requires: 'fusion',
  },
  {
    id: 'harvestSpeed',
    branch: 'harvester',
    name: 'Skimmer thrusters',
    desc: '+20 % harvester speed',
    maxLevel: 3,
    cost: lin(1, 1),
    requires: 'fusion',
  },
  {
    id: 'harvestHull',
    branch: 'harvester',
    name: 'Gas-proof hull',
    desc: '+30 % harvester hull',
    maxLevel: 2,
    cost: lin(1, 2),
    requires: 'fusion',
  },
  // Repeatable sinks (#64): unlimited levels, geometric cost, diminishing returns.
  {
    id: 'deepYield',
    branch: 'Mining',
    name: 'Deep-core drilling',
    desc: 'Repeatable; mining yield, diminishing toward +100 %',
    maxLevel: Infinity,
    cost: geo(10, 1.25),
    repeat: { base: 'yield', cap: 1, label: (e) => `+${pct(e)} % mining yield` },
  },
  {
    id: 'deepEnergy',
    branch: 'Carrier',
    name: 'Superconducting banks',
    desc: 'Repeatable; energy capacity, diminishing toward +100 %',
    maxLevel: Infinity,
    cost: geo(10, 1.25),
    repeat: { base: 'energyCap', cap: 1, label: (e) => `+${pct(e)} % energy capacity` },
  },
  {
    id: 'deepLaunch',
    branch: 'Carrier',
    name: 'Catapult rails',
    desc: 'Repeatable; hangar launch interval, diminishing toward −50 %',
    maxLevel: Infinity,
    cost: geo(10, 1.25),
    // No finite node touches launch speed; Hangar frames is the closest hangar node.
    repeat: { base: 'slots', cap: 0.5, label: (e) => `−${pct(e)} % launch interval` },
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

/** Reserve classes, their minimum count and rebuild cooldown (seconds). */
export function reserveDefs(s: Sim): [ShipClass, number, number][] {
  let cd = (1 - 0.2 * lvl(s, 'reserveCd')) * (1 - 0.15 * lvl(s, 'deepFabrication'));
  // A fabrication bay speeds rebuilds; more than one doesn't stack.
  cd *= Math.min(1, ...s.hangars.map((h) => HANGAR_TYPES[h.type].rebuildMult ?? 1));
  return [
    ['drone', 2 * lvl(s, 'reserveDrone'), 120 * cd],
    ['fighter', lvl(s, 'reserveFighter'), 300 * cd],
    ['barge', lvl(s, 'reserveBarge'), 480 * cd],
    ['hauler', lvl(s, 'reserveHauler'), 300 * cd],
  ];
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
  if (id === 'tactics') for (const rid of ZONE_RULE_UNLOCKS[2]) unlockRule(s, rid);
  return true;
}
