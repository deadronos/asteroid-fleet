import { describe, expect, it } from 'vitest';
import { SEVERITY } from '../sim/state';
import type { EventData, Severity, SimEvent, SimEventKind } from '../sim/types';
import {
  DISMISSED_CAP,
  MIN_ON_SCREEN_MS,
  TOAST_MS,
  TOAST_POLICY,
  VISIBLE_CAP,
  WAITING_CAP,
  ToastQueue,
  offerToasts,
  wantsToast,
} from './toasts';

function ev<K extends SimEventKind>(
  kind: K,
  data: EventData[K],
  extra: { carrierId?: number; count?: number; severity?: Severity; t?: number } = {},
): SimEvent {
  return {
    kind,
    carrierId: extra.carrierId ?? 0,
    systemId: 0,
    severity: extra.severity ?? SEVERITY[kind],
    t: extra.t ?? 0,
    count: extra.count ?? 1,
    data,
  } as SimEvent;
}

function queueAt(now: { t: number }) {
  return new ToastQueue(() => now.t);
}

function lost(cls: EventData['ShipLost']['cls'], count: number) {
  return ev('ShipLost', { cls, cause: 'destroyed' }, { count });
}

function bus(event: SimEvent, id: number): SimEvent & { id: number } {
  return { ...event, id };
}

describe('toast policy', () => {
  it('names a policy for every event kind', () => {
    expect(Object.keys(TOAST_POLICY).sort()).toEqual(Object.keys(SEVERITY).sort());
  });

  it('toasts critical events, waves, jumps and welcome, and leaves the rest in the inbox', () => {
    const focused = 0;
    const toasting: SimEventKind[] = [];
    const inbox: SimEventKind[] = [];
    for (const kind of Object.keys(TOAST_POLICY) as SimEventKind[]) {
      if (kind === 'ShipLost' || kind === 'StormStarted') continue;
      const sample = sampleOf(kind);
      (wantsToast(sample, focused) ? toasting : inbox).push(kind);
    }
    expect(toasting.sort()).toEqual(
      [
        'ChallengeComplete',
        'EmergencyJump',
        'PirateWaveIncoming',
        'PiratesArrived',
        'WarpCharging',
        'Warped',
        'WelcomeBack',
      ].sort(),
    );
    expect(inbox).toEqual(
      expect.arrayContaining([
        'ReserveRebuilt',
        'ShipRebuilt',
        'VeinFound',
        'HazardCharted',
        'BargeFallback',
        'Legacy',
      ]),
    );
    expect(inbox).not.toEqual(expect.arrayContaining(toasting));
  });

  it('toasts ShipLost for a barge or when at least three ships were lost', () => {
    expect(wantsToast(lost('drone', 1), 0)).toBe(false);
    expect(wantsToast(lost('drone', 2), 0)).toBe(false);
    expect(wantsToast(lost('fighter', 3), 0)).toBe(true);
    expect(wantsToast(lost('barge', 1), 0)).toBe(true);
  });

  it('toasts StormStarted only for the focused carrier, and a jump on any carrier', () => {
    const storm = (carrierId: number) => ev('StormStarted', { h2: false }, { carrierId });
    expect(wantsToast(storm(0), 0)).toBe(true);
    expect(wantsToast(storm(1), 0)).toBe(false);
    expect(wantsToast(ev('Warped', { system: 'Lumen' }, { carrierId: 1 }), 0)).toBe(true);
    expect(wantsToast(ev('WarpCharging', { system: 'Lumen' }, { carrierId: 2 }), 0)).toBe(true);
  });

  it('toasts a critical event even when its kind is inbox-only', () => {
    const critical = ev('VeinFound', { veins: 1 }, { severity: 'critical' });
    expect(TOAST_POLICY.VeinFound).toBe('inbox');
    expect(wantsToast(critical, 0)).toBe(true);
  });
});

