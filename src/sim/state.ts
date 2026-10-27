import { DEFAULT_STANCE, ENERGY_MAX, HULLS } from './config';
import { startSystem } from './modifiers';
import { v3 } from './math';
import { softcap } from './research';
import { createShip, maxEnergy } from './economy';
import { emit } from './events';
import { enterSystem, makeSystems } from './worldgen';
import { bind } from './view';
import type {
  ChallengeId,
  GameState,
  HullId,
  ModifierId,
  Operation,
  RuleId,
  ShipClass,
} from './types';

// The sim's public surface lives in focused modules; this file re-exports it so imports stay stable.
export { OP_KEYS, GAME_KEYS, bind, stateOf, focusOp, focused } from './view';
export * from './worldgen';
export * from './economy';
export { SEVERITY, emit } from './events';

/** Bump together with a `migrations[n]` step and a fixture. See README "Save migrations". */
export const SAVE_VERSION = 16;

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
  challengesDone?: ChallengeId[];
  /** Modifiers and challenge of the run being started (#71). */
  modifiers?: ModifierId[];
  challenge?: ChallengeId | null;
  admiralty?: Record<string, number>;
  doctrine?: GameState['doctrine'];
  alerts?: GameState['alerts'];
  cards?: GameState['cards'];
  automation?: GameState['automation'];
}

/** A fresh operation: carrier, hangars and empty fields, not yet in any system. */
function buildOp(
  id: number,
  seed: number,
  hullClass: HullId,
  levels: Record<string, number>,
): Operation {
  const slotsBonus = levels.slots ?? 0;
  const hd = HULLS[hullClass];
  return {
    id,
    rng: seed,
    carrier: {
      pos: v3(),
      target: null,
      hull: hd.hull * (1 + 0.12 * (levels.frame ?? 0)),
      maxHull: hd.hull * (1 + 0.12 * (levels.frame ?? 0)),
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
}

/**
 * Add a second (or later) carrier to the run (#78). It gets an id no ship or other
 * carrier uses, hangar ids no other carrier's hangars use (rules and stances name
 * hangars globally), its own rng seed, and starts in the home system.
 */
export function addCarrier(g: GameState): Operation {
  const id = g.nextId++;
  const op = buildOp(id, g.seed + id * 7919, 'standard', g.researchLevels);
  const top = Math.max(...g.ops.flatMap((o) => o.hangars.map((h) => h.id)));
  for (const h of op.hangars) h.id += top;
  g.ops.push(op);
  const s = bind(g, op);
  s.carrier.energy = maxEnergy(s) * 0.6;
  enterSystem(s, 0);
  for (let i = 0; i < 4; i++) createShip(s, 'drone', op.hangars[0].id);
  emit(s, 'CarrierOnline', { system: s.systems[0].name });
  return op;
}

export function newGame(seed = 1337, carry?: Carry): GameState {
  const hulls = carry?.hulls ?? ['standard'];
  const hullClass =
    carry?.hullClass && hulls.includes(carry.hullClass) ? carry.hullClass : 'standard';
  const op = buildOp(0, seed, hullClass, carry?.researchLevels ?? {});
  const g: GameState = {
    version: SAVE_VERSION,
    seed,
    time: 0,
    nextId: 1,
    credits:
      150 +
      250 * (carry?.researchLevels.startCredits ?? 0) +
      Math.round(softcap(carry?.admiralty?.admCredits ?? 0, 5000)),
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
      : {
          autoBuy: false,
          autoRebuild: false,
          creditFloor: 0,
          rebuildQueue: [],
          timer: 0,
        },
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
    modifiers: [...(carry?.modifiers ?? [])],
    challenge: carry?.challenge ?? null,
    challengesDone: [...(carry?.challengesDone ?? [])],
    admiralty: carry?.admiralty ?? {},
    powerMode: 'balanced',
    log: [],
    events: [],
    savedAt: Date.now(),
    routes: [],
    ops: [op],
  };
  const s = bind(g, op);
  // Carried presets stay unlocked without dealing their cards again.
  s.unlockedRules = [...(carry?.unlockedRules ?? [])];
  if (carry) for (const id of carry.discovered) if (s.systems[id]) s.systems[id].discovered = true;
  s.carrier.energy = maxEnergy(s) * 0.6;
  enterSystem(s, 0);
  const start = startSystem(s);
  if (start !== 0) enterSystem(s, start);
  for (let i = 0; i < 4; i++) createShip(s, 'drone', 1);
  emit(s, 'CarrierOnline', { system: s.systems[0].name });
  return g;
}
