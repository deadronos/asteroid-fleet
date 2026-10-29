import { serialize } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { stressGame } from '../sim/stress';
import { stateOf } from '../sim/state';
import { stepSim } from '../sim/tick';
import type { GameState, Ship, Sim } from '../sim/types';
import { OTHER_ROW, applySnapshot, encodeSnapshot } from './snapshot';

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
  it('lists other carriers in the focused system only', () => {
    const s = busyGame();
    const g = stateOf(s);
    const near = structuredClone(g.ops[0]);
    near.id = 91;
    const far = structuredClone(g.ops[0]);
    far.id = 92;
    far.systemId = g.ops[0].systemId + 1;
    g.ops.push(near, far);
    const { snap } = encodeSnapshot(g, false);
    expect(snap.others.map((o) => o.id)).toEqual([91]);
    expect(snap.others[0].pos).toEqual(near.carrier.pos);
    const live = near.ships.filter((x) => x.mode !== 'docked');
    const rows = snap.others[0].ships;
    expect(rows.length).toBe(live.length * OTHER_ROW);
    // Rows carry the ship id, so interpolation can pair each ship with itself.
    expect(Array.from({ length: live.length }, (_, i) => rows[i * OTHER_ROW])).toEqual(
      live.map((x) => x.id),
    );
  });

  it('lists every carrier with its hangar ids (#178)', () => {
    const g = stateOf(busyGame());
    const copy = structuredClone(g.ops[0]);
    copy.id = 91;
    g.ops.push(copy);
    const { snap } = encodeSnapshot(g, false);
    expect(snap.carriers.map((c) => [c.id, c.hangars])).toEqual(
      g.ops.map((op) => [op.id, op.hangars.map((h) => h.id)]),
    );
  });

  it('rebuilds the exact sim state', () => {
    const s = busyGame();
    expect(s.ships.some((x) => x.station)).toBe(true);
    expect(s.ships.some((x) => x.mode === 'carried')).toBe(true);
    expect(s.ships.some((x) => x.hold)).toBe(true);
    expect(Object.keys(s.fields).length).toBeGreaterThan(0);
    expect(roundTrip(s, null)).toEqual(expected(s, []));
  });

  it('round-trips every Ship key, optional ones included', () => {
    const s = busyGame();
    // `Required<Ship>` makes a new Ship field a type error here until it is set below.
    const full: Required<Ship> = {
      id: 987654,
      cls: 'drone',
      hangarId: s.hangars[0].id,
      mode: 'toBarge',
      pos: { x: 1.5, y: -2.5, z: 3.5 },
      hull: 12.25,
      cargo: 4,
      cargoValue: 88.5,
      h2: 3.75,
      targetId: 17,
      escortId: 18,
      station: { x: 7, y: 8, z: 9 },
      bargeId: 19,
      fireCooldown: 0.625,
      modules: ['drill'],
      hold: { card: 2, until: s.time + 9.5 },
      idleUntil: s.time + 6.25,
    };
    s.ships.push(full);
    const bare = s.ships.find((x) => x.idleUntil === undefined && x.hold === undefined)!;
    const out = roundTrip(s, null).ops[0].ships;
    const got = out.find((x) => x.id === full.id)!;
    expect(Object.keys(got).sort()).toEqual(Object.keys(full).sort());
    for (const k of Object.keys(full) as (keyof Ship)[])
      expect({ [k]: got[k] }).toEqual({ [k]: full[k] });
    // Absent optional keys stay absent, not undefined or NaN.
    expect('idleUntil' in out.find((x) => x.id === bare.id)!).toBe(false);
  });

  it('keeps the drone cover backoff (#187)', () => {
    const s = busyGame();
    const drone = s.ships.find((x) => x.cls === 'drone')!;
    drone.idleUntil = s.time + 4;
    const prev = roundTrip(s, null);
    expect(prev.ops[0].ships.find((x) => x.id === drone.id)!.idleUntil).toBe(drone.idleUntil);
    // An expired backoff cleared in the sim must clear on the reused mirror ship too.
    delete drone.idleUntil;
    const next = roundTrip(s, prev, false);
    expect('idleUntil' in next.ops[0].ships.find((x) => x.id === drone.id)!).toBe(false);
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
