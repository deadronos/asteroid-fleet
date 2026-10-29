import { MODULE_IDS, MODULE_SLOTS } from '../sim/config';
import { bind, focusOp, maxEnergy } from '../sim/state';
import {
  SHIP_CLASSES,
  type Asteroid,
  type GameState,
  type Hangar,
  type HangarItem,
  type ModuleId,
  type Operation,
  type Pirate,
  type Ship,
  type ShipMode,
  type Vec3,
} from '../sim/types';

/**
 * The worker's periodic state message, built for cheap cloning. Ships, pirates and asteroids
 * travel as rows of one Float64Array each (transferred, so not copied), hangar items as an
 * Int32Array. Everything else is small and goes as plain objects. Decoded on the main thread
 * into a mirror that equals the sim state, so saves from the mirror stay exact. The save path
 * through the worker (the `snapshot` message) still sends the full `GameState`.
 *
 * `focus` is the focused carrier with its fleet and system in full detail; `global` is the
 * run-wide rest. With several carriers (#77) the others become small summaries beside it.
 */
export interface UiSnapshot {
  global: GlobalPart;
  focus: FocusPart;
  /** One entry per carrier, in `ops` order, for the carrier bar. */
  carriers: CarrierBrief[];
  /** Other carriers in the focused carrier's system, for drawing (#127). */
  others: OtherCarrier[];
}

/** A non-focused carrier sharing the viewed system: where it is and where its ships are. */
export interface OtherCarrier {
  id: number;
  pos: Vec3;
  /** Non-docked ships, `OTHER_ROW` numbers each: id, class index, x, y, z. Float64 so ids stay exact. */
  ships: Float64Array<ArrayBuffer>;
}

/** What the carrier bar and the carrier lists show about one carrier. */
export interface CarrierBrief {
  id: number;
  systemId: number;
  hull: number; // 0..1
  energy: number;
  maxEnergy: number;
  income: number; // credits/s
  /** Hangar ids, so the rule-card scope can name hangars of carriers that are not in focus (#178). */
  hangars: number[];
}

/** Operation fields sent as packed rows, or (fx) with frames instead. */
type PackedKey = 'ships' | 'pirates' | 'asteroids' | 'hangars' | 'fx';
const PACKED = new Set<string>([
  'ships',
  'pirates',
  'asteroids',
  'hangars',
  'fx',
] satisfies PackedKey[]);
/** Run-wide fields that are sent only when changed, or not at all. */
const GLOBAL_SKIP = new Set<string>(['ops', 'fields', 'events'] satisfies (keyof GameState)[]);

/** Every other GameState field, as is; new fields land here without codec changes. */
export type GlobalPart = Omit<GameState, 'ops' | 'fields' | 'events'> & {
  /** Only when it may have changed: on a new state or after a jump. */
  fields?: GameState['fields'];
};

/** The focused operation; new Operation fields land here without codec changes. */
export type FocusPart = Omit<Operation, PackedKey> & {
  hangars: (Omit<Hangar, 'items'> & { items: Int32Array<ArrayBuffer> })[];
  ships: Float64Array;
  pirates: Float64Array;
  asteroids: Float64Array;
};

// All modes, in the same order as the frame codec's `MODES` (#181).
const SHIP_MODES: ShipMode[] = [
  'docked',
  'idle',
  'toAsteroid',
  'mining',
  'toDropoff',
  'toBarge',
  'toCarrier',
  'station',
  'escort',
  'attack',
  'patrol',
  'repairing',
  'retreat',
  'recall',
  'carried',
];
const modeIndex = new Map(SHIP_MODES.map((m, i) => [m, i]));
const clsIndex = new Map(SHIP_CLASSES.map((c, i) => [c, i]));
const moduleIndex = new Map(MODULE_IDS.map((m, i) => [m, i]));

const MAX_MODULES = Math.max(...Object.values(MODULE_SLOTS));
// id cls hangarId mode pos×3 hull cargo cargoValue h2 targetId escortId hasStation station×3
// bargeId fireCooldown hasHold holdCard holdUntil nModules idleUntil (NaN for none)
// modules×MAX_MODULES
const SHIP_ROW = 24 + MAX_MODULES;
// id pos×3 hull maxHull damage speed targetId fireCooldown
const PIRATE_ROW = 10;
// id pos×3 ore maxOre value radius respawn
const ASTEROID_ROW = 9;
// id cls pos×3
export const OTHER_ROW = 5;

