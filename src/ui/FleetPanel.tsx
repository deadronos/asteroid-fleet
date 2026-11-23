import { Goals } from './Goals';
import { creditsShort } from '../sim/costs';
import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { focus } from '../render/focus';
import { RETROFIT_COST, shipCost } from '../sim/costs';
import {
  HANGAR_SLOT_COST,
  HANGAR_TYPES,
  hangarLocked,
  tierHint,
  HANGAR_UPKEEP,
  COVER_BACKOFF,
  MODULE_IDS,
  MODULE_SLOTS,
  MODULES,
  moduleLocked,
  NEW_HANGAR_COST,
  SHIP_STATS,
} from '../sim/config';
import { autoBuyUnlocked, autoRebuildUnlocked } from '../sim/automation';
import { effectiveStance, stanceSource } from '../sim/doctrine';
import { maxHull } from '../sim/state';
import { cargoCap } from '../sim/ctx';
import {
  SHIP_CLASSES,
  type Sim,
  type Hangar,
  type HangarType,
  type ModuleId,
  type Ship,
  type ShipClass,
} from '../sim/types';
import { fmt } from './format';
import { deepEqual, shallowEqual } from './equal';

const MODE_LABEL: Record<string, string> = {
  docked: 'docked',
  idle: 'idle',
  toAsteroid: 'to rock',
  mining: 'mining',
  toDropoff: 'to barge',
  toBarge: 'to barge',
  toCarrier: 'returning',
  station: 'on station',
  escort: 'escorting',
  attack: 'attacking',
  patrol: 'patrol',
  repairing: 'repairing',
  retreat: 'retreating',
  recall: 'recalled',
  carried: 'in barge bay',
};

// Haulers use `toDropoff` for salvage runs to a barge wreck's container.
const modeLabel = (ship: Ship) =>
  ship.cls === 'hauler' && ship.mode === 'toDropoff' ? 'salvaging' : MODE_LABEL[ship.mode];

const UNLOCK_HINT: Partial<Record<ShipClass, string>> = {
  fighter: tierHint(2),
  repair: tierHint(2),
  harvester: 'Research the fusion reactor',
};

const indexes = new WeakMap<Ship[], Map<number, Ship>>();

/** Ships by id, built once per ships array (a fleet board would otherwise be O(ships²)). */
function shipIndex(s: Sim): Map<number, Ship> {
  let m = indexes.get(s.ships);
  if (!m) {
    m = new Map(s.ships.map((sh) => [sh.id, sh]));
    indexes.set(s.ships, m);
  }
  return m;
}

/** Same as `occupancy` in sim/hangar, with an id lookup instead of a scan per item. */
function boardOccupancy(byId: Map<number, Ship>, h: Hangar): (number | null)[] {
  const occ: (number | null)[] = Array.from({ length: h.slots }, () => null);
  for (const it of h.items) {
    const ship = byId.get(it.shipId);
    if (!ship) continue;
    const size = SHIP_STATS[ship.cls].slots;
    for (let i = 0; i < size; i++) if (it.start + i < h.slots) occ[it.start + i] = it.shipId;
  }
  return occ;
}

function synergy(
  byId: Map<number, Ship>,
  occ: (number | null)[],
  start: number,
  ship: Ship,
): string | null {
  const end = start + SHIP_STATS[ship.cls].slots;
  const adj = [occ[start - 1], occ[end]].map((id) => (id == null ? undefined : byId.get(id)?.cls));
  if ((ship.cls === 'fighter' || ship.cls === 'barge') && adj.includes('repair'))
    return 'Repair drone adjacent: repairs 3× faster when docked';
  if (ship.cls === 'repair' && (adj.includes('fighter') || adj.includes('barge')))
    return 'Boosting the repairs of its neighbours';
  return null;
}

