// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { engine } from '../game/engine';
import { encodeSnapshot } from '../game/snapshot';
import { apply } from '../sim/actions';
import { newGame } from '../sim/state';
import { CarrierBar } from './CarrierBar';
import { mount } from './testUtils';

let cleanup: (() => Promise<void>) | null = null;
const savedCarriers = engine.carriers;
const savedCuts = engine.cuts;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  engine.carriers = savedCarriers;
  engine.cuts = savedCuts;
});

describe('CarrierBar and .warp-cut (#224)', () => {
  it('renders .warp-cut with a single carrier while hiding the carrier tabs', async () => {
    const g = newGame(1);
    engine.carriers = encodeSnapshot(g, false).snap.carriers;
    expect(engine.carriers).toHaveLength(1);
    engine.cuts = 0;
    const m = await mount(<CarrierBar />, g);
    cleanup = m.cleanup;
    expect(m.el.querySelector('.carrier-bar')).toBeNull();
    expect(m.el.querySelector('.warp-cut')).toBeNull();

    await act(async () => {
      engine.cuts = 1;
      engine.emit();
    });
    expect(m.el.querySelector('.carrier-bar')).toBeNull();
    expect(m.el.querySelector('.warp-cut')).not.toBeNull();
  });

  it('renders carrier tabs alongside .warp-cut with multiple carriers', async () => {
    const g = newGame(2);
    g.lifetime.admiralties = 3;
    g.credits = 1e7;
    expect(apply(g, { type: 'buyCarrier', carrierId: g.ops[0].id })).toBeNull();
    engine.carriers = encodeSnapshot(g, false).snap.carriers;
    expect(engine.carriers.length).toBeGreaterThanOrEqual(2);
    engine.cuts = 2;
    const m = await mount(<CarrierBar />, g);
    cleanup = m.cleanup;
    expect(m.el.querySelectorAll('.carrier-bar button')).toHaveLength(2);
    expect(m.el.querySelector('.warp-cut')).not.toBeNull();
  });
});
