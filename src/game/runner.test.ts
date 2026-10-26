import { describe, expect, it } from 'vitest';
import { apply } from '../sim/actions';
import { emit, newGame } from '../sim/state';
import { stressGame } from '../sim/stress';
import { step } from '../sim/tick';
import type { GameState } from '../sim/types';
import { createLocalHost } from './host';
import { MODES, encodeFrame, type OutMsg } from './protocol';

const TICK_MS = 100;

function local(state: GameState) {
  const out: OutMsg[] = [];
  const host = createLocalHost((m) => out.push(m));
  host.post({ t: 'init', state, now: Date.now(), settle: false });
  host.runner.stop();
  return { host, out };
}

function pay(speed: number) {
  const s = newGame(2);
  s.miningIncomeAvg = 10;
  const { host } = local(s);
  host.post({ t: 'speed', v: speed });
  host.runner.resetClock(0);
  host.runner.pump(120_000);
  return host.runner.state?.credits ?? 0;
}

describe('sim runner', () => {
  it('matches stepping the sim directly, commands included', () => {
    const direct = newGame(7);
    const { host, out } = local(newGame(7));
    let t = 0;
    host.runner.resetClock(t);
    for (let i = 0; i < 300; i++) {
      if (i === 40) {
        apply(direct, { type: 'buyShip', cls: 'drone' });
        host.post({ t: 'cmd', cmd: { type: 'buyShip', cls: 'drone' } });
      }
      step(direct);
      t += TICK_MS;
      host.runner.pump(t);
    }
    host.post({ t: 'snapshot', id: 1 });
    const snap = out.find((m) => m.t === 'snapshot');
    expect(snap?.t === 'snapshot' && snap.id).toBe(1);
    const viaRunner = snap?.t === 'snapshot' ? snap.state : null;
    // The runner drains the event outbox; nothing else may differ.
    expect(JSON.stringify({ ...viaRunner, savedAt: 0, events: [] })).toEqual(
      JSON.stringify({ ...direct, savedAt: 0, events: [] }),
    );
    expect(out.some((m) => m.t === 'frame')).toBe(true);
  });

  it('does not share state with the main thread', () => {
    const { host, out } = local(newGame(3));
    const first = out.find((m) => m.t === 'state');
    if (first?.t !== 'state') throw new Error('no state');
    first.state.credits = -1;
    expect(host.runner.state?.credits).not.toBe(-1);
  });

  it('reports command errors', () => {
    const s = newGame(1);
    s.credits = 0;
    const { host, out } = local(s);
    host.post({ t: 'cmd', cmd: { type: 'buyShip', cls: 'drone' } });
    expect(out.some((m) => m.t === 'error')).toBe(true);
  });

  it('settles offline time on init', () => {
    const s = newGame(2);
    s.miningIncomeAvg = 10;
    s.savedAt = Date.now() - 3600_000;
    const out: OutMsg[] = [];
    const host = createLocalHost((m) => out.push(m));
    host.post({ t: 'init', state: s, now: Date.now(), settle: true });
    host.runner.stop();
    const st = out.find((m) => m.t === 'state');
    expect(st?.t === 'state' && st.offline?.credits).toBeGreaterThan(0);
  });

  it('drains sim events into merged, ranked events messages', () => {
    const s = newGame(5);
    const { host, out } = local(s);
    // newGame's CarrierOnline went out with init.
    const first = out.find((m) => m.t === 'events');
    expect(first?.t === 'events' && first.events.map((e) => e.kind)).toEqual(['CarrierOnline']);
    expect(host.runner.state?.events).toEqual([]);
    out.length = 0;
    const st = host.runner.state;
    if (!st) throw new Error('no state');
    st.time = 100;
    emit(st, 'ReserveRebuilt', { cls: 'drone' });
    emit(st, 'PiratesArrived', { size: 3 });
    emit(st, 'ReserveRebuilt', { cls: 'scout' });
    host.runner.resetClock(0);
    host.runner.pump(1);
    const batch = out.find((m) => m.t === 'events');
    if (batch?.t !== 'events') throw new Error('no events message');
    expect(batch.events.map((e) => [e.kind, e.count])).toEqual([
      ['PiratesArrived', 1],
      ['ReserveRebuilt', 2],
    ]);
    expect(st.events).toEqual([]);
    // The log keeps every line unmerged.
    expect(st.log.slice(0, 3).map((l) => l.kind)).toEqual([
      'ReserveRebuilt',
      'PiratesArrived',
      'ReserveRebuilt',
    ]);
  });

  it('pays a background gap the same at any game speed (#38)', () => {
    expect(pay(4)).toBe(pay(1));
  });
});

describe('frame encoding', () => {
  it('round-trips positions exactly and every mode', () => {
    const s = stressGame(200, 100, 10);
    for (let i = 0; i < 20; i++) step(s);
    const { frame } = encodeFrame(s);
    expect(frame.nShips).toBe(s.ships.length);
    s.ships.forEach((sh, i) => {
      expect(frame.ids[i]).toBe(sh.id);
      expect(frame.pos[i * 3]).toBe(sh.pos.x);
      expect(frame.pos[i * 3 + 2]).toBe(sh.pos.z);
      expect(MODES[frame.modes[i]]).toBe(sh.mode);
    });
  });
});