function HangarBoard({
  hangarId,
  selected,
  onSelect,
  selShip,
  onShip,
}: {
  hangarId: number;
  selected: boolean;
  onSelect: () => void;
  selShip: number;
  onShip: (id: number) => void;
}) {
  const board = useGame((s) => {
    const h = s.hangars.find((x) => x.id === hangarId);
    if (!h) return null;
    const byId = shipIndex(s);
    const occ = boardOccupancy(byId, h);
    const ships: {
      id: number;
      start: number;
      cls: ShipClass;
      out: boolean;
      mode: string;
      syn: string | null;
      modules: ModuleId[];
      hpPct: number;
    }[] = [];
    let used = 0;
    for (let i = 0; i < h.slots; i++) {
      const id = occ[i];
      if (id === null) continue;
      used++;
      if (i > 0 && occ[i - 1] === id) continue;
      const ship = byId.get(id)!;
      const mh = maxHull(s, ship.cls);
      ships.push({
        id,
        start: i,
        cls: ship.cls,
        out: ship.mode !== 'docked',
        mode: modeLabel(ship),
        syn: synergy(byId, occ, i, ship),
        modules: [...ship.modules],
        hpPct: Math.round((ship.hull / mh) * 1000) / 10,
      });
    }
    const slotCost = HANGAR_SLOT_COST(h.slots);
    const autoBuy = autoBuyUnlocked(s);
    const unlocked = SHIP_CLASSES.filter((c) => s.unlocked.includes(c));
    return {
      id: h.id,
      type: h.type,
      slots: h.slots,
      used,
      ships,
      furthestTier: s.stats.furthestTier,
      noCover: s.noCoverAt !== undefined && s.time - s.noCoverAt < COVER_BACKOFF + 5,
      slotCost,
      slotShort: creditsShort(s, slotCost),
      autoBuy,
      unlocked,
      targets: autoBuy ? unlocked.map((c) => h.target[c] ?? 0) : null,
      launchOrder: [...h.launchOrder],
    };
  }, deepEqual);
  const [over, setOver] = useState(-1);
  if (!board) return null;
  const byStart = new Map(board.ships.map((sh) => [sh.start, sh]));
  const cells: React.ReactNode[] = [];
  const drop = (e: React.DragEvent, start: number) => {
    e.preventDefault();
    setOver(-1);
    const id = Number(e.dataTransfer.getData('text/ship'));
    if (id) engine.dispatch({ type: 'moveShip', shipId: id, hangarId: board.id, start });
  };
  for (let i = 0; i < board.slots; i++) {
    const ship = byStart.get(i);
    if (!ship) {
      cells.push(
        <div
          key={'e' + i}
          className={`slot ${over === i ? 'drop' : ''}`}
          style={{ gridColumn: `${i + 1}` }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver(-1)}
          onDrop={(e) => drop(e, i)}
          onClick={onSelect}
        />,
      );
      continue;
    }
    const st = SHIP_STATS[ship.cls];
    cells.push(
      <div
        key={'s' + ship.id}
        className={`ship-tile ${ship.out ? 'out' : ''} ${selShip === ship.id ? 'sel' : ''}`}
        style={{ gridColumn: `${i + 1} / span ${st.slots}`, background: st.color }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/ship', String(ship.id))}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(i);
        }}
        onDrop={(e) => drop(e, i)}
        role="button"
        tabIndex={0}
        aria-pressed={selShip === ship.id}
        onClick={() => onShip(ship.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onShip(ship.id);
          }
        }}
        title={`${st.name}${ship.syn ? ' · ' + ship.syn : ''}${ship.modules.length ? ' · ' + ship.modules.map((m) => MODULES[m].name).join(', ') : ''}`}
      >
        <span className="nm">{st.slots >= 4 ? st.name : st.short}</span>
        <span className="md">{ship.mode}</span>
        {ship.syn && <span className="synergy">✚</span>}
        {ship.modules.length > 0 && (
          <span className="mods">{ship.modules.map((m) => MODULES[m].short[0]).join('')}</span>
        )}
        <span className="hp" style={{ width: `${ship.hpPct}%` }} />
      </div>,
    );
    i += st.slots - 1;
  }
  const def = HANGAR_TYPES[board.type];
  const order = board.launchOrder;
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    engine.dispatch({ type: 'setLaunchOrder', hangarId: board.id, order: next });
  };
  return (
    <div
      className={`hangar ${selected ? 'selected' : ''}`}
      onClick={(e) => e.target === e.currentTarget && onSelect()}
    >
      <div className="hangar-head">
        <span className="title">Hangar {board.id}</span>
        <select
          value={board.type}
          onChange={(e) =>
            engine.dispatch({
              type: 'retrofitHangar',
              hangarId: board.id,
              hangarType: e.target.value as HangarType,
            })
          }
          title={`Retrofit for ${RETROFIT_COST} credits`}
        >
          {(Object.keys(HANGAR_TYPES) as HangarType[]).map((t) => (
            <option key={t} value={t} disabled={!!hangarLocked(t, board.furthestTier)}>
              {HANGAR_TYPES[t].name}
            </option>
          ))}
        </select>
        <span className="blurb grow">{def.blurb}</span>
        {board.noCover && (
          <span
            className="blurb warn"
            title="Safe-stance drones only mine ore near the carrier, a stationed barge or a fighter while pirates are about"
          >
            No ore in cover
          </span>
        )}
        <span className="blurb">
          {board.used}/{board.slots}
        </span>
        <button
          disabled={!!board.slotShort}
          onClick={() => engine.dispatch({ type: 'buySlot', hangarId: board.id })}
          title={board.slotShort ?? 'Buy one more slot'}
        >
          +slot {fmt(board.slotCost)}
        </button>
      </div>
      <div
        className="board"
        style={{ ['--slots' as string]: board.slots }}
        role="group"
        tabIndex={0}
        aria-label={`Hangar ${board.id} board${selected ? ' (selected)' : ''}`}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {cells}
      </div>
      {board.autoBuy && board.targets && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="blurb">Auto-buy target</span>
          <div className="order">
            {board.unlocked.map((c, idx) => (
              <label key={c} title={`Keep this many ${SHIP_STATS[c].name.toLowerCase()}s here`}>
                <i className="swatch" style={{ background: SHIP_STATS[c].color }} />
                {SHIP_STATS[c].short}
                <input
                  type="number"
                  min={0}
                  max={board.slots}
                  value={board.targets![idx]}
                  aria-label={`Hangar ${board.id} ${SHIP_STATS[c].name} target`}
                  style={{ width: '3.2em' }}
                  onChange={(e) =>
                    engine.dispatch({
                      type: 'setHangarTarget',
                      hangarId: board.id,
                      cls: c,
                      count: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <span className="blurb">Launch order</span>
        <div className="order">
          {order
            .filter((c) => board.unlocked.includes(c))
            .map((c) => {
              const i = order.indexOf(c);
              return (
                <span key={c}>
                  <button onClick={() => swap(i, i - 1)}>◀</button>
                  <i className="swatch" style={{ background: SHIP_STATS[c].color }} />
                  {SHIP_STATS[c].short}
                  <button onClick={() => swap(i, i + 1)}>▶</button>
                </span>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function ShipDetail({ id }: { id: number }) {
  const d = useGame((s) => {
    const ship = s.ships.find((x) => x.id === id);
    if (!ship) return null;
    const st = effectiveStance(s, ship);
    const fits = MODULE_IDS.filter((m) => MODULES[m].fits.includes(ship.cls));
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

/** Per-class owned counts in one pass over the fleet. */
export function countByClass(ships: readonly { cls: ShipClass }[]): Record<ShipClass, number> {
  const counts = Object.fromEntries(SHIP_CLASSES.map((c) => [c, 0])) as Record<ShipClass, number>;
  for (const x of ships) counts[x.cls]++;
  return counts;
}

function ShipShop({ hangarId }: { hangarId: number }) {
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
        Hangar slots are the board. Drag ships between slots; put a repair drone next to fighters or
        barges and they repair 3× faster when docked. Click a hangar to build into it, click a
        docked ship to fit modules.
      </p>
      {f.ids.map((id, i) => (
        <div key={id}>
          <HangarBoard
            hangarId={id}
            selected={sel === id}
            onSelect={() => setPicked(id)}
            selShip={selShip}
            onShip={(id) => {
              setSelShip(id === selShip ? -1 : id);
              focus.set(id === selShip ? null : id);
            }}
          />
          {selShip >= 0 && f.hasSel[i] && <ShipDetail id={selShip} />}
        </div>
      ))}
      {
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
      }
    </>
  );
}
