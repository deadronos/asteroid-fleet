import { useState } from 'react';
import { useGame } from '../game/engine';
import { goals } from '../sim/goals';
import { deepEqual } from './equal';

const KEY = 'af-goals-dismissed';

function isDismissed() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function dismiss() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}

export function Goals() {
  const list = useGame((s) => goals(s), deepEqual);
  const [hidden, setHidden] = useState(() => isDismissed());
  if (hidden || list.every((g) => g.done)) return null;
  return (
    <aside className="goals" aria-label="First goals">
      <div className="row">
        <b className="grow">First goals</b>
        <button
          aria-label="Dismiss goals"
          onClick={() => {
            dismiss();
            setHidden(true);
          }}
        >
          ×
        </button>
      </div>
      <ul>
        {list.map((g) => (
          <li key={g.id} className={g.done ? 'done' : ''} title={g.hint}>
            {g.done ? '✓' : '○'} {g.label}
          </li>
        ))}
      </ul>
      <p className="hint">{list.find((g) => !g.done)?.hint}</p>
    </aside>
  );
}
