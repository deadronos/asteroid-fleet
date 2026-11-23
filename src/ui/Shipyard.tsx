import { engine, useGame } from '../game/engine';
import { HULLS, REFIT_COST } from '../sim/config';
import { hasShipyard } from '../sim/shipyard';
import { deepEqual } from './equal';
import { fmt } from './format';

export function Shipyard() {
  const y = useGame(
    (s) => ({
      hasYard: hasShipyard(s),
      hullClass: s.carrier.hullClass,
      hulls: [...s.hulls],
      canAfford: s.credits >= REFIT_COST,
      warping: !!s.warp,
    }),
    deepEqual,
  );
  return (
    <>
      <h3>Shipyard</h3>
      {y.hasYard ? (
        <>
          <p className="hint">
            Change hull for {fmt(REFIT_COST)} cr. Ships that no longer fit move to free space or are
            sold back at half price.
          </p>
          <div className="row">
            {y.hulls.map((id) => (
              <button
                key={id}
                className={id === y.hullClass ? 'on' : ''}
                disabled={id === y.hullClass || !y.canAfford || y.warping}
                title={HULLS[id].blurb}
                onClick={() => engine.dispatch({ type: 'refit', hull: id })}
              >
                {HULLS[id].name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="hint">Refit needs a shipyard: return to a starter system.</p>
      )}
    </>
  );
}
