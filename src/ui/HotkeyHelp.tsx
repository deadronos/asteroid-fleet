import { useSyncExternalStore } from 'react';
import { Modal } from './Modal';
import { MODAL_PRIORITY, listHotkeys, subscribeHotkeys, useHotkeys } from './hotkeys';

let cache: ReturnType<typeof listHotkeys> = [];
const snapshot = () => {
  const next = listHotkeys();
  if (JSON.stringify(next) !== JSON.stringify(cache)) cache = next;
  return cache;
};

/** Shortcut list generated from whatever is registered right now. */
export function HotkeyHelp({ onClose }: { onClose: () => void }) {
  // `?` toggles this overlay; every other background key is blocked while it is open.
  useHotkeys([{ keys: ['?'], priority: MODAL_PRIORITY, run: () => onClose() }]);
  const list = useSyncExternalStore(subscribeHotkeys, snapshot);
  const groups = [...new Set(list.map((h) => h.group))];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {groups.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <dl className="hotkeys">
            {list
              .filter((h) => h.group === g)
              .map((h) => (
                <div key={h.label}>
                  <dt>
                    <kbd>{h.label}</kbd>
                  </dt>
                  <dd>{h.description}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
      <button onClick={onClose}>Close</button>
    </Modal>
  );
}
