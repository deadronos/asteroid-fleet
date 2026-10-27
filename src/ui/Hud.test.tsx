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
});
