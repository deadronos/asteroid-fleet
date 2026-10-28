// Plain, JSON-serialisable game state. The whole GameState is what gets saved.

export type ShipClass = 'drone' | 'barge' | 'hauler' | 'fighter' | 'scout' | 'repair' | 'harvester';
export const SHIP_CLASSES: ShipClass[] = [
  'drone',
  'barge',
  'hauler',
  'fighter',
  'scout',
  'repair',
  'harvester',
];

export type Engagement = 'aggressive' | 'defensive' | 'escort' | 'passive';
export type UnderFire = 'stand' | 'retreatHull' | 'retreatCargo';
export type MiningStance = 'greedy' | 'safe';

export interface Stance {
  engagement: Engagement;
  underFire: UnderFire;
  /** Hull fraction (0..1) below which a ship on `retreatHull` heads home. */
  retreatAt: number;
  mining: MiningStance;
}

export interface Doctrine {
  fleet: Stance;
  byClass: Partial<Record<ShipClass, Partial<Stance>>>;
}

/** What an event kind does when it arrives. `pause` and `focus` also toast. */
export type AlertMode = 'off' | 'inbox' | 'toast' | 'pause' | 'focus';
export const ALERT_MODES: AlertMode[] = ['off', 'inbox', 'toast', 'pause', 'focus'];
export type AlertOverrides = Partial<Record<SimEventKind, AlertMode>>;

/** Alert rules: fleet-wide, with per-carrier overrides (most specific wins). A missing kind uses the built-in policy. */
export interface AlertRules {
  fleet: AlertOverrides;
  byCarrier: Record<number, AlertOverrides>;
}

export type ModuleId = 'laser' | 'drill' | 'tractor' | 'shield' | 'compressor';

/** Carrier hull class (#65). Chosen when a run starts; unlocked after the first prestige. */
export type HullId = 'standard' | 'light' | 'fleet' | 'mining' | 'bastion';
export type HangarType = 'launch' | 'drydock' | 'cargo' | 'fabricator';

export interface HangarItem {
  shipId: number;
  /** First slot index the ship occupies; it spans `SHIP_STATS[cls].slots` slots. */
  start: number;
}

export interface Hangar {
  id: number;
  type: HangarType;
  slots: number;
  items: HangarItem[];
  /** Per-hangar stance override; most specific scope wins. */
  stance: Partial<Stance>;
  /** Classes launch in this order; classes not listed launch last. */
  launchOrder: ShipClass[];
  launchTimer: number;
  /** Auto-buy target: how many ships of each class this hangar should hold. */
  target: Partial<Record<ShipClass, number>>;
}

export interface Automation {
  /** Buy toward each hangar's target composition (needs the autoBuy research). */
  autoBuy: boolean;
  /** Pay to rebuild lost ships (needs the autoRebuild research). */
  autoRebuild: boolean;
  /** Automation never spends credits below this. */
  creditFloor: number;
  /** Lost ships waiting for a paid rebuild, oldest first. */
  rebuildQueue: { cls: ShipClass; hangarId: number }[];
  timer: number;
}

export type ShipMode =
  | 'docked'
  | 'idle'
  | 'toAsteroid'
  | 'mining'
  | 'toDropoff'
  | 'toBarge'
  | 'toCarrier'
  | 'station' // barge parked at a cluster, gas harvester skimming
  | 'escort'
  | 'attack'
  | 'patrol'
  | 'repairing'
  | 'retreat'
  | 'recall'
  | 'carried'; // drone riding in a barge's drone bay

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ship {
  id: number;
  cls: ShipClass;
  hangarId: number;
  mode: ShipMode;
  pos: Vec3;
  hull: number;
  /** Ore units carried, and their total credit value. */
  cargo: number;
  cargoValue: number;
  /** H2 carried by gas harvesters. */
  h2: number;
  targetId: number; // asteroid / ship / pirate id, -1 for none
  escortId: number; // ship this one is guarding
  station: Vec3 | null; // where a barge parks
  /** Barge whose drone bay this drone is based at, -1 for the carrier. */
  bargeId: number;
  fireCooldown: number;
  /** Fitted modules, at most `MODULE_SLOTS[cls]`. */
  modules: ModuleId[];
  /** A timed stance card still in force after its conditions stopped holding. */
  hold?: { card: number; until: number };
}