describe('toast queue', () => {
  it('shows at most three, newest on top, and holds the rest', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (const text of ['A', 'B', 'C', 'D', 'E']) {
      q.push({ text, severity: 'info', carrierId: null });
      now.t += 1;
    }
    expect(q.shown(now.t).map((t) => t.text)).toEqual(['E', 'D', 'C']);
    expect(q.shown(now.t)).toHaveLength(VISIBLE_CAP);
    expect(q.waiting).toBe(2);
    // A and B arrived at t=0 and t=1, so both have already expired by t=3002. C expires then too.
    expect(q.shown(2 + TOAST_MS.info).map((t) => t.text)).toEqual(['E', 'D']);
    expect(q.waiting).toBe(0);
  });

  it('updates a merged event in place, restarts its timer, and does not stack a duplicate', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    q.push({ eventId: 7, text: 'one drone', severity: 'warn', carrierId: 0 });
    now.t = 5_000;
    q.push({ eventId: 7, text: 'three drones', severity: 'warn', carrierId: 0 });
    expect(q.shown(now.t)).toHaveLength(1);
    expect(q.shown(now.t)[0].text).toBe('three drones');
    expect(q.shown(now.t + TOAST_MS.warn - 1)).toHaveLength(1);
    expect(q.shown(now.t + TOAST_MS.warn)).toEqual([]);
  });

  it('keeps a critical toast until it is dismissed', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    const key = q.push({
      eventId: 1,
      text: 'Pirates have arrived!',
      severity: 'critical',
      carrierId: 3,
    });
    expect(q.shown(1e12)).toHaveLength(1);
    expect(q.shown(1e12)[0].severity).toBe('critical');
    q.dismiss(key);
    expect(q.shown(1e12)).toEqual([]);
  });

  it('drops info and good after 3s and warn after 6s', () => {
    const now = { t: 100 };
    const q = queueAt(now);
    q.push({ text: 'info', severity: 'info', carrierId: null });
    q.push({ text: 'good', severity: 'good', carrierId: null });
    q.push({ text: 'warn', severity: 'warn', carrierId: null });
    expect(q.shown(now.t + TOAST_MS.info - 1).map((t) => t.text)).toEqual(['warn', 'good', 'info']);
    expect(q.shown(now.t + TOAST_MS.info).map((t) => t.text)).toEqual(['warn']);
    expect(q.shown(now.t + TOAST_MS.warn - 1).map((t) => t.text)).toEqual(['warn']);
    expect(q.shown(now.t + TOAST_MS.warn)).toEqual([]);
  });

  it('brings back the newest waiting toast when the one on top closes', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    q.push({ text: 'A', severity: 'info', carrierId: 0 });
    now.t = 1;
    q.push({ text: 'B', severity: 'info', carrierId: 0 });
    now.t = 2;
    q.push({ text: 'C', severity: 'info', carrierId: 0 });
    now.t = 3;
    q.push({ text: 'D', severity: 'info', carrierId: 4 });
    expect(q.shown(now.t).map((t) => t.text)).toEqual(['D', 'C', 'B']);
    expect(q.goTo(q.shown(now.t)[0].key)).toBe(4);
    expect(q.shown(now.t).map((t) => t.text)).toEqual(['C', 'B', 'A']);
  });

  it('caps the waiting queue and drops the oldest non-critical waiters first', () => {
    const q = new ToastQueue(() => 0);
    for (let i = 0; i < VISIBLE_CAP + WAITING_CAP + 2; i++) {
      q.push({ text: String(i), severity: 'info', carrierId: null });
    }
    expect(q.waiting).toBe(WAITING_CAP);
    for (let n = 0; n < VISIBLE_CAP; n++) q.dismiss(q.shown(0)[0].key);
    expect(q.shown(0).map((t) => t.text)).toEqual(['11', '10', '9']);
    expect(q.shown(0).some((t) => t.text === '0' || t.text === '1')).toBe(false);
  });

  it('keeps a critical waiter when the overflow is non-critical', () => {
    const q = new ToastQueue(() => 0);
    for (let i = 0; i < VISIBLE_CAP; i++) {
      q.push({ text: `c${i}`, severity: 'critical', carrierId: null });
    }
    q.push({ text: 'hold', severity: 'critical', carrierId: null });
    for (let i = 0; i < WAITING_CAP + 2; i++) {
      q.push({ text: `i${i}`, severity: 'info', carrierId: null });
    }
    expect(q.waiting).toBe(WAITING_CAP);
    const seen: string[] = [];
    for (let n = 0; n < 40 && q.shown(0).length > 0; n++) {
      const top = q.shown(0)[0];
      seen.push(top.text);
      q.dismiss(top.key);
    }
    expect(seen).toContain('hold');
    expect(seen).not.toContain('i0');
    expect(seen).not.toContain('i1');
  });

  it('still caps the queue when every waiter is critical', () => {
    const q = new ToastQueue(() => 0);
    for (let i = 0; i < VISIBLE_CAP + WAITING_CAP + 1; i++) {
      q.push({ text: String(i), severity: 'critical', carrierId: null });
    }
    expect(q.waiting).toBe(WAITING_CAP);
  });

  it('drops a waiter whose display time passed while it waited', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (let i = 0; i < VISIBLE_CAP; i++) {
      q.push({ text: `c${i}`, severity: 'critical', carrierId: null });
    }
    q.push({ text: 'late', severity: 'info', carrierId: null });
    expect(q.waiting).toBe(1);
    now.t = TOAST_MS.info;
    q.dismiss(q.shown(now.t).find((t) => t.text === 'c0')?.key ?? null);
    expect(q.shown(now.t).map((t) => t.text)).toEqual(['c2', 'c1']);
    expect(q.waiting).toBe(0);
  });

  it('keeps a promoted toast on screen for the minimum time', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (let i = 0; i < VISIBLE_CAP; i++) {
      q.push({ text: `c${i}`, severity: 'critical', carrierId: null });
    }
    // A warn that waited 5.5s of its 6s display window used to flash for ~0.5s.
    q.push({ text: 'late warn', severity: 'warn', carrierId: null });
    now.t = 5_500;
    q.dismiss(q.shown(now.t)[0].key);
    expect(MIN_ON_SCREEN_MS).toBe(1_500);
    expect(q.shown(now.t).some((t) => t.text === 'late warn')).toBe(true);
    expect(q.shown(now.t + 1_500 - 1).some((t) => t.text === 'late warn')).toBe(true);
    expect(q.shown(now.t + 1_500).some((t) => t.text === 'late warn')).toBe(false);
  });

  it('still shows a promoted toast for the display time it has left when that is longer', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (let i = 0; i < VISIBLE_CAP; i++) {
      q.push({ text: `c${i}`, severity: 'critical', carrierId: null });
    }
    q.push({ text: 'soon', severity: 'warn', carrierId: null });
    now.t = 1_000;
    q.dismiss(q.shown(now.t)[0].key);
    expect(q.shown(now.t + 1_500).some((t) => t.text === 'soon')).toBe(true);
    expect(q.shown(TOAST_MS.warn - 1).some((t) => t.text === 'soon')).toBe(true);
    expect(q.shown(TOAST_MS.warn).some((t) => t.text === 'soon')).toBe(false);
  });

  it('refreshes a waiting toast when a later event merges into it', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (let i = 0; i < VISIBLE_CAP; i++) {
      q.push({ text: `c${i}`, severity: 'critical', carrierId: null });
    }
    q.push({ eventId: 9, text: 'one', severity: 'warn', carrierId: 1 });
    now.t = TOAST_MS.warn - 10;
    q.push({ eventId: 9, text: 'three', severity: 'warn', carrierId: 1 });
    now.t = TOAST_MS.warn + 10;
    q.dismiss(q.shown(now.t)[0].key);
    expect(q.shown(now.t).some((t) => t.text === 'three')).toBe(true);
  });

  it('collapses critical overflow into one sticky summary instead of dropping it', () => {
    const q = new ToastQueue(() => 0);
    for (let i = 0; i < VISIBLE_CAP + WAITING_CAP + 1; i++) {
      q.push({ text: String(i), severity: 'critical', carrierId: null });
    }
    const summary = q.shown(0).find((t) => t.action?.type === 'open-inbox');
    expect(summary?.text).toBe('1 more critical event, open inbox');
    expect(summary?.severity).toBe('critical');
    expect(summary?.action).toEqual({ type: 'open-inbox', severity: 'critical' });
    expect(q.waiting).toBe(WAITING_CAP);
    expect(q.shown(0).filter((t) => t.action?.type !== 'open-inbox')).toHaveLength(VISIBLE_CAP);
    const seen: string[] = [];
    for (let n = 0; n < 40; n++) {
      const top = q.shown(0).find((t) => t.action?.type !== 'open-inbox');
      if (!top) break;
      seen.push(top.text);
      q.dismiss(top.key);
    }
    expect(seen).not.toContain('0');
    expect(seen).toContain('1');
    expect(seen).toContain('13');
    expect(q.shown(1e12).map((t) => t.key)).toEqual([summary?.key]);
    q.dismiss(summary?.key ?? null);
    expect(q.shown(1e12)).toEqual([]);
  });

  it('updates the critical overflow count on the same sticky summary', () => {
    const q = new ToastQueue(() => 0);
    for (let i = 0; i < VISIBLE_CAP + WAITING_CAP + 1; i++) {
      q.push({ text: String(i), severity: 'critical', carrierId: null });
    }
    const summary = q.shown(0).find((t) => t.action?.type === 'open-inbox');
    q.push({ text: 'newer', severity: 'critical', carrierId: null });
    const updated = q.shown(1e12).find((t) => t.action?.type === 'open-inbox');
    expect(updated?.key).toBe(summary?.key);
    expect(updated?.text).toBe('2 more critical events, open inbox');
    expect(updated?.action).toEqual({ type: 'open-inbox', severity: 'critical' });
  });

  it('does not let a lesser toast cover a critical one', () => {
    const q = new ToastQueue(() => 0);
    q.push({ text: 'crit', severity: 'critical', carrierId: 1 });
    q.push({ text: 'a', severity: 'info', carrierId: null });
    q.push({ text: 'b', severity: 'info', carrierId: null });
    q.push({ text: 'c', severity: 'info', carrierId: null });
    const texts = q.shown(0).map((t) => t.text);
    expect(texts).toEqual(['c', 'b', 'crit']);
    expect(q.waiting).toBe(1);
  });

  it('Go to closes the toast and returns its carrier', () => {
    const q = new ToastQueue(() => 0);
    const key = q.push({
      eventId: 4,
      text: 'Warped to Lumen.',
      severity: 'good',
      carrierId: 6,
    });
    expect(q.goTo(key)).toBe(6);
    expect(q.shown(0)).toEqual([]);
    expect(q.goTo(key)).toBeNull();
  });

  it('keeps updating a ShipLost toast after a later loss would not open one', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    const barge = ev('ShipLost', { cls: 'barge', cause: 'destroyed' });
    offerToasts(q, [bus(barge, 7)], 0);
    expect(wantsToast(barge, 0)).toBe(true);
    now.t = 5_000;
    const follow = ev('ShipLost', { cls: 'drone', cause: 'destroyed' }, { count: 2, t: 1 });
    expect(wantsToast(follow, 0)).toBe(false);
    offerToasts(q, [bus(follow, 7)], 0);
    expect(q.shown(now.t)[0].event).toMatchObject({
      kind: 'ShipLost',
      count: 2,
      data: { cls: 'drone' },
    });
    expect(q.shown(now.t + TOAST_MS.warn - 1)).toHaveLength(1);
    expect(q.shown(now.t + TOAST_MS.warn)).toEqual([]);
  });

  it('does not bring a dismissed toast back unless the severity rises', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    offerToasts(q, [bus(ev('ShipLost', { cls: 'barge', cause: 'destroyed' }), 4)], 0);
    q.dismiss(q.shown(now.t)[0].key);
    now.t = 1_000;
    const again = ev('ShipLost', { cls: 'barge', cause: 'destroyed' }, { count: 2, t: 1 });
    expect(wantsToast(again, 0)).toBe(true);
    offerToasts(q, [bus(again, 4)], 0);
    expect(q.shown(now.t)).toEqual([]);
    const critical = ev(
      'ShipLost',
      { cls: 'drone', cause: 'destroyed' },
      { count: 4, severity: 'critical', t: 2 },
    );
    offerToasts(q, [bus(critical, 4)], 0);
    expect(q.shown(now.t).map((t) => t.severity)).toEqual(['critical']);
    expect(q.shown(now.t)[0].event).toMatchObject({ count: 4, data: { cls: 'drone' } });
  });

  it('treats Go to as a dismissal of that event', () => {
    const q = new ToastQueue(() => 0);
    const key = q.push({ eventId: 3, text: 'warped', severity: 'good', carrierId: 1 });
    expect(q.goTo(key)).toBe(1);
    q.push({ eventId: 3, text: 'warped again', severity: 'good', carrierId: 1 });
    expect(q.shown(0)).toEqual([]);
    q.push({ eventId: 3, text: 'critical warp', severity: 'critical', carrierId: 1 });
    expect(q.shown(0).map((t) => t.severity)).toEqual(['critical']);
  });

  it('forgets the oldest dismissal past the cap, and a cleared queue forgets them all', () => {
    const q = new ToastQueue(() => 0);
    for (let id = 1; id <= DISMISSED_CAP; id++) {
      q.dismiss(q.push({ eventId: id, text: `e${id}`, severity: 'info', carrierId: null }));
    }
    q.push({ eventId: 1, text: 'still out', severity: 'info', carrierId: null });
    expect(q.shown(0)).toEqual([]);
    q.dismiss(
      q.push({ eventId: DISMISSED_CAP + 1, text: 'overflow', severity: 'info', carrierId: null }),
    );
    q.push({ eventId: 1, text: 'back', severity: 'info', carrierId: null });
    expect(q.shown(0).map((t) => t.text)).toEqual(['back']);
    q.clear();
    q.push({ eventId: 2, text: 'fresh', severity: 'info', carrierId: null });
    expect(q.shown(0).map((t) => t.text)).toEqual(['fresh']);
  });

  it('puts the newest severe event on top and skips inbox-only kinds', () => {
    const q = new ToastQueue(() => 0);
    offerToasts(
      q,
      [
        bus(ev('VeinFound', { veins: 1 }), 1),
        bus(ev('WelcomeBack', { credits: 4 }, { t: 5 }), 3),
        bus(ev('PiratesArrived', { size: 2 }, { t: 5 }), 2),
      ],
      0,
    );
    expect(q.shown(0).map((t) => t.event?.kind)).toEqual(['PiratesArrived', 'WelcomeBack']);
    expect(q.shown(0).map((t) => t.systemId)).toEqual([0, 0]);
  });

  it('does not focus an engine error, and a merge while waiting does not add a second toast', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (let i = 0; i < VISIBLE_CAP; i++)
      q.push({ text: `v${i}`, severity: 'critical', carrierId: 0 });
    const waiting = q.push({ eventId: 9, text: 'lost 1', severity: 'warn', carrierId: 2 });
    now.t = 50;
    const again = q.push({ eventId: 9, text: 'lost 3', severity: 'warn', carrierId: 2 });
    expect(again).toBe(waiting);
    expect(q.waiting).toBe(1);
    const error = q.push({ text: 'Autosave failed', severity: 'warn', carrierId: null });
    expect(q.goTo(error)).toBeNull();
    expect(q.waiting).toBe(1);
    expect(q.shown(now.t).some((t) => t.text === 'Autosave failed')).toBe(false);
  });
});

