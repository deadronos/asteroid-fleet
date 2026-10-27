import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../sim/config';
import { OP_KEYS, SAVE_VERSION, newGame } from '../sim/state';
import { step } from '../sim/tick';
import saveV1 from './fixtures/save-v1.json';
import saveV2 from './fixtures/save-v2.json';
import saveV3 from './fixtures/save-v3.json';
import saveV4 from './fixtures/save-v4.json';
import saveV5 from './fixtures/save-v5.json';
import saveV6 from './fixtures/save-v6.json';
import saveV7 from './fixtures/save-v7.json';
import saveV8 from './fixtures/save-v8.json';
import saveV9 from './fixtures/save-v9.json';
import saveV10 from './fixtures/save-v10.json';
import saveV13 from './fixtures/save-v13.json';
import { applyMigrationSteps, migrate, type SaveBlob } from './migrate';
import {
  SAVE_BACKUP_FAILED_NOTICE,
  SAVE_BACKUP_KEY,
  SAVE_BACKUP_NOTICE,
  SAVE_KEY,
  MAX_BACKUPS,
  allowSaveOverwrite,
  decodeSave,
  exportSave,
  exportSaveFile,
  importSave,
  loadGame,
  readBackups,
  readPrimaryText,
  saveGame,
  saveOverwriteBlocked,
  type LoadResult,
} from './save';

const mem = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  fail: false,
}));

vi.mock('idb-keyval', () => ({
  get: vi.fn<(key: string) => Promise<unknown>>(async (key) => {
    if (mem.fail) throw new Error('indexedDB unavailable');
    return mem.idb.get(key);
  }),
  set: vi.fn<(key: string, value: string) => Promise<void>>(async (key, value) => {
    if (mem.fail) throw new Error('indexedDB unavailable');
    mem.idb.set(key, value);
  }),
  del: vi.fn<(key: string) => Promise<void>>(async (key) => {
    if (mem.fail) throw new Error('indexedDB unavailable');
    mem.idb.delete(key);
  }),
  entries: vi.fn<() => Promise<[string, unknown][]>>(async () => {
    if (mem.fail) throw new Error('indexedDB unavailable');
    return [...mem.idb.entries()];
  }),
}));

let local: Map<string, string>;

function installLocalStorage(options?: { rejectWrites?: boolean }) {
  local = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (local.has(key) ? local.get(key)! : null),
    setItem: (key: string, value: string) => {
      if (options?.rejectWrites) throw new Error('quota');
      local.set(key, value);
    },
    removeItem: (key: string) => {
      local.delete(key);
    },
    clear: () => local.clear(),
    key: (index: number) => [...local.keys()][index] ?? null,
    get length() {
      return local.size;
    },
  });
}

beforeEach(() => {
  mem.idb.clear();
  mem.fail = false;
  installLocalStorage();
  allowSaveOverwrite();
});

function encodeRaw(raw: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(raw))));
}

