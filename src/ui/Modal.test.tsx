// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal';

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

const key = (k: string, shiftKey = false) =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
  });

describe('Modal', () => {
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
