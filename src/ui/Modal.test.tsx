// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { registerHotkeys } from './hotkeys';
import { Modal } from './Modal';
import { vi } from 'vitest';

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="opener" onClick={() => setOpen(true)}>
        open
      </button>
      {open && (
        <Modal title="Test" onClose={() => setOpen(false)}>
          <button id="a">a</button>
          <button id="b">b</button>
        </Modal>
      )}
    </>
  );
}

const fire = (t: HTMLElement, type: string) =>
  act(async () => void t.dispatchEvent(new MouseEvent(type, { bubbles: true })));

const key = (k: string, shiftKey = false) =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
  });

describe('Modal', () => {
  it('blocks background hotkeys while open', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const bg = vi.fn<() => void>();
    const off = registerHotkeys([{ keys: [' ', 't', '?'], run: bg }]);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () =>
      root.render(
        <Modal title="T" onClose={() => {}}>
          x
        </Modal>,
      ),
    );
    for (const k of [' ', 't', '?'])
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    expect(bg).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }),
    );
    expect(bg).toHaveBeenCalledTimes(1);
    off();
    el.remove();
  });

  it('only the topmost of stacked modals traps Tab', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () =>
      root.render(
        <>
          <Modal title="Under" onClose={() => {}}>
            <button id="u1">u1</button>
            <button id="u2">u2</button>
          </Modal>
          <Modal title="Top" onClose={() => {}}>
            <button id="t1">t1</button>
            <button id="t2">t2</button>
          </Modal>
        </>,
      ),
    );
    const t2 = el.querySelector<HTMLElement>('#t2')!;
    t2.focus();
    await key('Tab'); // wraps to the top dialog's close button, not the lower dialog's
    const top = el.querySelectorAll('[role="dialog"]')[1];
    expect(top.contains(document.activeElement)).toBe(true);
    await act(async () => root.unmount());
    el.remove();
  });

  it('closes on the backdrop only when mousedown and click both hit it', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let closed = 0;
    await act(async () =>
      root.render(
        <Modal title="T" onClose={() => closed++}>
          <button>x</button>
        </Modal>,
      ),
    );
    const bg = el.querySelector<HTMLElement>('.modal-bg')!;
    const dialog = el.querySelector<HTMLElement>('[role="dialog"]')!;
    await fire(dialog, 'mousedown');
    await fire(bg, 'click');
    expect(closed).toBe(0);
    await fire(bg, 'mousedown');
    await fire(dialog, 'mouseup');
    await fire(bg, 'click');
    expect(closed).toBe(0);
    await fire(bg, 'mousedown');
    await fire(bg, 'mouseup');
    await fire(bg, 'click');
    expect(closed).toBe(1);
    await act(async () => root.unmount());
    el.remove();
  });

  it('is an aria-modal dialog, traps Tab, closes on Escape and restores focus', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<Host />));
    const opener = el.querySelector<HTMLElement>('#opener')!;
    opener.focus();
    await act(async () => opener.click());

    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('Test');

    const close = el.querySelector<HTMLElement>('button[aria-label="Close dialog"]')!;
    const b = el.querySelector<HTMLElement>('#b')!;
    expect(document.activeElement).toBe(close);
    b.focus();
    await key('Tab');
    expect(document.activeElement).toBe(close);
    await key('Tab', true);
    expect(document.activeElement).toBe(b);

    await key('Escape');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    await act(async () => root.unmount());
    el.remove();
  });
});