describe('migrate', () => {
  it('migrates a checked-in v1 fixture to the current version', () => {
    expect(saveV1.version).toBe(1);
    const result = migrate(saveV1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.version).toBe(SAVE_VERSION);
    expect(result.state.credits).toBe(420);
    expect(result.state.seed).toBe(1337);
    expect(result.state.ops[0].ships).toHaveLength(1);
    expect(result.state.ops[0].ships[0].cargo).toBe(6);
    expect(result.state.ops[0].carrier.hull).toBe(1800);
    expect(result.state.stats.oreValueDelivered).toBe(500);
    expect(result.state.researchLevels.yield).toBe(1);
    expect(result.state.powerMode).toBe('income');
    expect(result.state.ops[0].wave.timer).toBe(Infinity);
    expect(result.state.ops[0].storm.timer).toBe(Infinity);
    expect(result.state.automation).toEqual({
      autoBuy: false,
      autoRebuild: false,
      creditFloor: 0,
      rebuildQueue: [],
      timer: 0,
    });
    for (const h of result.state.ops[0].hangars) expect(h.target).toEqual({});
    // The fixture module itself stays a v1 document.
    expect(saveV1.version).toBe(1);
    expect(saveV1.wave.timer).toBeNull();
  });

  it('migrates v1 and v2 saves to v3 with empty depletion records', () => {
    const fromV1 = migrate(saveV1);
    expect(fromV1.ok && fromV1.state.fields).toEqual({});
    expect(fromV1.ok && fromV1.state.automation.autoBuy).toBe(false);
    expect(saveV2.version).toBe(2);
    const fromV2 = migrate(saveV2);
    expect(fromV2.ok).toBe(true);
    if (!fromV2.ok) return;
    expect(fromV2.state.version).toBe(SAVE_VERSION);
    expect(fromV2.state.fields).toEqual({});
    expect(fromV2.state.automation.autoRebuild).toBe(true);
    expect(fromV2.state.automation.creditFloor).toBe(100);
  });

  it('migrates a v3 save to v4 with no containers and carrier-based drones', () => {
    expect(saveV3.version).toBe(3);
    const fromV3 = migrate(saveV3);
    expect(fromV3.ok).toBe(true);
    if (!fromV3.ok) return;
    expect(fromV3.state.version).toBe(SAVE_VERSION);
    expect(fromV3.state.ops[0].containers).toEqual([]);
    // v7 drops depletion records (#40).
    expect(fromV3.state.fields).toEqual({});
    for (const sh of fromV3.state.ops[0].ships) expect(sh.bargeId).toBe(-1);
    expect(saveV3).not.toHaveProperty('containers');
  });

  it('migrates a v4 save to v5 with no modules and no reconnaissance', () => {
    expect(saveV4.version).toBe(4);
    const fromV4 = migrate(saveV4);
    expect(fromV4.ok).toBe(true);
    if (!fromV4.ok) return;
    expect(fromV4.state.version).toBe(SAVE_VERSION);
    expect(fromV4.state.ops[0].recon).toEqual({ clusters: [], veins: [], hazards: [] });
    expect(fromV4.state.ops[0].containers).toHaveLength(1);
    for (const sh of fromV4.state.ops[0].ships) expect(sh.modules).toEqual([]);
    expect(saveV4).not.toHaveProperty('recon');
  });

  it('migrates a v5 save without miningIncomeAvg to a finite value (#38)', () => {
    expect(saveV5.version).toBe(5);
    expect(saveV5).not.toHaveProperty('miningIncomeAvg');
    const r = migrate(saveV5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.ops[0].miningIncomeAvg).toBe(0);
  });

  it('repairs a non-finite miningIncomeAvg and keeps a finite one', () => {
    const bad = migrate({ ...structuredClone(saveV5), version: 6, miningIncomeAvg: null });
    expect(bad.ok && bad.state.ops[0].miningIncomeAvg).toBe(0);
    const good = migrate({ ...structuredClone(saveV5), version: 6, miningIncomeAvg: 7 });
    expect(good.ok && good.state.ops[0].miningIncomeAvg).toBe(7);
  });

  it('drops v6 depletion records, which the rare-roll change would misplace (#40)', () => {
    expect(saveV6.version).toBe(6);
    expect(Object.keys(saveV6.fields)).toHaveLength(1);
    const r = migrate(saveV6);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.fields).toEqual({});
    expect(r.state.ops[0].miningIncomeAvg).toBe(3.5);
  });

  it('turns v7 plain-text log lines into Legacy events (#72)', () => {
    expect(saveV7.version).toBe(7);
    const r = migrate(saveV7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.events).toEqual([]);
    expect(r.state.log).toEqual([
      {
        kind: 'Legacy',
        carrierId: 0,
        systemId: saveV7.systemId,
        severity: 'critical',
        t: 40,
        count: 1,
        data: { text: 'Fighter lost (destroyed).' },
      },
      expect.objectContaining({ severity: 'good', t: 20, data: { text: 'Pirate wave repelled.' } }),
      expect.objectContaining({ severity: 'info', t: 10, data: { text: 'Docked.' } }),
    ]);
    // Lines from older saves come through every step too.
    const v1 = migrate(saveV1);
    expect(v1.ok && v1.state.log.map((l) => l.kind)).toEqual(['Legacy']);
    const noLog = migrate({ ...structuredClone(saveV7), log: undefined });
    expect(noLog.ok && noLog.state.log).toEqual([]);
  });

  it('turns v8 rules into their preset cards (#82)', () => {
    expect(saveV8.version).toBe(8);
    const r = migrate(saveV8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('rules' in r.state).toBe(false);
    expect(r.state.unlockedRules).toEqual(saveV8.unlockedRules);
    expect(r.state.cards.map((c) => [c.id, c.preset, c.enabled])).toEqual([
      [1, 'droneUnloadAtBarge', true],
      [2, 'bargeCallHauler', true],
      [3, 'haulerPark', false],
      [4, 'fightersEscortOnWave', true],
      [5, 'bargeFallBack', false],
      [6, 'recallOnLowShields', true],
      [7, 'reserveWarpEnergy', false],
    ]);
    // The old param lands on the preset's parameter condition; the rest is the preset as is.
    const byPreset = Object.fromEntries(r.state.cards.map((c) => [c.preset, c]));
    expect(byPreset.droneUnloadAtBarge.when).toEqual([{ kind: 'carrierFarther', value: 25 }]);
    expect(byPreset.bargeCallHauler.when).toEqual([{ kind: 'cargoAbove', value: 0.6 }]);
    expect(byPreset.recallOnLowShields.when).toEqual([
      { kind: 'shieldBelow', value: 0.35 },
      { kind: 'pirateWithin' },
    ]);
    for (const c of r.state.cards) {
      expect(c.scope).toEqual(PRESETS[c.preset!].card.scope);
      expect(c.then).toEqual(PRESETS[c.preset!].card.then);
    }
    // The preset table itself is not touched by migrating.
    expect(PRESETS.bargeCallHauler.card.when[0].value).toBe(0.8);
  });

  it('drops unknown, duplicate and malformed v8 rules', () => {
    const r = migrate({
      ...structuredClone(saveV8),
      rules: [
        { id: 'haulerPark', enabled: true, param: 0 },
        { id: 'haulerPark', enabled: false, param: 0 },
        { id: 'noSuchRule', enabled: true, param: 1 },
        'junk',
        { id: 'bargeCallHauler', enabled: true, param: 'high' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cards.map((c) => [c.preset, c.enabled])).toEqual([
      ['haulerPark', true],
      ['bargeCallHauler', true],
    ]);
    expect(r.state.cards[1].when[0].value).toBe(0.8);
    const none = migrate({ ...structuredClone(saveV8), rules: undefined });
    expect(none.ok && none.state.cards).toEqual([]);
  });

  it('moves v9 per-carrier state into operation 0 (#75)', () => {
    expect(saveV9.version).toBe(9);
    const r = migrate(saveV9);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = r.state;
    expect(g.version).toBe(SAVE_VERSION);
    expect(g.ops).toHaveLength(1);
    const op = g.ops[0];
    expect(op.id).toBe(0);
    for (const k of OP_KEYS) {
      expect(g).not.toHaveProperty(k);
      // Timers are compared below: JSON null comes back as Infinity.
      if (k === 'id' || k === 'wave' || k === 'storm') continue;
      if (k === 'carrier') continue;
      expect.soft(op[k]).toEqual((saveV9 as SaveBlob)[k]);
    }
    // v11 adds the hull class.
    expect(op.carrier).toEqual({
      ...((saveV9 as SaveBlob).carrier as object),
      hullClass: 'standard',
    });
    expect(op.ships).toHaveLength(4);
    expect(op.wave.timer).toBe(Infinity);
    expect(op.storm.timer).toBe(Infinity);
    // Run-wide state stays put.
    expect(g.credits).toBe(saveV9.credits);
    expect(g.cards).toEqual(saveV9.cards);
    expect(g.log).toEqual(saveV9.log);
    expect(g.time).toBe(saveV9.time);
  });

  it('gives a v10 save the standard hull and only that hull unlocked (#65)', () => {
    expect(saveV10.version).toBe(10);
    const r = migrate(saveV10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.hulls).toEqual(['standard']);
    expect(r.state.ops[0].carrier.hullClass).toBe('standard');
    expect(r.state.ops[0].carrier.maxHull).toBe(saveV10.ops[0].carrier.maxHull);
  });

  it('gives older saves empty alert rules (#79)', () => {
    const r = migrate(saveV10);
    expect(r.ok && r.state.alerts).toEqual({ fleet: {}, byCarrier: {} });
  });

  it('rejects a save whose operations are missing or broken', () => {
    const v10 = migrate(saveV9);
    if (!v10.ok) throw new Error('fixture');
    const corrupt = (patch: object) =>
      migrate({ ...structuredClone(v10.state), ...patch }) as { ok: boolean };
    expect(corrupt({ ops: [] }).ok).toBe(false);
    expect(corrupt({ ops: undefined }).ok).toBe(false);
    const op = v10.state.ops[0];
    expect(corrupt({ ops: [{ ...op, ships: null }] }).ok).toBe(false);
    expect(corrupt({ ops: [op, { ...op }] }).ok).toBe(false);
  });

  it('rebuilds a missing systems map from the seed (#40)', () => {
    expect(saveV1.systems).toEqual([]);
    const r = migrate(saveV1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.systems).toEqual(newGame(saveV1.seed).systems);
    expect(r.state.systems[r.state.ops[0].systemId]).toBeDefined();
    const noSeed = migrate({ ...structuredClone(saveV6), systems: [], seed: undefined });
    expect(noSeed).toEqual({ ok: false, reason: 'corrupt' });
    const badId = migrate({ ...structuredClone(saveV6), systemId: 999 });
    expect(badId).toEqual({ ok: false, reason: 'corrupt' });
  });

  it.each([
    ['v1', saveV1],
    ['v2', saveV2],
    ['v3', saveV3],
    ['v4', saveV4],
    ['v5', saveV5],
    ['v6', saveV6],
    ['v7', saveV7],
    ['v8', saveV8],
    ['v9', saveV9],
    ['v10', saveV10],
    ['v13', saveV13],
  ])('a migrated %s fixture keeps running through step()', (_, fixture) => {
    const r = migrate(fixture);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 0; i < 50; i++) step(r.state, r.state.ops[0]);
    expect(Number.isFinite(r.state.credits)).toBe(true);
    expect(r.state.time).toBeGreaterThan(0);
  });

  it('applies one migration step per version, in order', () => {
    const seen: number[] = [];
    const steps: Record<number, (save: SaveBlob) => SaveBlob> = {
      1: (save) => {
        seen.push(save.version as number);
        save.a = 1;
        return save;
      },
      2: (save) => {
        seen.push(save.version as number);
        save.b = (save.a as number) + 1;
        return save;
      },
    };
    const out = applyMigrationSteps({ version: 1 }, 1, 3, steps);
    expect(seen).toEqual([1, 2]);
    expect(out).toMatchObject({ version: 3, a: 1, b: 2 });
    expect(applyMigrationSteps({ version: 1 }, 1, 3, { 1: (save) => save })).toBeNull();
  });

  it('rejects a version that is not a positive integer, and non-objects', () => {
    expect(migrate({ version: 0 })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate({ version: -2 })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate({ version: 1.5 })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate({ version: '1' })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate(null)).toEqual({ ok: false, reason: 'corrupt' });
    expect(migrate([])).toEqual({ ok: false, reason: 'corrupt' });
    expect(migrate('save')).toEqual({ ok: false, reason: 'corrupt' });
  });
});

function unreadable(result: LoadResult): Extract<LoadResult, { backedUp: boolean }> {
  if (result.ok || result.reason === 'empty') throw new Error('expected an unreadable save');
  return result;
}

async function expectPreserved(
  raw: string,
  reason: 'corrupt' | 'newer' | 'unknown',
): Promise<Extract<LoadResult, { ok: false }>> {
  mem.idb.set(SAVE_KEY, raw);
  local.set(SAVE_KEY, raw);
  const loaded = await loadGame();
  expect(loaded).toEqual({ ok: false, reason, notice: SAVE_BACKUP_NOTICE, backedUp: true });
  expect(mem.idb.get(SAVE_KEY)).toBe(raw);
  expect(local.get(SAVE_KEY)).toBe(raw);
  expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
  expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
  expect(saveOverwriteBlocked()).toBe(true);
  expect(await saveGame(newGame(1))).toBe(false);
  expect(mem.idb.get(SAVE_KEY)).toBe(raw);
  expect(local.get(SAVE_KEY)).toBe(raw);
  expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
  expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
  if (loaded.ok) throw new Error('expected the save to be preserved');
  return loaded;
}

describe('unreadable saves', () => {
  it('backs up a corrupt save and does not delete or overwrite it', async () => {
    const loaded = await expectPreserved('{"version":1,"ships":', 'corrupt');
    expect(loaded.reason).toBe('corrupt');
  });

  it('backs up a save that fails validation and does not delete it', async () => {
    const loaded = await expectPreserved(JSON.stringify({ version: 1, carrier: null }), 'corrupt');
    expect(loaded.reason).toBe('corrupt');
  });

  it('backs up a newer-version save and does not delete or overwrite it', async () => {
    const loaded = await expectPreserved(
      JSON.stringify({ ...saveV1, version: SAVE_VERSION + 1 }),
      'newer',
    );
    expect(loaded.reason).toBe('newer');
  });

  it('backs up an unknown save and does not delete it', async () => {
    const loaded = await expectPreserved(
      JSON.stringify({ credits: 10, ships: [], carrier: {} }),
      'unknown',
    );
    expect(loaded.reason).toBe('unknown');
  });

  it('copies a localStorage-only corrupt save into both backup stores', async () => {
    const raw = '{"version":1,';
    local.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toBe('corrupt');
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(await saveGame(newGame(3))).toBe(false);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(local.get(SAVE_KEY)).toBe(raw);
  });

  it('backs up a corrupt localStorage save when IndexedDB is unavailable', async () => {
    mem.fail = true;
    const raw = '{"nope"';
    local.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ok: false,
      reason: 'corrupt',
      notice: SAVE_BACKUP_NOTICE,
      backedUp: true,
    });
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(await saveGame(newGame(2))).toBe(false);
    expect(local.get(SAVE_KEY)).toBe(raw);
  });

  it('keeps an earlier backup when a later failed load is different', async () => {
    const first = '{"broken-a"';
    const second = '{"broken-b"';
    mem.idb.set(SAVE_KEY, first);
    local.set(SAVE_KEY, first);
    expect(unreadable(await loadGame()).backedUp).toBe(true);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(first);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(first);

    allowSaveOverwrite();
    expect(await saveGame(newGame(9))).toBe(true);

    mem.idb.set(SAVE_KEY, second);
    local.set(SAVE_KEY, second);
    expect(unreadable(await loadGame()).backedUp).toBe(true);
    expect(mem.idb.get(SAVE_KEY)).toBe(second);
    expect(local.get(SAVE_KEY)).toBe(second);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(first);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(first);
    const extras = [...mem.idb.keys()].filter(
      (key) => key.startsWith(`${SAVE_BACKUP_KEY}-`) && mem.idb.get(key) === second,
    );
    expect(extras).toHaveLength(1);
    // Timestamped backups live only in IndexedDB when it accepted the write.
    expect(local.has(extras[0])).toBe(false);
    const stored = await readBackups();
    expect(stored.map((entry) => entry.text).sort()).toEqual([first, second].sort());
  });

  it('reads the raw primary for the unreadable-save download, from either store', async () => {
    expect(await readPrimaryText()).toBeNull();
    local.set(SAVE_KEY, '{"local"');
    expect(await readPrimaryText()).toBe('{"local"');
    mem.idb.set(SAVE_KEY, '{"idb"');
    expect(await readPrimaryText()).toBe('{"idb"');
  });

  it('keeps bytes from a non-JSON IndexedDB value instead of a bare [object] string', async () => {
    mem.idb.set(SAVE_KEY, new TextEncoder().encode('{"bytes"').buffer);
    const loaded = unreadable(await loadGame());
    expect(loaded.backedUp).toBe(true);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe('{"bytes"');
  });

  it('does not rewrite a backup that already holds the same bytes', async () => {
    const raw = '{"same"';
    mem.idb.set(SAVE_KEY, raw);
    local.set(SAVE_KEY, raw);
    await loadGame();
    allowSaveOverwrite();
    expect(await saveGame(newGame(4))).toBe(true);
    mem.idb.set(SAVE_KEY, raw);
    local.set(SAVE_KEY, raw);
    await loadGame();
    const backupKeys = [...mem.idb.keys()].filter((key) => key.startsWith(SAVE_BACKUP_KEY));
    expect(backupKeys).toEqual([SAVE_BACKUP_KEY]);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
  });

  it('does not claim a backup when IndexedDB and localStorage both reject the write', async () => {
    mem.fail = true;
    installLocalStorage({ rejectWrites: true });
    const raw = '{"nope"';
    local.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ok: false,
      reason: 'corrupt',
      notice: SAVE_BACKUP_FAILED_NOTICE,
      backedUp: false,
    });
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(saveOverwriteBlocked()).toBe(true);
    expect(await saveGame(newGame(5))).toBe(false);
    expect(local.get(SAVE_KEY)).toBe(raw);
  });

  it('backs up a non-string IndexedDB value instead of treating it as empty', async () => {
    const value = { version: 1, credits: 99 };
    mem.idb.set(SAVE_KEY, value);
    const loaded = unreadable(await loadGame());
    expect(loaded.reason).toBe('corrupt');
    expect(loaded.backedUp).toBe(true);
    expect(mem.idb.get(SAVE_KEY)).toEqual(value);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(JSON.stringify(value));
    expect(local.get(SAVE_BACKUP_KEY)).toBe(JSON.stringify(value));
    expect(await saveGame(newGame(6))).toBe(false);
    expect(mem.idb.get(SAVE_KEY)).toEqual(value);
  });
});

