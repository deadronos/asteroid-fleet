import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MODAL_PRIORITY, isTopModal, pushModal, useHotkeys } from './hotkeys';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog shell: role=dialog + aria-modal, labelled by its title, traps Tab, closes on
 * Escape or backdrop click, and returns focus to whatever opened it.
 */
export function Modal({
  title,
  onClose,
  className = '',
  children,
}: {
  /** Rendered as the heading and used as the dialog's accessible name. */
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef({ down: false, up: false });
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape goes through the registry so the topmost modal closes first and nothing below sees it.
  useHotkeys([
    {
      keys: ['Escape'],
      priority: MODAL_PRIORITY,
      allowInInput: true,
      run: (e) => {
        // Escape belongs to an open <select>; swallow it so it doesn't fall through to the camera.
        if ((e.target as Element | null)?.closest?.('select')) return;
        onCloseRef.current();
      },
    },
  ]);

  // Join and leave the modal stack in the same commit that adds and removes the dialog, so a key
  // pressed right after it closes isn't still blocked by a passive effect that hasn't run yet.
  const [id] = useState(() => Symbol('modal'));
  useLayoutEffect(() => pushModal(id), [id]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const items = () => Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (items()[0] ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !node || !isTopModal(id)) return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // The opener may have unmounted (Settings -> Help); fall back to the app root.
      (opener?.isConnected ? opener : document.getElementById('app-root'))?.focus();
    };
  }, [id]);

  return (
    <div
      className="modal-bg"
      onMouseDown={(e) => (press.current = { down: e.target === e.currentTarget, up: false })}
      onMouseUp={(e) => (press.current.up = e.target === e.currentTarget)}
      onClick={(e) => {
        // A drag between dialog and backdrop (either way) is not a backdrop click.
        if (e.target === e.currentTarget && press.current.down && press.current.up) onClose();
        press.current = { down: false, up: false };
      }}
    >
      <div
        ref={ref}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="settings-head">
          <h2 id={titleId}>{title}</h2>
          <button onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
