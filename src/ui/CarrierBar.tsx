import { engine, useGame } from '../game/engine';
import { carrierChoices } from './inbox';
import { carrierForKey } from './carriers';
import { useHotkeys } from './hotkeys';
import { fmt } from './format';
import { deepEqual } from './equal';

/** Carrier switcher tabs and hotkeys 1–9; hidden with a single carrier. */
function CarrierTabs() {
  // Rows hold only what is drawn, so an idle tick that changes nothing visible skips the render.
  const rows = useGame((s) => {
    const carriers = engine.carriers;
    if (carriers.length < 2) return null;
    const labels = carrierChoices(carriers, s.systems);
    return carriers.map((c, i) => {
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
    });
  }, deepEqual);

  useHotkeys([
    {
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      label: '1–9',
      description: 'Select carrier',
      group: 'Fleet',
      run: (e) => {
        const id = carrierForKey(e.key, engine.carriers);
        if (id === null) return false;
        engine.focusCarrier(id);
      },
    },
  ]);

  if (!rows) return null;
  return (
    <nav className="carrier-bar" aria-label="Carriers">
      {rows.map((c, i) => {
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
              <b className={`badge sev-${badge.severity}`} aria-label={`${badge.count} new events`}>
                {badge.count}
              </b>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** Screen-flash cut on carrier switch or warp jump; renders regardless of carrier count (#224). */
function WarpCut() {
  const cuts = useGame(() => engine.cuts);
  // Remounting restarts the animation on every cut.
  return cuts > 0 ? <div key={cuts} className="warp-cut" aria-hidden="true" /> : null;
}

/** Carrier tabs, hotkeys 1–9 and the cut that hides a swap or warp jump. */
export function CarrierBar() {
  return (
    <>
      <CarrierTabs />
      <WarpCut />
    </>
  );
}