describe('storage weight (#40)', () => {
  it('keeps only the newest backups in each store', async () => {
    for (let i = 0; i < MAX_BACKUPS + 3; i++) {
      mem.idb.set(SAVE_KEY, `{"broken-${i}"`);
      vi.spyOn(Date, 'now').mockReturnValue(1000 + i);
      // Loads run one after another: each must see the backups the last one wrote.
      // oxlint-disable-next-line no-await-in-loop
      expect(unreadable(await loadGame()).backedUp).toBe(true);
      vi.restoreAllMocks();
    }
    const idbBackups = [...mem.idb.keys()].filter((k) => k.startsWith(SAVE_BACKUP_KEY));
    expect(idbBackups).toHaveLength(MAX_BACKUPS);
    // The oldest (canonical) and the next ones went; the newest stays.
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(mem.idb.get(`${SAVE_BACKUP_KEY}-${1000 + MAX_BACKUPS + 2}`)).toBe(
      `{"broken-${MAX_BACKUPS + 2}"`,
    );
    expect(
      [...local.keys()].filter((k) => k.startsWith(SAVE_BACKUP_KEY)).length,
    ).toBeLessThanOrEqual(MAX_BACKUPS);
  });

  it('writes the primary save to IndexedDB only and drops a stale localStorage copy', async () => {
    local.set(SAVE_KEY, 'stale');
    expect(await saveGame(newGame(7))).toBe(true);
    expect(typeof mem.idb.get(SAVE_KEY)).toBe('string');
    expect(local.has(SAVE_KEY)).toBe(false);
  });

  it('falls back to localStorage without IndexedDB, and reports a save nothing kept', async () => {
    mem.fail = true;
    // One state: newGame stamps the clock, so two calls can differ.
    const state = newGame(7);
    expect(await saveGame(state)).toBe(true);
    expect(local.get(SAVE_KEY)).toBe(JSON.stringify(state));
    installLocalStorage({ rejectWrites: true });
    expect(await saveGame(newGame(7))).toBe(false);
  });
});

