import { useEffect } from 'react';
import { engine, useGame } from '../game/engine';
import { carrierChoices } from './inbox';
import { carrierForKey, ignoresHotkey } from './carriers';
import { fmt } from './format';

/** Carrier tabs, hotkeys 1–9 and the cut that hides a swap. Hidden with a single carrier. */
export function CarrierBar() {
  const s = useGame();
  const carriers = engine.carriers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoresHotkey(e)) return;
      const id = carrierForKey(e.key, engine.carriers);
      if (id !== null) engine.focusCarrier(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (carriers.length < 2) return null;
  const labels = carrierChoices(carriers, s.systems);
  return (
    <>
      <nav className="carrier-bar" aria-label="Carriers">
        {carriers.map((c, i) => {
          const on = c.id === engine.focusedCarrierId;
          const badge = engine.unseen.get(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={on ? 'on' : ''}
              aria-pressed={on}
              onClick={() => engine.focusCarrier(c.id)}
            >
              <span className="k">{i < 9 ? i + 1 : ''}</span> {labels[i].label}
              <span className="sub">
                {' '}
                hull {Math.round(c.hull * 100)}% · energy {Math.floor(c.energy)} ·{' '}
                {c.income >= 0 ? '+' : ''}
                {fmt(c.income)}/s
              </span>
              {badge && (
                <b
                  className={`badge sev-${badge.severity}`}
                  aria-label={`${badge.count} new events`}
                >
                  {badge.count}
                </b>
              )}
            </button>
          );
        })}
      </nav>
      {/* Remounting restarts the animation on every switch. */}
      {engine.cuts > 0 && <div key={engine.cuts} className="warp-cut" aria-hidden="true" />}
    </>
  );
}
