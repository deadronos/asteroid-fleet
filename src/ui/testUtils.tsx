import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { engine } from '../game/engine';
import type { GameState } from '../sim/types';

/** Render a component against `state` as the engine's mirror; `cleanup` restores everything. */
export async function mount(ui: ReactElement, state: GameState) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const previous = engine.state;
  engine.state = state;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(ui));
  return {
    el,
    button: (re: RegExp) =>
      [...el.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')),
    cleanup: async () => {
      await act(async () => root.unmount());
      el.remove();
      engine.state = previous;
    },
  };
}

export const click = (b: HTMLElement) => act(async () => b.click());
