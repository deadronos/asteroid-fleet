// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { engine, useGame } from '../game/engine';
import { newGame } from '../sim/state';
import { countByClass } from './FleetPanel';
import { deepEqual, shallowEqual } from './equal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useGame selector', () => {
  it('re-renders only when the selected value changes', async () => {
    const previous = engine.state;
    engine.state = newGame(1);
    let renders = 0;
    function Probe() {
      const credits = useGame((s) => Math.floor(s.credits));
      renders++;
      return <span>{credits}</span>;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Probe />));
      const base = renders;
      // Unrelated change: a tick that leaves credits alone.
      await act(async () => {
        engine.view.carrier.energy += 1;
        engine.emit();
      });
      expect(renders).toBe(base);
      await act(async () => {
        engine.view.credits += 5;
        engine.emit();
      });
      expect(renders).toBe(base + 1);
      expect(el.textContent).toBe(String(Math.floor(engine.view.credits)));
    } finally {
      await act(async () => root.unmount());
      el.remove();
      engine.state = previous;
    }
  });

  it('keeps a derived object stable under a structural equals', async () => {
    const previous = engine.state;
    engine.state = newGame(1);
    let renders = 0;
    function Probe() {
      const v = useGame((s) => ({ n: s.ships.length }), shallowEqual);
      renders++;
      return <span>{v.n}</span>;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Probe />));
      const base = renders;
      await act(async () => engine.emit());
      expect(renders).toBe(base);
    } finally {
      await act(async () => root.unmount());
      el.remove();
      engine.state = previous;
    }
  });
});

describe('countByClass', () => {
  it('counts every class in one pass, zero included', () => {
    const c = countByClass([{ cls: 'drone' }, { cls: 'drone' }, { cls: 'barge' }]);
    expect(c.drone).toBe(2);
    expect(c.barge).toBe(1);
    expect(c.hauler).toBe(0);
  });
});

describe('equality helpers', () => {
  it('shallowEqual compares one level', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: [1] }, { a: [1] })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
  it('deepEqual compares plain data', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual({ a: [1] }, { a: [2] })).toBe(false);
  });
});
