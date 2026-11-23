import { engine, useGame } from '../game/engine';
import { shipCost } from '../sim/costs';
import { SHIP_STATS } from '../sim/config';
import { SHIP_CLASSES } from '../sim/types';
import { deepEqual } from './equal';
import { fmt } from './format';
import { countByClass, UNLOCK_HINT } from './fleetBoard';

/** Per-class buy buttons for the selected hangar (#250). */
export function ShipShop({ hangarId }: { hangarId: number }) {
  const shop = useGame((s) => {
    const counts = countByClass(s.ships);
    return SHIP_CLASSES.map((c) => {
      const cost = shipCost(s, c);
      return {
        cls: c,
        unlocked: s.unlocked.includes(c),
        cost,
        affordable: s.credits >= cost,
        count: counts[c],
      };
    });
  }, deepEqual);
  return (
    <div className="shop">
      {shop.map(({ cls: c, unlocked, cost, affordable, count }) => {
        const st = SHIP_STATS[c];
        return (
          <button
            key={c}
            disabled={!unlocked || !affordable}
            onClick={() => engine.dispatch({ type: 'buyShip', cls: c, hangarId })}
            title={
              !unlocked
                ? (UNLOCK_HINT[c] ?? 'Locked')
                : !affordable
                  ? `Need ${Math.ceil(cost)} credits`
                  : st.role
            }
          >
            <span>
              <i className="swatch" style={{ background: st.color }} />
              {st.name}
            </span>
            <span className="meta">
              {unlocked ? (
                <>
                  <span className="cost">{fmt(cost)} cr</span> · {st.slots} slot
                  {st.slots > 1 ? 's' : ''} · ×{count}
                </>
              ) : (
                (UNLOCK_HINT[c] ?? 'Locked')
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