export interface Pirate {
  id: number;
  pos: Vec3;
  hull: number;
  maxHull: number;
  damage: number;
  speed: number;
  targetId: number; // ship id, or -2 for the carrier
  fireCooldown: number;
}

export interface Asteroid {
  id: number;
  pos: Vec3;
  ore: number;
  maxOre: number;
  /** Credit value per ore unit. */
  value: number;
  radius: number;
  /** Seconds until a depleted rock refills (field keeps refilling). */
  respawn: number;
}

/** Cargo dropped by a destroyed barge; haulers salvage it before it decays. */
export interface Container {
  id: number;
  pos: Vec3;
  cargo: number;
  cargoValue: number;
  /** Seconds until it decays. */
  ttl: number;
}

export interface Hazard {
  pos: Vec3;
  radius: number;
  dps: number;
  kind: 'debris' | 'radiation';
}

/**
 * Compact depletion record for a system the carrier left. Only rocks that differ
 * from a freshly seeded field are listed, as `[index, oreFraction, respawn]`.
 */
export interface FieldRecord {
  /** `GameState.time` when the carrier left. */
  left: number;
  rocks: [number, number, number][];
}

/** What scouts have revealed in the current system. Cleared on every jump. */
export interface Recon {
  /** Indices into `clusterCenters` that a scout has surveyed. */
  clusters: number[];
  /** Asteroid ids marked as rich veins. */
  veins: number[];
  /** Indices into `GameState.hazards` a scout has charted. */
  hazards: number[];
}

export interface StarSystem {
  id: number;
  name: string;
  tier: 1 | 2 | 3;
  /** Steps from the starter systems; drives pirate scaling. */
  distance: number;
  oreMult: number;
  brightness: number; // solar multiplier
  gasGiant: boolean;
  discovered: boolean;
  seed: number;
}

/** Built-in preset cards. These were the fixed rules before condition/action cards (#82). */
export type RuleId =
  | 'fightersEscortOnWave'
  | 'bargeCallHauler'
  | 'bargeFallBack'
  | 'droneUnloadAtBarge'
  | 'haulerPark'
  | 'recallOnLowShields'
  | 'reserveWarpEnergy'
  | 'harvesterStormShelter';

/**
 * Which units a card speaks for. More specific scopes win: hangar > ship type > fleet.
 * A per-carrier scope (#53) slots in between fleet and ship type.
 */
export type CardScope =
  | { kind: 'fleet' }
  | { kind: 'class'; cls: ShipClass }
  | { kind: 'hangar'; id: number };

export type ConditionKind =
  | 'cargoAbove'
  | 'hullBelow'
  | 'pirateWithin'
  | 'wave'
  | 'energyBelow'
  | 'shieldBelow'
  | 'storm'
  | 'asteroidFarther'
  | 'carrierFarther'
  | 'always';

export interface Condition {
  kind: ConditionKind;
  /** Threshold; fractions are 0..1, distances km. Unused by some kinds (see CONDITION_DEFS). */
  value?: number;
}

export type ActionKind =
  | 'stance'
  | 'fallBack'
  | 'unloadAtBarge'
  | 'callHauler'
  | 'park'
  | 'recall'
  | 'shelter'
  | 'reserveWarp';

/** A stance a card can switch to, as `axis:value`. */
export type StanceSwitch =
  | `engagement:${Engagement}`
  | `underFire:${UnderFire}`
  | `mining:${MiningStance}`;

export interface CardAction {
  kind: ActionKind;
  /** For `stance`: what to switch to. */
  to?: StanceSwitch;
  /** For `stance`: keep it this many seconds after the conditions last held. */
  seconds?: number;
}

