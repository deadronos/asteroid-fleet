import { engine, useGame } from '../game/engine';
import { HULLS, REFIT_COST } from '../sim/config';
import { hasShipyard } from '../sim/shipyard';
import { fmt } from './format';

export function Shipyard() {
  const s = useGame();
  return (
    <>
      <h3>Shipyard</h3>
      {hasShipyard(s) ? (
        <>
          <p className="hint">
            Change hull for {fmt(REFIT_COST)} cr. Ships that no longer fit move to free space or are
            sold back at half price.
          </p>
          <div className="row">
            {s.hulls.map((id) => (
              <button
                key={id}
                className={id === s.carrier.hullClass ? 'on' : ''}
                disabled={id === s.carrier.hullClass || s.credits < REFIT_COST || !!s.warp}
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