function sampleOf(kind: SimEventKind): SimEvent {
  switch (kind) {
    case 'CarrierOnline':
      return ev(kind, { system: 'Kestrel' });
    case 'ShipLost':
      return ev(kind, { cls: 'drone', cause: 'destroyed' });
    case 'ShipRetreating':
      return ev(kind, { cls: 'fighter' });
    case 'PirateWaveIncoming':
      return ev(kind, { size: 4, eta: 12 });
    case 'PiratesArrived':
      return ev(kind, { size: 4 });
    case 'WaveRepelled':
      return ev(kind, {});
    case 'StormStarted':
    case 'StormPassed':
      return ev(kind, { h2: false });
    case 'HazardCharted':
      return ev(kind, { hazard: 'debris' });
    case 'VeinFound':
      return ev(kind, { veins: 1 });
    case 'BargeWrecked':
    case 'BargeFallback':
    case 'WarpCancelled':
    case 'EmergencyJump':
      return ev(kind, {});
    case 'ReserveRebuilt':
      return ev(kind, { cls: 'drone' });
    case 'ShipRebuilt':
      return ev(kind, { cls: 'drone', cost: 10 });
    case 'HangarInstalled':
      return ev(kind, { hangarType: 'launch' });
    case 'WarpCharging':
    case 'Warped':
      return ev(kind, { system: 'Lumen' });
    case 'Prestiged':
      return ev(kind, { research: 3 });
    case 'Admiralty':
      return ev(kind, { marks: 2 });
    case 'ChallengeStarted':
      return ev(kind, { challenge: 'pacifist' });
    case 'ChallengeComplete':
      return ev(kind, { challenge: 'pacifist', marks: 1 });
    case 'WelcomeBack':
      return ev(kind, { credits: 20 });
    case 'Legacy':
      return ev(kind, { text: 'Docked.' });
    default: {
      const never: never = kind;
      return never;
    }
  }
}
