// Fleet panel shell: selects a hangar and composes the shop, boards and detail.
// The pieces live in their own files so board and module rules can be read apart (#250).

import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { autoBuyUnlocked, autoRebuildUnlocked } from '../sim/automation';
import { HANGAR_TYPES, HANGAR_UPKEEP, NEW_HANGAR_COST, hangarLocked } from '../sim/config';
import { focus } from '../render/focus';
import type { HangarType, Sim } from '../sim/types';
import { deepEqual, shallowEqual } from './equal';
import { fmt } from './format';
import { Goals } from './Goals';
import { HangarBoard } from './HangarBoard';
import { ShipDetail } from './ShipDetail';
import { ShipShop } from './ShipShop';

export { countByClass } from './fleetBoard';

const setAutomation = (
  patch: Partial<Pick<Sim['automation'], 'autoBuy' | 'autoRebuild' | 'creditFloor'>>,
) => engine.dispatch({ type: 'setAutomation', patch });

function AutomationBar() {
  const v = useGame((s) => {
    const rebuild = autoRebuildUnlocked(s);
    const buy = autoBuyUnlocked(s);
    if (!rebuild && !buy) return null;
    return {
      rebuild,
      buy,
      autoRebuild: s.automation.autoRebuild,
      autoBuy: s.automation.autoBuy,
      creditFloor: s.automation.creditFloor,
      queued: s.rebuildQueue.length,
    };
  }, shallowEqual);
  if (!v) return null;
  return (
    <div className="row automation">
      {v.rebuild && (
        <label title="Pay to rebuild lost ships into their hangar">
          <input
            type="checkbox"
            checked={v.autoRebuild}
            onChange={(e) => setAutomation({ autoRebuild: e.target.checked })}
          />
          Auto-rebuild{v.queued > 0 ? ` (${v.queued} queued)` : ''}
        </label>
      )}
      {v.buy && (
        <label title="Buy toward each hangar's target with spare credits">
          <input
            type="checkbox"
            checked={v.autoBuy}
            onChange={(e) => setAutomation({ autoBuy: e.target.checked })}
          />
          Auto-buy
        </label>
      )}
      <label title="Automation never spends credits below this">
        Credit floor
        <input
          type="number"
          min={0}
          step={100}
          value={v.creditFloor}
          aria-label="Credit floor"
          style={{ width: '6em' }}
          onChange={(e) => setAutomation({ creditFloor: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

export function FleetPanel() {
  const [picked, setPicked] = useState(() => engine.view.hangars[0]?.id ?? 1);
  const [selShip, setSelShip] = useState(-1);
  // Hangar boards and the shop subscribe themselves; this only needs the list shape.
  const f = useGame(
    (s) => ({
      ids: s.hangars.map((h) => h.id),
      hasSel: s.hangars.map((h) => h.items.some((it) => it.shipId === selShip)),
      canAfford: s.credits >= NEW_HANGAR_COST(s.hangars.length),
      furthestTier: s.stats.furthestTier,
    }),
    deepEqual,
  );
  const hangarCount = f.ids.length;
  // After a carrier switch the picked id belongs to the old carrier; fall back to the first hangar.
  const sel = f.ids.includes(picked) ? picked : (f.ids[0] ?? picked);
  return (
    <>
      <Goals />
      <h3>Shipyard · builds into Hangar {sel}</h3>
      <ShipShop hangarId={sel} />
      <h3>Hangars</h3>
      <AutomationBar />
      <p className="hint">
        Hangar slots are the board. Drag, tap or press Enter on a ship, then an empty slot, to move
        it; Escape cancels. Put a repair drone next to fighters or barges and they repair 3× faster
        when docked. Click a hangar to build into it, click a docked ship to fit modules.
      </p>
      {f.ids.map((id, i) => (
        <div key={id}>
          <HangarBoard
            hangarId={id}
            selected={sel === id}
            onSelect={() => setPicked(id)}
            selShip={selShip}
            onShip={(id) => {
              const next = id < 0 || id === selShip ? -1 : id;
              setSelShip(next);
              focus.set(next < 0 ? null : next);
            }}
          />
          {selShip >= 0 && f.hasSel[i] && <ShipDetail id={selShip} />}
        </div>
      ))}
      <>
        <h3>
          New hangar · {fmt(NEW_HANGAR_COST(hangarCount))} cr · upkeep{' '}
          {HANGAR_UPKEEP(hangarCount).toFixed(2)} energy/s
        </h3>
        <div className="row">
          {(Object.keys(HANGAR_TYPES) as HangarType[]).map((t) => (
            <button
              key={t}
              disabled={!f.canAfford || !!hangarLocked(t, f.furthestTier)}
              onClick={() => engine.dispatch({ type: 'buyHangar', hangarType: t })}
              title={hangarLocked(t, f.furthestTier) ?? HANGAR_TYPES[t].blurb}
            >
              {HANGAR_TYPES[t].name}
            </button>
          ))}
        </div>
      </>
    </>
  );
}
