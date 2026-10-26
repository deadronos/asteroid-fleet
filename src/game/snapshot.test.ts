import { serialize } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { stressGame } from '../sim/stress';
import { stateOf } from '../sim/state';
import { stepSim } from '../sim/tick';
import type { GameState, Sim } from '../sim/types';
import { applySnapshot, encodeSnapshot } from './snapshot';

function busyGame(): Sim {
  const s = stressGame(1000, 600, 40);
  for (const sh of s.ships) {
    if (sh.cls === 'barge') sh.modules = ['tractor', 'shield'];
    if (sh.cls === 'drone') sh.modules = ['drill'];
  }
  for (let i = 0; i < 100; i++) stepSim(s);
  s.events.length = 0;
  // The one mode frames do not carry.
  s.ships.find((x) => x.cls === 'drone' && x.mode !== 'docked')!.mode = 'carried';
  // A timed stance card in force (#82).
  s.ships.find((x) => x.cls === 'fighter')!.hold = { card: 3, until: s.time + 4.5 };
  return s;
}

/** What the worker posts and the main thread receives, cloned like a postMessage. */
function roundTrip(s: Sim, prev: GameState | null, withFields = true): GameState {
  const { snap, transfer } = encodeSnapshot(stateOf(s), withFields);
  return applySnapshot(prev, structuredClone(snap, { transfer }));
}

/** The sim state as the mirror should hold it: `fx` comes with frames instead. */
function expected(s: Sim, fx: Sim['fx']): GameState {
  const g = stateOf(s);
  return { ...g, ops: [{ ...g.ops[0], fx }] };
}

/** Mean ms per call after a short warm-up. */
function time(f: () => void, n = 100): number {
  for (let i = 0; i < 10; i++) f();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) f();
  return (performance.now() - t0) / n;
}

describe('UI snapshot', () => {
  it('rebuilds the exact sim state', () => {
    const s = busyGame();
    expect(s.ships.some((x) => x.station)).toBe(true);
    expect(s.ships.some((x) => x.mode === 'carried')).toBe(true);
    expect(s.ships.some((x) => x.hold)).toBe(true);
    expect(Object.keys(s.fields).length).toBeGreaterThan(0);
    expect(roundTrip(s, null)).toEqual(expected(s, []));
  });

  it('updates the previous mirror in place', () => {
    const s = busyGame();
    const prev = roundTrip(s, null);
    const ship = prev.ops[0].ships[0];
    for (let i = 0; i < 20; i++) stepSim(s);
    s.events.length = 0;
    // A hold that ran out must not linger on the reused mirror ship.
    for (const sh of s.ships) delete sh.hold;
    const next = roundTrip(s, prev, false);
    expect(next.ops[0].ships[0]).toBe(ship);
    expect(next.fields).toBe(prev.fields);
    expect(next).toEqual(expected(s, prev.ops[0].fx));
  });

  it('keeps nothing shared with the sim', () => {
    const s = busyGame();
    const m = roundTrip(s, null);
    m.ops[0].hangars[0].items.length = 0;
    m.ops[0].carrier.hull = -1;
    m.ops[0].ships[0].pos.x = 1e9;
    expect(s.hangars[0].items.length).toBeGreaterThan(0);
    expect(s.carrier.hull).not.toBe(-1);
    expect(s.ships[0].pos.x).not.toBe(1e9);
  });

  // Not a pass/fail benchmark: it logs the before/after cost of one UI message at 1000 ships.
  it('costs far less to clone than the full state', () => {
    const s = busyGame();
    const g = stateOf(s);
    let mirror: GameState | null = null;
    const full = time(() => structuredClone(g));
    const encode = time(() => encodeSnapshot(g, false));
    const clone = time(() => {
      const { snap, transfer } = encodeSnapshot(g, false);
      structuredClone(snap, { transfer });
    });
    const total = time(() => {
      mirror = roundTrip(s, mirror, false);
    });
    const { snap } = encodeSnapshot(g, false);
    const { ships, pirates, asteroids, hangars, ...focus } = snap.focus;
    const objects = serialize({ global: snap.global, focus, hangars: hangars.length }).length;
    const buffers =
      ships.byteLength +
      pirates.byteLength +
      asteroids.byteLength +
      hangars.reduce((n, h) => n + h.items.byteLength, 0);
    console.log(
      [
        `UI state at ${s.ships.length} ships, ${s.asteroids.length} asteroids, ${s.pirates.length} pirates:`,
        `  before: structuredClone(GameState) ${full.toFixed(3)} ms, ${serialize(g).length} B`,
        `  after:  encode ${encode.toFixed(3)} ms, encode+clone ${clone.toFixed(3)} ms, ` +
          `encode+clone+apply ${total.toFixed(3)} ms`,
        `          ${objects} B of objects cloned + ${buffers} B in transferred buffers`,
      ].join('\n'),
    );
    expect(objects).toBeLessThan(serialize(g).length / 10);
  });
});