export function encodeSnapshot(
  g: GameState,
  withFields: boolean,
): { snap: UiSnapshot; transfer: ArrayBuffer[] } {
  const s = focusOp(g);
  const global: Record<string, unknown> = {};
  const focus: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) if (!GLOBAL_SKIP.has(k)) global[k] = v;
  for (const [k, v] of Object.entries(s)) if (!PACKED.has(k)) focus[k] = v;
  if (withFields) global.fields = g.fields;

  const ships = new Float64Array(s.ships.length * SHIP_ROW);
  let o = 0;
  for (const sh of s.ships) {
    ships[o] = sh.id;
    ships[o + 1] = clsIndex.get(sh.cls)!;
    ships[o + 2] = sh.hangarId;
    ships[o + 3] = modeIndex.get(sh.mode)!;
    ships[o + 4] = sh.pos.x;
    ships[o + 5] = sh.pos.y;
    ships[o + 6] = sh.pos.z;
    ships[o + 7] = sh.hull;
    ships[o + 8] = sh.cargo;
    ships[o + 9] = sh.cargoValue;
    ships[o + 10] = sh.h2;
    ships[o + 11] = sh.targetId;
    ships[o + 12] = sh.escortId;
    if (sh.station) {
      ships[o + 13] = 1;
      ships[o + 14] = sh.station.x;
      ships[o + 15] = sh.station.y;
      ships[o + 16] = sh.station.z;
    }
    ships[o + 17] = sh.bargeId;
    ships[o + 18] = sh.fireCooldown;
    if (sh.hold) {
      ships[o + 19] = 1;
      ships[o + 20] = sh.hold.card;
      ships[o + 21] = sh.hold.until;
    }
    ships[o + 22] = sh.modules.length;
    ships[o + 23] = sh.idleUntil ?? NaN;
    for (let i = 0; i < sh.modules.length; i++) ships[o + 24 + i] = moduleIndex.get(sh.modules[i])!;
    o += SHIP_ROW;
  }

  const pirates = new Float64Array(s.pirates.length * PIRATE_ROW);
  o = 0;
  for (const p of s.pirates) {
    pirates[o] = p.id;
    pirates[o + 1] = p.pos.x;
    pirates[o + 2] = p.pos.y;
    pirates[o + 3] = p.pos.z;
    pirates[o + 4] = p.hull;
    pirates[o + 5] = p.maxHull;
    pirates[o + 6] = p.damage;
    pirates[o + 7] = p.speed;
    pirates[o + 8] = p.targetId;
    pirates[o + 9] = p.fireCooldown;
    o += PIRATE_ROW;
  }

  const asteroids = new Float64Array(s.asteroids.length * ASTEROID_ROW);
  o = 0;
  for (const a of s.asteroids) {
    asteroids[o] = a.id;
    asteroids[o + 1] = a.pos.x;
    asteroids[o + 2] = a.pos.y;
    asteroids[o + 3] = a.pos.z;
    asteroids[o + 4] = a.ore;
    asteroids[o + 5] = a.maxOre;
    asteroids[o + 6] = a.value;
    asteroids[o + 7] = a.radius;
    asteroids[o + 8] = a.respawn;
    o += ASTEROID_ROW;
  }

  const others: OtherCarrier[] = [];
  for (const op of g.ops) {
    if (op === s || op.systemId !== s.systemId) continue;
    const live = op.ships.filter((x) => x.mode !== 'docked');
    const rows = new Float64Array(live.length * OTHER_ROW);
    live.forEach((x, i) => {
      const o = i * OTHER_ROW;
      rows[o] = x.id;
      rows[o + 1] = clsIndex.get(x.cls)!;
      rows[o + 2] = x.pos.x;
      rows[o + 3] = x.pos.y;
      rows[o + 4] = x.pos.z;
    });
    others.push({ id: op.id, pos: { ...op.carrier.pos }, ships: rows });
  }

  const hangars: FocusPart['hangars'] = [];
  for (const h of s.hangars) {
    const items = new Int32Array(h.items.length * 2);
    h.items.forEach((it, i) => {
      items[i * 2] = it.shipId;
      items[i * 2 + 1] = it.start;
    });
    hangars.push({ ...h, items });
  }

  focus.hangars = hangars;
  focus.ships = ships;
  focus.pirates = pirates;
  focus.asteroids = asteroids;
  return {
    snap: {
      others,
      global: global as GlobalPart,
      focus: focus as FocusPart,
      carriers: g.ops.map((op) => ({
        id: op.id,
        systemId: op.systemId,
        hull: op.carrier.hull / op.carrier.maxHull,
        energy: op.carrier.energy,
        maxEnergy: maxEnergy(bind(g, op)),
        income: op.incomeAvg,
        hangars: op.hangars.map((h) => h.id),
      })),
    },
    transfer: [
      ships.buffer,
      pirates.buffer,
      asteroids.buffer,
      ...others.map((o) => o.ships.buffer),
      ...hangars.map((h) => h.items.buffer),
    ],
  };
}

