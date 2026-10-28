import { describe, expect, it, vi } from 'vitest';
import { newGame } from '../sim/state';
import type { SimEvent } from '../sim/types';
import { engine } from './engine';
import { ACTIVE_SLOT_KEY } from './slots';
import { TOAST_MS, VISIBLE_CAP, WAITING_CAP } from './toasts';

function pirate(id: number): SimEvent & { id: number } {
  return {
    id,
    kind: 'PiratesArrived',
    carrierId: 0,
    systemId: 0,
    severity: 'critical',
    t: 1,
    count: 1,
    data: { size: 2 },
  };
}

describe('engine.replace', () => {
  it('clears the backup-failed flag and the notice', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    engine.saveNotice = 'Your save could not be loaded and could not be backed up.';
    engine.saveBackupFailed = true;
    engine.replace(newGame(3));
    expect(engine.saveBackupFailed).toBe(false);
    expect(engine.saveNotice).toBeNull();
  });
});

describe('slot writes (#40)', () => {
  it('toasts a failed slot write once, as a warning', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const local = new Map<string, string>([[ACTIVE_SLOT_KEY, '2']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: (key: string) => local.delete(key),
    });
    engine.toasts.clear();
    engine.replace(newGame(3));
    const toast = engine.toasts.shown().find((t) => t.text.includes('save slot 2'));
    expect(toast).toMatchObject({ severity: 'warn', carrierId: null });
    engine.toasts.clear();
    engine.replace(newGame(3));
    expect(engine.toasts.shown().some((t) => t.text.includes('save slot 2'))).toBe(false);
    vi.unstubAllGlobals();
    engine.toasts.clear();
  });
});

describe('run epoch', () => {
  it('drops an events message from before reset or import', () => {
    engine.toasts.clear();
    engine.events = [];
    const epoch = engine.epoch;
    engine.onSimMessage({ t: 'events', epoch, events: [pirate(41)] });
    expect(engine.toasts.shown().some((t) => t.event?.kind === 'PiratesArrived')).toBe(true);
    expect(engine.events.some((e) => e.id === 41)).toBe(true);
    engine.replace(newGame(9));
    expect(engine.epoch).toBe(epoch + 1);
    expect(engine.toasts.shown().some((t) => t.event?.kind === 'PiratesArrived')).toBe(false);
    expect(engine.events).toEqual([]);
    engine.onSimMessage({ t: 'events', epoch, events: [pirate(41)] });
    expect(engine.toasts.shown().some((t) => t.event?.kind === 'PiratesArrived')).toBe(false);
    expect(engine.events).toEqual([]);
    engine.onSimMessage({ t: 'events', epoch: engine.epoch, events: [pirate(42)] });
    expect(engine.toasts.shown().some((t) => t.event?.id === 42)).toBe(true);
    engine.toasts.clear();
    engine.events = [];
  });
});

describe('toast expiry clock', () => {
  it('keeps expiring on the wall clock while the game is paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const wasPaused = engine.paused;
    engine.paused = true;
    engine.toasts.clear();
    try {
      engine.toasts.push({ text: 'while paused', severity: 'info', carrierId: null });
      expect(engine.toasts.shown().map((t) => t.text)).toEqual(['while paused']);
      vi.setSystemTime(1_000 + TOAST_MS.info);
      expect(engine.paused).toBe(true);
      expect(engine.toasts.shown()).toEqual([]);
    } finally {
      engine.paused = wasPaused;
      engine.toasts.clear();
      vi.useRealTimers();
    }
  });
});

describe('critical overflow inbox', () => {
  it('opens the log filtered to critical from the summary toast', () => {
    engine.toasts.clear();
    for (let i = 0; i < VISIBLE_CAP + WAITING_CAP + 1; i++) {
      engine.toasts.push({ text: String(i), severity: 'critical', carrierId: null });
    }
    const summary = engine.toasts.shown().find((t) => t.action?.type === 'open-inbox');
    expect(summary).toBeTruthy();
    expect(engine.openToastInbox(summary?.key ?? null)).toEqual({
      carrier: 'all',
      severity: 'critical',
    });
    expect(engine.openToastInbox('missing')).toBeNull();
    const ordinary = engine.toasts.shown().find((t) => t.action?.type !== 'open-inbox');
    expect(engine.openToastInbox(ordinary?.key ?? null)).toBeNull();
    engine.toasts.clear();
  });
});

describe('toast Go to', () => {
  it('focuses the event carrier and closes the toast', () => {
    engine.toasts.clear();
    const previous = engine.state.ops;
    const extra = { ...previous[0], id: 6 };
    engine.state.ops = [...previous, extra];
    const key = engine.toasts.push({
      eventId: 4,
      text: 'Warped to Lumen.',
      severity: 'good',
      carrierId: 6,
    });
    engine.goToToast(key);
    expect(engine.focusedCarrierId).toBe(6);
    expect(engine.toasts.shown()).toEqual([]);
    engine.state.ops = previous;
    engine.focusCarrier(previous[0].id);
    expect(engine.focusedCarrierId).toBe(previous[0].id);
    engine.toasts.clear();
  });

  it('closes a toast for the only carrier without leaving the focus unset', () => {
    engine.toasts.clear();
    const id = engine.state.ops[0].id;
    const key = engine.toasts.push({
      eventId: 8,
      text: 'Pirates have arrived!',
      severity: 'critical',
      carrierId: id,
    });
    engine.goToToast(key);
    expect(engine.focusedCarrierId).toBe(id);
    expect(engine.toasts.shown()).toEqual([]);
  });
});

describe('unload mirror save (#157)', () => {
  it('does not overwrite a newer worker save with the lagging mirror', () => {
    const e = engine as unknown as {
      state: { time: number };
      write: (s: unknown) => Promise<boolean>;
      saveMirror: () => void;
      lastWrittenTime: number;
      carriers: unknown[];
    };
    const write = vi.spyOn(e, 'write').mockResolvedValue(true);
    const carriers = e.carriers;
    e.carriers = [];
    const time = e.state.time;
    e.lastWrittenTime = time + 0.2;
    e.saveMirror();
    expect(write).not.toHaveBeenCalled();
    e.lastWrittenTime = time;
    e.saveMirror();
    expect(write).toHaveBeenCalledTimes(1);
    e.carriers = carriers;
    write.mockRestore();
  });
});

describe('autosave across a reset (#170)', () => {
  it('drops a snapshot requested before replace instead of writing it over the new run', async () => {
    const e = engine as unknown as {
      host: { kind: string; post: (m: { t: string; id?: number }) => void } | null;
      started: () => void;
      write: (s: unknown) => Promise<boolean>;
    };
    const posted: { t: string; id?: number }[] = [];
    const host = e.host;
    e.host = { kind: 'local', post: (m) => posted.push(m) };
    e.started();
    const write = vi.spyOn(e, 'write').mockResolvedValue(true);
    const old = newGame(1);
    const pending = engine.save();
    await Promise.resolve();
    const req = posted.find((m) => m.t === 'snapshot')!;
    const fresh = newGame(2);
    engine.replace(fresh);
    engine.onSimMessage({ t: 'snapshot', id: req.id!, state: old });
    expect(await pending).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(fresh);
    write.mockRestore();
    e.host = host;
  });
});
