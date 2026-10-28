// @vitest-environment happy-dom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerHotkeys, listHotkeys } from './hotkeys';
import { Modal } from './Modal';
import { stepSpeed } from './App';

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );

const roots: { unmount: () => Promise<void> }[] = [];
async function mount(ui: ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(ui));
  const handle = {
    unmount: () =>
      act(async () => {
        root.unmount();
      }),
  };
  roots.push(handle);
  return handle;
}

const offs: (() => void)[] = [];
afterEach(async () => {
  offs.splice(0).forEach((f) => f());
  await Promise.all(roots.splice(0).map((r) => r.unmount()));
});

describe('hotkey registry', () => {
  it('lets an open modal take Escape before the focus clear', async () => {
    const clear = vi.fn<() => void>();
    const close = vi.fn<() => void>();
    offs.push(registerHotkeys([{ keys: ['Escape'], run: clear }]));
    const modal = await mount(
      <Modal title="T" onClose={close}>
        x
      </Modal>,
    );
    press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    await modal.unmount();
    press('Escape');
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('only closes the topmost of stacked modals', async () => {
    const a = vi.fn<() => void>();
    const b = vi.fn<() => void>();
    await mount(
      <Modal title="A" onClose={a}>
        x
      </Modal>,
    );
    await mount(
      <Modal title="B" onClose={b}>
        x
      </Modal>,
    );
    press('Escape');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('falls through when a binding declines, and ignores modifiers and inputs', () => {
    const low = vi.fn<() => void>();
    offs.push(
      registerHotkeys([
        { keys: ['x'], priority: 5, run: () => false },
        { keys: ['x'], run: low },
      ]),
    );
    press('x');
    expect(low).toHaveBeenCalledTimes(1);
    press('x', { ctrlKey: true });
    const input = document.createElement('input');
    document.body.append(input);
    press('x', {}, input);
    input.remove();
    expect(low).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a held key (#188)', () => {
    const run = vi.fn<() => void>();
    offs.push(registerHotkeys([{ keys: [' '], run }]));
    press(' ', { repeat: true });
    expect(run).not.toHaveBeenCalled();
    press(' ');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('lists labelled bindings once', () => {
    offs.push(
      registerHotkeys([
        { keys: ['q'], label: 'Q', description: 'Quit', run: () => {} },
        { keys: ['w'], run: () => {} },
      ]),
    );
    expect(listHotkeys()).toEqual([{ group: 'General', label: 'Q', description: 'Quit' }]);
  });

  it('steps speed within 1×–4×', () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(4, 1)).toBe(4);
    expect(stepSpeed(1, -1)).toBe(1);
    expect(stepSpeed(4, -1)).toBe(2);
  });
});