/** A Gladiabots-lite rule: when every condition holds, the action overrides the stance. */
export interface RuleCard {
  id: number;
  enabled: boolean;
  /** The preset this card started from, if any. */
  preset?: RuleId;
  scope: CardScope;
  /** 1..MAX_CONDITIONS conditions, joined by AND. */
  when: Condition[];
  then: CardAction;
}

export type CarrierStance = 'hold' | 'followRich';

export interface Carrier {
  pos: Vec3;
  target: Vec3 | null;
  hull: number;
  maxHull: number;
  energy: number;
  shield: number; // 0..1 shield strength, drains energy when absorbing hits
  ore: number;
  oreValue: number;
  h2: number;
  stance: CarrierStance;
  /** Refinery upgrade level, bought with credits. */
  refinery: number;
  /** Hull class; scales energy, refinery, warp, shields and hull points (HULLS). */
  hullClass: HullId;
}

export interface Warp {
  targetSystem: number;
  charge: number; // seconds remaining
  /** Charge time at the start of the jump. */
  total: number;
}

export type FxKind =
  | 'laser'
  | 'mine'
  | 'explosion'
  | 'repair'
  | 'pirateLaser'
  | 'turretLaser'
  | 'warp';
export interface Fx {
  kind: FxKind;
  a: Vec3;
  b: Vec3;
  ttl: number;
}

export type Severity = 'info' | 'good' | 'warn' | 'critical';

/** Why a ship was destroyed. */
export type LossCause = 'destroyed' | 'emergencyJump' | 'leftBehind';

/** Small payload per event kind. The UI turns kind + data into text. */
export interface EventData {
  CarrierOnline: { system: string };
  ShipLost: { cls: ShipClass; cause: LossCause };
  ShipRetreating: { cls: ShipClass };
  PirateWaveIncoming: { size: number; eta: number };
  PiratesArrived: { size: number };
  WaveRepelled: Record<string, never>;
  StormStarted: { h2: boolean };
  StormPassed: { h2: boolean };
  HazardCharted: { hazard: Hazard['kind'] };
  VeinFound: { veins: number };
  BargeWrecked: Record<string, never>;
  BargeFallback: Record<string, never>;
  ReserveRebuilt: { cls: ShipClass };
  ShipRebuilt: { cls: ShipClass; cost: number };
  HangarInstalled: { hangarType: HangarType };
  WarpCharging: { system: string };
  WarpCancelled: Record<string, never>;
  Warped: { system: string };
  EmergencyJump: Record<string, never>;
  Prestiged: { research: number };
  Admiralty: { marks: number };
  ChallengeStarted: { challenge: ChallengeId };
  ChallengeComplete: { challenge: ChallengeId; marks: number };
  WelcomeBack: { credits: number; seconds: number; hidden: boolean };
  /** A plain-text line from a save written before typed events (v7 and older). */
  Legacy: { text: string };
}
export type SimEventKind = keyof EventData;

interface SimEventOf<K extends SimEventKind> {
  kind: K;
  /** The operation (carrier) it happened to. */
  carrierId: number;
  systemId: number;
  severity: Severity;
  t: number; // sim seconds
  /** How many events were merged into this one; 1 when emitted. */
  count: number;
  data: EventData[K];
}
/** Something the sim reports to the player. Never read back by the sim. */
export type SimEvent = { [K in SimEventKind]: SimEventOf<K> }[SimEventKind];

export interface Stats {
  oreValueDelivered: number;
  creditsEarned: number;
  shipsLost: number;
  piratesKilled: number;
  furthestTier: number;
}

/**
 * One actively played carrier: its fleet, the system it sits in and everything local to it.
 * Several of these share one `GameState` (#53); for now there is exactly one.
 */