describe('export / import', () => {
  it('round-trips a current save through the migrate path', () => {
    const state = newGame(42);
    state.credits = 1234;
    state.stats.oreValueDelivered = 50;
    const copy = importSave(exportSave(state));
    expect(copy).not.toBeNull();
    expect(copy!.version).toBe(SAVE_VERSION);
    expect(copy!.credits).toBe(1234);
    expect(copy!.seed).toBe(42);
    expect(copy!.ops[0].ships.map((ship) => ship.id)).toEqual(
      state.ops[0].ships.map((ship) => ship.id),
    );
    expect(copy!.stats.oreValueDelivered).toBe(50);
    expect(copy!.ops[0].wave.timer).toBe(state.ops[0].wave.timer);
    expect(copy!.ops[0].storm.timer).toBe(state.ops[0].storm.timer);
  });

  it('round-trips a numeric storm timer from a tier 2 system', () => {
    const state = newGame(8);
    const tier2 = state.systems.find((system) => system.tier >= 2);
    expect(tier2).toBeTruthy();
    state.ops[0].systemId = tier2!.id;
    state.ops[0].storm.timer = 27.5;
    state.ops[0].wave.timer = 12;
    const copy = importSave(exportSave(state));
    expect(copy).not.toBeNull();
    expect(copy!.ops[0].systemId).toBe(tier2!.id);
    expect(copy!.systems[copy!.ops[0].systemId].tier).toBeGreaterThanOrEqual(2);
    expect(copy!.ops[0].storm.timer).toBe(27.5);
    expect(copy!.ops[0].wave.timer).toBe(12);
  });

  it('imports a v1 fixture through the same migrate path', () => {
    const copy = importSave(encodeRaw(saveV1));
    expect(copy).not.toBeNull();
    expect(copy!.version).toBe(SAVE_VERSION);
    expect(copy!.credits).toBe(saveV1.credits);
    expect(copy!.ops[0].ships[0].cargo).toBe(saveV1.ships[0].cargo);
    expect(copy!.ops[0].wave.timer).toBe(Infinity);
  });

  it('rejects a corrupt or newer import without touching storage', async () => {
    const raw = '{"version":1,"keep":true}';
    mem.idb.set(SAVE_KEY, raw);
    local.set(SAVE_KEY, raw);
    expect(importSave('not-a-save')).toBeNull();
    expect(importSave(encodeRaw({ version: SAVE_VERSION + 3, ships: [], carrier: {} }))).toBeNull();
    expect(mem.idb.get(SAVE_KEY)).toBe(raw);
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(saveOverwriteBlocked()).toBe(false);
  });
});

