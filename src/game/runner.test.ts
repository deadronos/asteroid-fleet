import { describe, expect, it } from 'vitest';
import { apply } from '../sim/actions';
import { CHALLENGES } from '../sim/modifiers';
import { emit, focused, focusOp, newGame } from '../sim/state';
import { stressGame } from '../sim/stress';
import { step, stepSim } from '../sim/tick';
import type { ChallengeId, GameState, ShipMode } from '../sim/types';
import { createLocalHost } from './localHost';
import { SimRunner } from './runner';
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
  s.ops[0].miningIncomeAvg = 10;
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
        apply(direct, { type: 'buyShip', cls: 'drone', carrierId: 0 });
        host.post({ t: 'cmd', cmd: { type: 'buyShip', cls: 'drone', carrierId: 0 } });
      }
      step(direct, focusOp(direct));
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
    first.snap.global.credits = -1;
    first.snap.focus.carrier.hull = -1;
    expect(host.runner.state?.credits).not.toBe(-1);
    expect(host.runner.state?.ops[0].carrier.hull).not.toBe(-1);
  });

  it('reports command errors', () => {
    const s = newGame(1);
    s.credits = 0;
    const { host, out } = local(s);
    host.post({ t: 'cmd', cmd: { type: 'buyShip', cls: 'drone', carrierId: 0 } });
    expect(out.some((m) => m.t === 'error')).toBe(true);
  });

  it('settles offline time on init', () => {
    const s = newGame(2);
    s.ops[0].miningIncomeAvg = 10;
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
    emit(focused(st), 'ReserveRebuilt', { cls: 'drone' });
    emit(focused(st), 'PiratesArrived', { size: 3 });
    emit(focused(st), 'ReserveRebuilt', { cls: 'scout' });
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

  it('stamps events with the run epoch, and replace advances it', () => {
    const s = newGame(5);
    const { host, out } = local(s);
    const first = out.find((m) => m.t === 'events');
    expect(first?.t === 'events' && first.epoch).toBe(0);
    out.length = 0;
    host.post({ t: 'replace', state: newGame(6), epoch: 3 });
    const st = host.runner.state;
    if (!st) throw new Error('no state');
    st.time = 10;
    emit(focused(st), 'PiratesArrived', { size: 1 });
    host.runner.resetClock(0);
    host.runner.pump(1);
    const batch = out.find((m) => m.t === 'events');
    expect(batch?.t === 'events' && batch.epoch).toBe(3);
    expect(batch?.t === 'events' && batch.events.some((e) => e.kind === 'PiratesArrived')).toBe(
      true,
    );
  });

  it('pays a background gap the same at any game speed (#38)', () => {
    expect(pay(4)).toBe(pay(1));
  });
});

function stalledRunner() {
  let now = 0;
  const out: OutMsg[] = [];
  const runner = new SimRunner(
    (m) => out.push(m),
    () => now,
  );
  runner.handle({ t: 'init', state: newGame(2), now: 0, settle: false });
  runner.stop();
  now = 120_000;
  return { runner, out };
}

function welcomedBack(out: OutMsg[]) {
  return out.some((m) => m.t === 'events' && m.events.some((e) => e.kind === 'WelcomeBack'));
}

describe('a new run ignores a stalled pump clock (#189)', () => {
  it('replace does not settle the gap that happened before it', () => {
    const { runner, out } = stalledRunner();
    out.length = 0;
    runner.handle({ t: 'replace', state: newGame(8), epoch: 4 });
    runner.pump();
    expect(welcomedBack(out)).toBe(false);
  });

  it('prestige, admiralty and challenge do not settle that gap either', () => {
    const id = Object.keys(CHALLENGES)[0] as ChallengeId;
    for (const send of [
      (runner: SimRunner) => runner.handle({ t: 'prestige' }),
      (runner: SimRunner) => runner.handle({ t: 'admiralty' }),
      (runner: SimRunner) => runner.handle({ t: 'challenge', id }),
    ]) {
      const { runner, out } = stalledRunner();
      out.length = 0;
      send(runner);
      runner.pump();
      expect(welcomedBack(out)).toBe(false);
    }
  });
});

const EVERY_MODE = [
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
] as const satisfies readonly ShipMode[];

describe('frame encoding', () => {
  it('round-trips every ShipMode (#181)', () => {
    const op = focusOp(newGame(1));
    const ship = op.ships[0];
    const at = op.ships.indexOf(ship);
    for (const mode of EVERY_MODE) {
      ship.mode = mode;
      const { frame } = encodeFrame(op);
      expect(MODES[frame.modes[at]]).toBe(mode);
    }
  });

  it('round-trips positions exactly and every mode', () => {
    const s = stressGame(200, 100, 10);
    for (let i = 0; i < 20; i++) stepSim(s);
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
