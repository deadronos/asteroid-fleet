import { presetCard } from '../sim/cards';
import { HULLS, PRESETS, warpCost } from '../sim/config';
import { OP_KEYS, SAVE_VERSION, makeSystems } from '../sim/state';
import {
  ROUTE_RESOURCES,
  type GameState,
  type HullId,
  type RuleCard,
  type RuleId,
  type Severity,
} from '../sim/types';

export type SaveFailure = 'corrupt' | 'newer' | 'unknown';

export type MigrateResult = { ok: true; state: GameState } | { ok: false; reason: SaveFailure };

/** Plain JSON object a migration step reads and returns. */
export type SaveBlob = Record<string, unknown>;

/**
 * Upgrades a version-n save to version n+1.
 * The step may mutate `save` or return a new object. The runner stamps `version`.
 */
export type Migration = (save: SaveBlob) => SaveBlob;

/**
 * One step per version, applied in order.
 * `migrations[n]` upgrades a version-n save to version n+1, up to `SAVE_VERSION`.
 * A gap (no step for a version this build claims to support) is an unknown save:
 * callers back that up instead of dropping it.
 */
export const migrations: Record<number, Migration> = {
  // v2: automation settings and a per-hangar auto-buy target.
  1: (save) => {
    save.automation = {
      autoBuy: false,
      autoRebuild: false,
      creditFloor: 0,
      rebuildQueue: [],
      timer: 0,
    };
    if (Array.isArray(save.hangars))
      for (const h of save.hangars) if (h && typeof h === 'object') h.target ??= {};
    return save;
  },
  // v3: per-system depletion records (#14). Older saves have none.
  2: (save) => ({ ...save, fields: {} }),
  // v4: salvage containers and barge drone bays (#13).
  3: (save) => {
    save.containers = [];
    if (Array.isArray(save.ships))
      for (const sh of save.ships) if (sh && typeof sh === 'object') sh.bargeId ??= -1;
    return save;
  },
  // v5: ship modules and scout reconnaissance (#9).
  4: (save) => {
    save.recon = { clusters: [], veins: [], hazards: [] };
    if (Array.isArray(save.ships))
      for (const sh of save.ships) if (sh && typeof sh === 'object') sh.modules ??= [];
    return save;
  },
  // v6: older saves never had miningIncomeAvg, so offline time paid nothing (#38).
  5: (save) => {
    if (typeof save.miningIncomeAvg !== 'number' || !Number.isFinite(save.miningIncomeAvg))
      save.miningIncomeAvg = 0;
    return save;
  },
  // v7: every asteroid now draws its rare-ore roll (#40), so fields regenerate differently
  // and old depletion records would land on other rocks. Drop them: rocks refill anyway.
  6: (save) => ({ ...save, fields: {} }),
  // v8: typed events replace plain-text log lines (#72). Old lines keep their text.
  7: (save) => {
    const systemId = typeof save.systemId === 'number' ? save.systemId : 0;
    const old = Array.isArray(save.log) ? save.log : [];
    save.log = old.filter(isRecord).map((l) => ({
      kind: 'Legacy',
      carrierId: 0,
      systemId,
      severity: (typeof l.tone === 'string' && LEGACY_TONE[l.tone]) || 'info',
      t: typeof l.t === 'number' ? l.t : 0,
      count: 1,
      data: { text: typeof l.text === 'string' ? l.text : '' },
    }));
    save.events = [];
    return save;
  },
  // v9: condition/action cards replace the fixed rules (#82). Each rule becomes its preset card.
  8: (save) => {
    const cards: RuleCard[] = [];
    for (const r of Array.isArray(save.rules) ? save.rules.filter(isRecord) : []) {
      const id = r.id as RuleId;
      if (typeof id !== 'string' || !Object.hasOwn(PRESETS, id)) continue;
      if (cards.some((c) => c.preset === id)) continue;
      const param = typeof r.param === 'number' && Number.isFinite(r.param) ? r.param : undefined;
      cards.push(presetCard(id, cards.length + 1, r.enabled === true, param));
    }
    save.cards = cards;
    delete save.rules;
    return save;
  },
  // v10: per-carrier state moves into `ops` (#75). The one carrier becomes operation 0.
  9: (save) => {
    const op: SaveBlob = { id: 0 };
    for (const k of OP_KEYS) {
      if (k === 'id') continue;
      if (k in save) op[k] = save[k];
      delete save[k];
    }
    save.ops = [op];
    return save;
  },
  // v11: hull classes (#65). Everyone keeps the standard carrier; later hulls unlock from prestige 1.
  10: (save) => {
    save.hulls = ['standard'];
    if (Array.isArray(save.ops))
      for (const op of save.ops)
        if (isRecord(op) && isRecord(op.carrier)) op.carrier.hullClass ??= 'standard';
    return save;
  },
  // v12: per-carrier alert rules in Doctrine (#79). Old saves keep the built-in policy.
  11: (save) => {
    save.alerts = { fleet: {}, byCarrier: {} };
    return save;
  },
  // v13: Admiralty Marks and the second prestige layer (#68).
  12: (save) => {
    const lifetime = isRecord(save.lifetime) ? save.lifetime : { prestiges: 0, researchEarned: 0 };
    save.lifetime = { ...lifetime, admiralties: 0, marksEarned: 0 };
    save.marks = 0;
    return save;
  },
  // v14: Admiralty upgrade shop (#69).
  13: (save) => {
    save.admiralty = {};
    return save;
  },
  // v15: run modifiers and challenge runs (#71).
  14: (save) => {
    save.modifiers = [];
    save.challenge = null;
    save.challengesDone = [];
    return save;
  },
  // v16: supply routes between carriers (#80).
  15: (save) => {
    save.routes = [];
    return save;
  },
  // v17: a jump in progress stores its full charge time. Older saves only know what is left.
  16: (save) => {
    if (Array.isArray(save.ops))
      for (const op of save.ops) {
        const w = isRecord(op) && isRecord(op.warp) ? op.warp : null;
        if (w && !(typeof w.total === 'number' && w.total > 0))
          w.total = typeof w.charge === 'number' && w.charge > 0 ? w.charge : 1;
      }
    return save;
  },
  // v18: each carrier keeps its own rebuild queue and automation timer (#174).
  17: (save) => {
    const automation = isRecord(save.automation) ? save.automation : null;
    const timer =
      automation && typeof automation.timer === 'number' && Number.isFinite(automation.timer)
        ? automation.timer
        : 0;
    const rawQueue =
      automation && Array.isArray(automation.rebuildQueue) ? automation.rebuildQueue : [];
    const ops = Array.isArray(save.ops) ? save.ops.filter(isRecord) : [];
    const focused = ops.find((op) => op.id === save.focusId) ?? ops[0];
    const owners = new Map<number, SaveBlob[]>();
    for (const op of ops) {
      op.rebuildQueue = [];
      op.automationTimer = timer;
      if (!Array.isArray(op.hangars)) continue;
      for (const hangar of op.hangars) {
        if (!isRecord(hangar) || typeof hangar.id !== 'number') continue;
        const list = owners.get(hangar.id);
        if (list) list.push(op);
        else owners.set(hangar.id, [op]);
      }
    }
    for (const entry of rawQueue) {
      if (!isRecord(entry) || typeof entry.cls !== 'string' || typeof entry.hangarId !== 'number')
        continue;
      const matches = owners.get(entry.hangarId);
      const dest = matches?.length === 1 ? matches[0] : focused;
      if (!dest || !Array.isArray(dest.rebuildQueue)) continue;
      dest.rebuildQueue.push({ cls: entry.cls, hangarId: entry.hangarId });
    }
    if (automation) {
      delete automation.rebuildQueue;
      delete automation.timer;
    }
    return save;
  },
  // v19: a jump in progress stores what it cost, so a cancel refunds what was paid (#184).
  // A warp already charging has no record of the split, so treat it as paid in energy (the old refund).
  18: (save) => {
    if (Array.isArray(save.ops))
      for (const op of save.ops) {
        const w = isRecord(op) && isRecord(op.warp) ? op.warp : null;
        if (!w) continue;
        const systems = Array.isArray(save.systems) ? save.systems : [];
        const dist = (id: unknown) => {
          const sys = typeof id === 'number' ? systems[id] : undefined;
          return isRecord(sys) && typeof sys.distance === 'number' ? sys.distance : 0;
        };
        const carrier = isRecord(op.carrier) ? op.carrier : {};
        const hull =
          typeof carrier.hullClass === 'string' ? HULLS[carrier.hullClass as HullId] : undefined;
        const levels = isRecord(save.researchLevels) ? save.researchLevels : {};
        const sensors = typeof levels.sensors === 'number' ? levels.sensors : 0;
        const mult = (hull?.warpCost ?? 1) * (1 - 0.05 * sensors);
        w.paid = { energy: warpCost(dist(op.systemId), dist(w.targetSystem), mult), h2: 0 };
      }
    return save;
  },
};