describe('loadGame', () => {
  it('loads a v1 save from IndexedDB without writing a backup', async () => {
    const raw = JSON.stringify(saveV1);
    mem.idb.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.credits).toBe(420);
    expect(loaded.state.ops[0].wave.timer).toBe(Infinity);
    expect(mem.idb.get(SAVE_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
  });

  it('loads a v1 save from localStorage when IndexedDB is empty', async () => {
    local.set(SAVE_KEY, JSON.stringify(saveV1));
    const loaded = await loadGame();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.credits).toBe(420);
    expect(loaded.state.ops[0].wave.timer).toBe(Infinity);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(saveOverwriteBlocked()).toBe(false);
  });
});

function decodeError(text: string): string | null {
  const result = decodeSave(text);
  return result.ok ? null : result.error;
}

describe('decodeSave', () => {
  it('gives the same state from a text export and a file export', () => {
    const state = newGame(7);
    state.credits = 987;
    state.ops[0].storm.timer = 3;
    const fromText = decodeSave(exportSave(state));
    const fromFile = decodeSave(exportSaveFile(state));
    expect(fromText.ok && fromFile.ok).toBe(true);
    if (!fromText.ok || !fromFile.ok) return;
    expect(fromFile.state).toEqual(fromText.state);
    expect(fromText.state.credits).toBe(987);
    expect(fromText.state.ops[0].storm.timer).toBe(3);
    expect(fromText.state.ops[0].wave.timer).toBe(state.ops[0].wave.timer);
    expect(JSON.parse(exportSaveFile(fromFile.state))).toEqual(JSON.parse(exportSaveFile(state)));
  });

  it('migrates an old save file instead of rejecting it', () => {
    expect(decodeSave(JSON.stringify(saveV1))).toMatchObject({
      ok: true,
      state: { version: SAVE_VERSION },
    });
  });

  it('explains each kind of bad import', () => {
    const error = decodeError;
    expect(error('   ')).toMatch(/paste/i);
    expect(error('%%%not base64')).toMatch(/could not be decoded/);
    expect(error('{"version":1,')).toMatch(/could not be decoded/);
    expect(error(JSON.stringify({ version: SAVE_VERSION + 1 }))).toMatch(/newer version/);
    expect(error(JSON.stringify({ version: 'x' }))).toMatch(/does not recognise/);
    expect(error(encodeRaw({ version: SAVE_VERSION, ships: [] }))).toMatch(/damaged/);
    expect(error(encodeRaw([1, 2]))).toMatch(/damaged/);
  });
});
