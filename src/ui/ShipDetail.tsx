import { engine, useGame } from '../game/engine';
import { cargoCap } from '../sim/ctx';
import { MODULE_IDS, MODULE_SLOTS, MODULES, SHIP_STATS, moduleLocked } from '../sim/config';
import { effectiveStance, stanceSource } from '../sim/doctrine';
import { activeSynergies, occupancy } from '../sim/hangar';
import { maxHull } from '../sim/state';
import type { ModuleId, ShipClass } from '../sim/types';
import { deepEqual } from './equal';
import { modeLabel, shipIndex, SYNERGY_LABEL } from './fleetBoard';

function ModuleSlots({
  id,
  cls,
  docked,
  modules,
  furthestTier,
  affordable,
}: {
  id: number;
  cls: ShipClass;
  docked: boolean;
  modules: ModuleId[];
  furthestTier: number;
  affordable: boolean[];
}) {
  const slots = MODULE_SLOTS[cls];
  const fits = MODULE_IDS.filter((m) => MODULES[m].fits.includes(cls));
  return (
    <div className="row modules">
      <span className="blurb">Modules</span>
      {Array.from({ length: slots }, (_, slot) => {
        const cur = modules[slot] ?? '';
        return (
          <select
            key={slot}
            aria-label={`Module slot ${slot + 1}`}
            disabled={!docked}
            title={docked ? (cur ? MODULES[cur].desc : 'Empty slot') : 'Dock the ship to refit'}
            value={cur}
            onChange={(e) =>
              engine.dispatch({
                type: 'fitModule',
                shipId: id,
                slot,
                module: (e.target.value || null) as ModuleId | null,
              })
            }
          >
            <option value="">— empty —</option>
            {fits.map((m, idx) => {
              const locked = moduleLocked(m, cls, furthestTier);
              const poor = m !== cur && !affordable[idx];
              return (
                <option key={m} value={m} disabled={!!locked || poor}>
                  {MODULES[m].name} · {MODULES[m].desc}
                  {m === cur ? '' : locked ? ` (${locked})` : ` · ${MODULES[m].cost} cr`}
                </option>
              );
            })}
          </select>
        );
      })}
    </div>
  );
}

/** Selected ship: stance, hull/cargo readout, scrap and module refit (#250). */
export function ShipDetail({ id }: { id: number }) {
  const d = useGame((s) => {
    const ship = s.ships.find((x) => x.id === id);
    if (!ship) return null;
    const st = effectiveStance(s, ship);
    const fits = MODULE_IDS.filter((m) => MODULES[m].fits.includes(ship.cls));
    const byId = shipIndex(s);
    const hangar = s.hangars.find((x) => x.id === ship.hangarId);
    const syn = hangar
      ? [...new Set(activeSynergies(s, occupancy(s, hangar, byId), ship, byId).map((x) => x.kind))]
      : [];
    const template = s.loadouts[ship.cls];
    return {
      id: ship.id,
      cls: ship.cls,
      mode: modeLabel(ship),
      docked: ship.mode === 'docked',
      carried: ship.mode === 'carried',
      hull: Math.round(ship.hull),
      maxHull: Math.round(maxHull(s, ship.cls)),
      cap: Math.round(cargoCap(s, ship.cls, ship)),
      cargo: Math.round(ship.cls === 'harvester' ? ship.h2 : ship.cargo),
      engagement: st.engagement,
      underFire: st.underFire,
      retreatAt: Math.round(st.retreatAt * 100),
      mining: st.mining,
      srcEngagement: stanceSource(s, ship, 'engagement'),
      srcUnderFire: stanceSource(s, ship, 'underFire'),
      srcMining: stanceSource(s, ship, 'mining'),
      modules: [...ship.modules],
      synergy: syn.map((k) => SYNERGY_LABEL[k]).join(' · '),
      loadout: template ? template.map((m) => m ?? '—').join(' / ') || 'empty' : null,
      furthestTier: s.stats.furthestTier,
      affordable: fits.map((m) => s.credits >= MODULES[m].cost),
    };
  }, deepEqual);
  if (!d) return null;
  return (
    <div className="hangar" style={{ borderColor: SHIP_STATS[d.cls].color }}>
      <div className="hangar-head">
        <span className="title">
          {SHIP_STATS[d.cls].name} #{d.id}
        </span>
        <span className="blurb grow">{SHIP_STATS[d.cls].role}</span>
        {!d.carried && (
          <button
            disabled={!d.docked}
            onClick={() => engine.dispatch({ type: 'scrapShip', shipId: id })}
            title="Scrap for 50 % of base cost (docked only)"
          >
            Scrap
          </button>
        )}
      </div>
      <div className="hint">
        {d.mode} · hull {d.hull}/{d.maxHull}
        {d.cap > 0 && (
          <>
            {' '}
            · cargo {d.cargo}/{d.cap}
          </>
        )}
        <br />
        Stance: {d.engagement} <small>({d.srcEngagement})</small> ·{' '}
        {d.underFire === 'retreatHull' ? `retreat at ${d.retreatAt} %` : d.underFire}{' '}
        <small>({d.srcUnderFire})</small> · {d.mining} <small>({d.srcMining})</small>
      </div>
      {d.synergy && <div className="hint">Board synergy: {d.synergy}</div>}
      <div className="row">
        <span className="blurb grow">Class loadout: {d.loadout ?? 'none'}</span>
        <button
          onClick={() =>
            engine.dispatch({ type: 'setLoadout', cls: d.cls, modules: [...d.modules] })
          }
          title="Save this ship's modules as the template for every ship of this class"
        >
          Save as class loadout
        </button>
        <button
          disabled={!d.loadout}
          onClick={() => engine.dispatch({ type: 'applyLoadout', cls: d.cls })}
          title="Refit every docked ship of this class from the saved template"
        >
          Apply to docked
        </button>
      </div>
      <ModuleSlots
        id={d.id}
        cls={d.cls}
        docked={d.docked}
        modules={d.modules}
        furthestTier={d.furthestTier}
        affordable={d.affordable}
      />
    </div>
  );
}