const LEGACY_TONE: Record<string, Severity> = {
  info: 'info',
  good: 'good',
  warn: 'warn',
  bad: 'critical',
};

export function applyMigrationSteps(
  save: SaveBlob,
  fromVersion: number,
  toVersion: number,
  steps: Record<number, Migration> = migrations,
): SaveBlob | null {
  let current = save;
  for (let version = fromVersion; version < toVersion; version++) {
    const step = steps[version];
    if (!step) return null;
    const next = step(current);
    if (!next || typeof next !== 'object' || Array.isArray(next)) return null;
    next.version = version + 1;
    current = next;
  }
  return current;
}

/** Migrate `raw` to `SAVE_VERSION`, then check the fields a save must have. */
export function migrate(raw: unknown): MigrateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'corrupt' };
  }

  let save: SaveBlob;
  try {
    save = structuredClone(raw) as SaveBlob;
  } catch {
    return { ok: false, reason: 'corrupt' };
  }

  const version = save.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, reason: 'unknown' };
  }
  if (version > SAVE_VERSION) return { ok: false, reason: 'newer' };
  if (version < 1) return { ok: false, reason: 'unknown' };

  const migrated = applyMigrationSteps(save, version, SAVE_VERSION);
  if (!migrated) return { ok: false, reason: 'unknown' };
  return validateSave(migrated);
}

