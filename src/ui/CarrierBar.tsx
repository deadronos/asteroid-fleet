import { useEffect } from 'react';
import { engine, useGame } from '../game/engine';
import { carrierChoices } from './inbox';
import { carrierForKey, ignoresHotkey } from './carriers';
import { fmt } from './format';
import { deepEqual } from './equal';

/** Carrier tabs, hotkeys 1–9 and the cut that hides a swap. Hidden with a single carrier. */
export function CarrierBar() {
  // Rows hold only what is drawn, so an idle tick that changes nothing visible skips the render.
  const bar = useGame((s) => {
    const carriers = engine.carriers;
    const labels = carrierChoices(carriers, s.systems);
    return {
      cuts: engine.cuts,
      rows: carriers.map((c, i) => {
        const badge = engine.unseen.get(c.id);
        return {
          id: c.id,
          label: labels[i].label,
          on: c.id === engine.focusedCarrierId,
          hull: Math.round(c.hull * 100),
          energy: Math.floor(c.energy),
          income: fmt(c.income),
          positive: c.income >= 0,
          badge: badge ? { severity: badge.severity, count: badge.count } : null,
        };
      }),
    };
  }, deepEqual);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoresHotkey(e)) return;
      const id = carrierForKey(e.key, engine.carriers);
      if (id !== null) engine.focusCarrier(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (bar.rows.length < 2) return null;
  return (
    <>
      <nav className="carrier-bar" aria-label="Carriers">
        {bar.rows.map((c, i) => {
          const { on, badge } = c;
          return (
            <button
              key={c.id}
              type="button"
              className={on ? 'on' : ''}
              aria-pressed={on}
              onClick={() => engine.focusCarrier(c.id)}
            >
              <span className="k">{i < 9 ? i + 1 : ''}</span> {c.label}
              <span className="sub">
                {' '}
                hull {c.hull}% · energy {c.energy} · {c.positive ? '+' : ''}
                {c.income}/s
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
      {bar.cuts > 0 && <div key={bar.cuts} className="warp-cut" aria-hidden="true" />}
    </>
  );
}