/**
 * Rebuild a full state from a snapshot. Ships, pirates and asteroids already in `prev` are
 * updated in place, so the renderer's per-id caches and the frame mirror keep their objects.
 * `fx` and `fields` carry over from `prev` (fx arrive with frames); `events` is always empty,
 * since the worker drains it.
 */
export function applySnapshot(prevState: GameState | null, snap: UiSnapshot): GameState {
  const prev = prevState ? focusOp(prevState) : null;
  const {
    hangars,
    ships: shipRows,
    pirates: pirateRows,
    asteroids: rockRows,
    ...focus
  } = snap.focus;
  const { fields, ...global } = snap.global;

  const oldShips = new Map(prev?.ships.map((x) => [x.id, x]));
  const ships: Ship[] = [];
  for (let o = 0; o < shipRows.length; o += SHIP_ROW) {
    const id = shipRows[o];
    const sh = oldShips.get(id) ?? ({ id, pos: { x: 0, y: 0, z: 0 } } as Ship);
    sh.cls = SHIP_CLASSES[shipRows[o + 1]];
    sh.hangarId = shipRows[o + 2];
    sh.mode = SHIP_MODES[shipRows[o + 3]];
    sh.pos.x = shipRows[o + 4];
    sh.pos.y = shipRows[o + 5];
    sh.pos.z = shipRows[o + 6];
    sh.hull = shipRows[o + 7];
    sh.cargo = shipRows[o + 8];
    sh.cargoValue = shipRows[o + 9];
    sh.h2 = shipRows[o + 10];
    sh.targetId = shipRows[o + 11];
    sh.escortId = shipRows[o + 12];
    sh.station = shipRows[o + 13]
      ? { x: shipRows[o + 14], y: shipRows[o + 15], z: shipRows[o + 16] }
      : null;
    sh.bargeId = shipRows[o + 17];
    sh.fireCooldown = shipRows[o + 18];
    if (shipRows[o + 19]) sh.hold = { card: shipRows[o + 20], until: shipRows[o + 21] };
    else delete sh.hold;
    const modules: ModuleId[] = [];
    for (let i = 0; i < shipRows[o + 22]; i++) modules.push(MODULE_IDS[shipRows[o + 24 + i]]);
    sh.modules = modules;
    if (Number.isNaN(shipRows[o + 23])) delete sh.idleUntil;
    else sh.idleUntil = shipRows[o + 23];
    ships.push(sh);
  }

  const oldPirates = new Map(prev?.pirates.map((x) => [x.id, x]));
  const pirates: Pirate[] = [];
  for (let o = 0; o < pirateRows.length; o += PIRATE_ROW) {
    const id = pirateRows[o];
    const p = oldPirates.get(id) ?? ({ id, pos: { x: 0, y: 0, z: 0 } } as Pirate);
    p.pos.x = pirateRows[o + 1];
    p.pos.y = pirateRows[o + 2];
    p.pos.z = pirateRows[o + 3];
    p.hull = pirateRows[o + 4];
    p.maxHull = pirateRows[o + 5];
    p.damage = pirateRows[o + 6];
    p.speed = pirateRows[o + 7];
    p.targetId = pirateRows[o + 8];
    p.fireCooldown = pirateRows[o + 9];
    pirates.push(p);
  }

  const oldRocks = new Map(prev?.asteroids.map((x) => [x.id, x]));
  const asteroids: Asteroid[] = [];
  for (let o = 0; o < rockRows.length; o += ASTEROID_ROW) {
    const id = rockRows[o];
    const a = oldRocks.get(id) ?? ({ id, pos: { x: 0, y: 0, z: 0 } } as Asteroid);
    a.pos.x = rockRows[o + 1];
    a.pos.y = rockRows[o + 2];
    a.pos.z = rockRows[o + 3];
    a.ore = rockRows[o + 4];
    a.maxOre = rockRows[o + 5];
    a.value = rockRows[o + 6];
    a.radius = rockRows[o + 7];
    a.respawn = rockRows[o + 8];
    asteroids.push(a);
  }

  const op: Operation = {
    ...focus,
    // The received hangars are this thread's own copies, so they can be reused.
    hangars: hangars.map((h) => {
      const items: HangarItem[] = [];
      for (let i = 0; i < h.items.length; i += 2)
        items.push({ shipId: h.items[i], start: h.items[i + 1] });
      return Object.assign(h, { items });
    }),
    ships,
    pirates,
    asteroids,
    fx: prev && prev.id === focus.id ? prev.fx : [],
  };
  return {
    ...global,
    fields: fields ?? prevState?.fields ?? {},
    events: [],
    ops: [op],
  };
}
