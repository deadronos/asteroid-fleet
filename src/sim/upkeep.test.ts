import { describe, expect, it } from 'vitest';
import { settleOffline } from './actions';
import { DT, HANGAR_UPKEEP, SHIP_UPKEEP } from './config';
import { buildCtx } from './ctx';
import { hangarUpkeep, solarRate, upkeep, upkeepRate, stateOf } from './state';
import { stepSim } from './tick';
import type { Sim } from './types';
import { power } from './world';
import { game } from './testing';

/** A calm game with every ship docked, no ore to refine and the carrier holding still. */
function calm(seed = 5): Sim {
  const s = game(seed);
  for (const x of s.ships) x.mode = 'docked';
  s.carrier.stance = 'hold';
  s.carrier.ore = 0;
  s.carrier.oreValue = 0;
  s.carrier.shield = 1;
  s.storm.active = 0;
  return s;
}

/** Make solar exactly `rate` energy/s in the current system. */
function setSolar(s: Sim, rate: number) {
  const sys = s.systems[s.systemId];
  sys.brightness = 1;
  sys.brightness = rate / solarRate(s);
}

describe('power upkeep', () => {
  it('charges hangars on a rising curve and launched ships by class; docked ships are free', () => {
    const s = calm();
    expect(HANGAR_UPKEEP(4)).toBeGreaterThan(HANGAR_UPKEEP(3));
    expect(SHIP_UPKEEP.barge).toBeGreaterThan(SHIP_UPKEEP.drone);
    const docked = upkeepRate(s);
    expect(docked).toBeCloseTo(hangarUpkeep(s.hangars.length));

    const drone = s.ships.find((x) => x.cls === 'drone')!;
    drone.mode = 'idle';
    expect(upkeepRate(s)).toBeCloseTo(docked + SHIP_UPKEEP.drone);
    const u = upkeep(s);
    expect(u.launched.drone).toBe(1);
    expect(u.total).toBeCloseTo(upkeepRate(s));
    expect(u.hangarRate).toBeCloseTo(docked);
  });

  it('drains the pool by the upkeep every tick', () => {
    const s = calm();
    s.carrier.energy = 500;
    setSolar(s, 6);
    for (const x of s.ships) x.mode = 'idle';
    const net = 6 - upkeepRate(s);
    power(s, DT, buildCtx(s));
    expect(s.carrier.energy).toBeCloseTo(500 + net * DT);
  });

  it('never goes below zero: unpaid upkeep is waived and solar keeps trickling', () => {
    const s = calm();
    for (const x of s.ships) x.mode = 'idle';
    setSolar(s, upkeepRate(s) / 2);
    s.carrier.energy = 0;
    s.carrier.shield = 0.5;
    const ctx = buildCtx(s);
    power(s, DT, ctx);
    expect(ctx.powerShort).toBe(true);
    expect(s.carrier.energy).toBe(0);
    expect(s.carrier.shield).toBe(0.5); // shields stay down

    // Once solar outpaces upkeep the pool recovers on its own.
    setSolar(s, upkeepRate(s) * 2);
    power(s, DT, ctx);
    expect(ctx.powerShort).toBe(false);
    expect(s.carrier.energy).toBeGreaterThan(0);
  });

  it('holds launches and docks ships between jobs while the pool is short', () => {
    const s = calm();
    setSolar(s, 0);
    s.carrier.energy = 0;
    const idle = s.ships.find((x) => x.cls === 'drone')!;
    idle.mode = 'idle';
    idle.cargo = 0;
    idle.pos = { ...s.carrier.pos };
    for (const h of s.hangars) h.launchTimer = 0;
    const dockedBefore = s.ships.filter((x) => x.mode === 'docked').length;
    stepSim(s);
    // No launches, and the idle drone headed home and docked.
    expect(idle.mode).toBe('docked');
    expect(s.ships.filter((x) => x.mode === 'docked').length).toBe(dockedBefore + 1);
    expect(s.carrier.energy).toBe(0);

    // With power back, the hangars launch again.
    setSolar(s, 6);
    for (let i = 0; i < 20; i++) stepSim(s);
    expect(s.ships.some((x) => x.mode !== 'docked')).toBe(true);
  });

  it('settles offline energy as solar minus upkeep, floored at zero', () => {
    const s = calm();
    for (const x of s.ships) x.mode = 'idle';
    s.carrier.energy = 100;
    setSolar(s, upkeepRate(s) + 0.1);
    settleOffline(stateOf(s), 600);
    expect(s.carrier.energy).toBeCloseTo(100 + 0.1 * 600);

    const t = calm();
    for (const x of t.ships) x.mode = 'idle';
    t.carrier.energy = 100;
    setSolar(t, 0);
    settleOffline(stateOf(t), 3600);
    expect(t.carrier.energy).toBe(0);
  });
});
