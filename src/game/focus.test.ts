import { describe, expect, it } from 'vitest';
import { focusOp, newGame } from '../sim/state';
import type { GameState } from '../sim/types';
import { createLocalHost } from './localHost';
import { applySnapshot } from './snapshot';
import type { OutMsg } from './protocol';

const TICK_MS = 100;

/** Two carriers: op 0 in system 0, a copy with id 99 in `otherSystem`. */
function two(otherSystem = 1): GameState {
  const g = newGame(5);
  const other = structuredClone(g.ops[0]);
  other.id = 99;
  other.systemId = otherSystem;
  g.ops.push(other);
  return g;
}

function run(state: GameState) {
  const out: OutMsg[] = [];
  const host = createLocalHost((m) => out.push(m));
  host.post({ t: 'init', state, now: Date.now(), settle: false });
  host.runner.stop();
  host.runner.resetClock(0);
  let t = 0;
  const pump = (n: number) => {
    for (let i = 0; i < n; i++) host.runner.pump((t += TICK_MS));
  };
  return { host, out, pump, g: () => host.runner.state! };
}

describe('carrier focus', () => {
  it('follows the focus message and ignores unknown ids', () => {
    const { host, g } = run(two());
    host.post({ t: 'focus', carrierId: 99 });
    expect(focusOp(g()).id).toBe(99);
    host.post({ t: 'focus', carrierId: 1234 });
    expect(focusOp(g()).id).toBe(99);
  });

  it('answers a switch with a state and a frame for the new carrier', () => {
    const { host, out } = run(two());
    out.length = 0;
    host.post({ t: 'focus', carrierId: 99 });
    const state = out.find((m) => m.t === 'state');
    const frame = out.find((m) => m.t === 'frame');
    expect(state?.t === 'state' && state.snap.focus.id).toBe(99);
    expect(state?.t === 'state' && state.snap.carriers.map((c) => c.id)).toEqual([0, 99]);
    expect(frame?.t === 'frame' && frame.carrierId).toBe(99);
  });

  it('keeps the unfocused carrier in another system in the background', () => {
    const { pump, g } = run(two(1));
    const bg = g().ops[1];
    bg.miningIncomeAvg = 5;
    const before = g().credits;
    pump(100); // 10 s: ten background steps
    expect(bg.pirates).toHaveLength(0);
    expect(
      bg.ships.every((s) => s.mode === 'docked' || s.mode === 'carried' || s.mode === 'idle'),
    ).toBe(true);
    expect(g().credits).toBeGreaterThan(before);
  });

  it('steps a carrier sharing the viewed system at Tier A', () => {
    const { pump, g } = run(two(0));
    const before = g().ops[1].rng;
    pump(50);
    // Only Tier A (power, threats, behaviours) draws from the rng every tick.
    expect(g().ops[1].rng).not.toBe(before);
    expect(g().ops[1].ships.some((s) => s.mode !== 'docked')).toBe(true);
  });

  it('materialises a carrier when its system becomes the viewed one, and drops the old one', () => {
    const { host, g } = run(two(1));
    const g0 = g();
    g0.ops[0].fx.push({ ttl: 5 } as never);
    host.post({ t: 'focus', carrierId: 99 });
    expect(g0.ops[0].fx).toHaveLength(0); // dematerialised
    expect(g0.ops[1].systemId).toBe(1);
  });

  it('drops a stale frame in the mirror logic: frames carry the carrier id', () => {
    const { host, out } = run(two());
    host.post({ t: 'focus', carrierId: 99 });
    host.post({ t: 'focus', carrierId: 0 });
    const frames = out.filter((m) => m.t === 'frame');
    expect(frames.at(-1)?.t === 'frame' && frames.at(-1)).toMatchObject({ carrierId: 0 });
  });
});

describe('snapshot of a focused carrier', () => {
  it('rebuilds the focused operation and drops the previous carrier fx', () => {
    const g = two();
    g.focusId = 99;
    const out: OutMsg[] = [];
    const host = createLocalHost((m) => out.push(m));
    host.post({ t: 'init', state: g, now: Date.now(), settle: false });
    host.runner.stop();
    const msg = out.find((m) => m.t === 'state');
    if (msg?.t !== 'state') throw new Error('no state');
    const prev = newGame(1);
    prev.ops[0].fx.push({ ttl: 3 } as never);
    const mirror = applySnapshot(prev, msg.snap);
    expect(focusOp(mirror).id).toBe(99);
    expect(focusOp(mirror).fx).toHaveLength(0);
  });
});
