// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Hud } from './Hud';
import { engine } from '../game/engine';
import { newGame } from '../sim/state';

describe('Hud cargo heat', () => {
  it('shows a safe zone instead of a multiplier in tier-1 systems', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    engine.state = newGame(1);
    const s = engine.state;
    expect(s.systems[engine.view.systemId].tier).toBe(1);
    await act(async () =>
      root.render(
        <Hud
          tactical={false}
          autoTactical={false}
          quality="high"
          onTactical={() => {}}
          onQuality={() => {}}
          onMap={() => {}}
        />,
      ),
    );
    expect(el.textContent).toContain('Safe zone');
    expect(el.textContent).not.toMatch(/×\d\.\d\d/);
    await act(async () => root.unmount());
  });

  it('shows pause and speed even when nothing in the sim changes', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    engine.state = newGame(1);
    engine.paused = false;
    engine.speed = 1;
    await act(async () =>
      root.render(
        <Hud
          tactical={false}
          autoTactical={false}
          quality="high"
          onTactical={() => {}}
          onQuality={() => {}}
          onMap={() => {}}
        />,
      ),
    );
    const pause = el.querySelector<HTMLElement>('[title="Pause (Space)"]')!;
    expect(pause.textContent).toBe('❚❚');
    // A paused sim sends nothing new, so these must re-render on their own.
    await act(async () => engine.togglePause());
    expect(pause.textContent).toBe('▶');
    await act(async () => engine.togglePause());
    await act(async () => engine.setSpeed(4));
    const on = [...el.querySelectorAll('.controls button.on')].map((b) => b.textContent);
    expect(on).toEqual(['4×']);
    await act(async () => root.unmount());
  });
});