export interface Operation {
  /** Carrier id; stamped on events and named by every Command. */
  id: number;
  rng: number;
  carrier: Carrier;
  hangars: Hangar[];
  ships: Ship[];
  pirates: Pirate[];
  asteroids: Asteroid[];
  containers: Container[];
  hazards: Hazard[];
  recon: Recon;
  systemId: number;
  warp: Warp | null;
  wave: { timer: number; warning: boolean; active: boolean; size: number };
  storm: { timer: number; active: number };
  reserveTimers: Partial<Record<ShipClass, number>>;
  incomeAvg: number; // rolling credits/s, all sources (salvage included)
  miningIncomeAvg: number; // rolling credits/s from refined ore only, used for offline settlement
  fx: Fx[];
}

/** What a supply route carries. Credits and RP are shared, so only per-carrier pools move (Q10, #49). */
export type RouteResource = 'ore' | 'h2' | 'energy';
export const ROUTE_RESOURCES: RouteResource[] = ['ore', 'h2', 'energy'];

/** A standing flow of one resource from one carrier to another (#80). */
export interface SupplyRoute {
  id: number;
  /** Carrier ids. */
  from: number;
  to: number;
  resource: RouteResource;
  /** Units per second asked for; what arrives depends on stock, room and interception. */
  rate: number;
  /** Own rng state, so a route rolls the same whichever tier its carriers are in. */
  rng: number;
  /** Units delivered and units lost to interception, ever. */
  moved: number;
  lost: number;
}

export type ModifierId = 'noFighters' | 'halfEnergy' | 'deepSpace';
export type ChallengeId = 'pacifist' | 'lowPower' | 'deepStart';

/** Run-wide state. The whole GameState is what gets saved. */
export interface GameState {
  version: number;
  seed: number;
  time: number; // sim seconds this run
  nextId: number;
  credits: number;
  research: number; // unspent research points
  researchLevels: Record<string, number>;
  unlocked: ShipClass[];
  /** Presets unlocked so far; each unlocks its card's action for every card. */
  unlockedRules: RuleId[];
  /** Hull classes unlocked so far. Persists through prestige. */
  hulls: HullId[];
  systems: StarSystem[];
  /** Depletion records of systems left behind, keyed by system id. */
  fields: Record<number, FieldRecord>;
  doctrine: Doctrine;
  alerts: AlertRules;
  /** Rule cards in priority order (within a scope level). */
  cards: RuleCard[];
  automation: Automation;
  stats: Stats;
  lifetime: {
    prestiges: number;
    researchEarned: number;
    /** Admiralty resets so far (#68). */
    admiralties: number;
    /** Admiralty Marks ever paid out; the next payout is the new total minus this. */
    marksEarned: number;
  };
  /** Unspent Admiralty Marks (#68). Survive both prestige layers. */
  marks: number;
  /** Run modifiers active in this run (#71). Reset by every prestige and Admiralty reset. */
  modifiers: ModifierId[];
  /** The challenge being attempted, or null (#71). */
  challenge: ChallengeId | null;
  /** Challenges completed, ever (#71). Their permanent bonuses survive every reset. */
  challengesDone: ChallengeId[];
  /** Admiralty shop levels by upgrade id (#69). Survive both prestige layers. */
  admiralty: Record<string, number>;
  powerMode: 'balanced' | 'income' | 'defense';
  /** The last few events, newest first, for the Log tab. Saved. */
  log: SimEvent[];
  /** Outbox of events since the host last drained it, oldest first. */
  events: SimEvent[];
  savedAt: number; // wall-clock ms
  /** Supply routes between carriers (#80). */
  routes: SupplyRoute[];
  /** Actively played carriers. */
  ops: Operation[];
  /** Id of the carrier the player is looking at; the first one when absent or unknown. */
  focusId?: number;
}

/**
 * What the sim works on: the run-wide state and one operation seen as a single object.
 * Reads and writes go straight through to the `GameState` or the `Operation` (see `bind`).
 */
export type Sim = Omit<GameState, 'ops'> & Operation;