function isRecord(value: unknown): value is SaveBlob {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** On disk, "no timer" is JSON null. In memory it is a number (`Infinity` included). */
function isTimer(value: unknown): boolean {
  return value === null || typeof value === 'number';
}

function validateSave(save: SaveBlob): MigrateResult {
  if (save.version !== SAVE_VERSION) return { ok: false, reason: 'corrupt' };
  if (!Array.isArray(save.ops) || save.ops.length === 0) return { ok: false, reason: 'corrupt' };
  if (!Array.isArray(save.systems)) return { ok: false, reason: 'corrupt' };
  if (!isRecord(save.fields)) return { ok: false, reason: 'corrupt' };
  if (!isRecord(save.stats)) return { ok: false, reason: 'corrupt' };
  if (!isRecord(save.doctrine)) return { ok: false, reason: 'corrupt' };
  if (!isRecord(save.automation)) return { ok: false, reason: 'corrupt' };

  if (!isRecord(save.alerts) || !isRecord(save.alerts.fleet) || !isRecord(save.alerts.byCarrier))
    save.alerts = { fleet: {}, byCarrier: {} };
  if (!Array.isArray(save.log)) save.log = [];
  if (!Array.isArray(save.cards)) save.cards = [];
  if (!Array.isArray(save.unlockedRules)) save.unlockedRules = [];
  if (!Array.isArray(save.events)) save.events = [];
  if (!Array.isArray(save.modifiers)) save.modifiers = [];
  if (!Array.isArray(save.routes)) save.routes = [];
  if (!Array.isArray(save.challengesDone)) save.challengesDone = [];
  if (typeof save.challenge !== 'string') save.challenge = null;
  if (!Array.isArray(save.hulls) || !save.hulls.includes('standard')) save.hulls = ['standard'];

  if (typeof save.credits !== 'number' || !Number.isFinite(save.credits))
    return { ok: false, reason: 'corrupt' };

  const ids = new Set<unknown>();
  for (const op of save.ops) {
    if (!isRecord(op) || typeof op.id !== 'number' || ids.has(op.id))
      return { ok: false, reason: 'corrupt' };
    ids.add(op.id);
    if (!validOp(op)) return { ok: false, reason: 'corrupt' };
    // Early saves were written with `systems: []`; rebuild the map from the seed (#40).
    if (!isRecord((save.systems as unknown[])[op.systemId as number])) {
      if (typeof save.seed !== 'number') return { ok: false, reason: 'corrupt' };
      const systems = makeSystems(save.seed);
      if (!systems[op.systemId as number]) return { ok: false, reason: 'corrupt' };
      save.systems = systems;
    }
  }

  const state = save as unknown as GameState;
  state.routes = state.routes.filter(
    (r) =>
      isRecord(r) &&
      Number.isFinite(r.id) &&
      ids.has(r.from) &&
      ids.has(r.to) &&
      r.from !== r.to &&
      ROUTE_RESOURCES.includes(r.resource) &&
      Number.isFinite(r.rate) &&
      Number.isFinite(r.rng),
  );
  for (const r of state.routes) {
    if (!Number.isFinite(r.moved)) r.moved = 0;
    if (!Number.isFinite(r.lost)) r.lost = 0;
  }
  for (const op of state.ops) {
    // JSON turns Infinity into null; restore "no timer".
    if (op.wave.timer === null) op.wave.timer = Infinity;
    if (op.storm.timer === null) op.storm.timer = Infinity;
  }
  return { ok: true, state };
}

/** Checks one operation, filling fields that may safely default. */
function validOp(op: SaveBlob): boolean {
  if (!Array.isArray(op.ships)) return false;
  if (!Array.isArray(op.asteroids)) return false;
  if (!Array.isArray(op.hangars)) return false;
  if (!Array.isArray(op.containers)) return false;
  if (!isRecord(op.recon)) return false;
  if (!isRecord(op.carrier)) return false;
  if (typeof op.rng !== 'number') return false;
  if (!isRecord(op.wave) || !isTimer(op.wave.timer)) return false;
  if (!isRecord(op.storm) || !isTimer(op.storm.timer)) return false;
  // NaN is stored as null; a non-finite income would poison the rolling average.
  if (typeof op.miningIncomeAvg !== 'number' || !Number.isFinite(op.miningIncomeAvg))
    op.miningIncomeAvg = 0;
  if (!Array.isArray(op.rebuildQueue)) op.rebuildQueue = [];
  if (typeof op.automationTimer !== 'number' || !Number.isFinite(op.automationTimer))
    op.automationTimer = 0;
  if (typeof op.systemId !== 'number' || !Number.isInteger(op.systemId) || op.systemId < 0)
    return false;
  return true;
}
