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
import { deepEqual } from './equal';

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
  const s = useGame();
  // Look the hangar up on every render: snapshots replace hangar objects, and the parent only
  // re-renders when the hangar list changes, so a hangar passed as a prop goes stale (#152).
  const h = s.hangars.find((x) => x.id === hangarId);
  const [over, setOver] = useState(-1);
  if (!h) return null;
  const byId = shipIndex(s);
  const occ = boardOccupancy(byId, h);
  const cells: React.ReactNode[] = [];
  const drop = (e: React.DragEvent, start: number) => {
    e.preventDefault();
    setOver(-1);
    const id = Number(e.dataTransfer.getData('text/ship'));
    if (id) engine.dispatch({ type: 'moveShip', shipId: id, hangarId: h.id, start });
  };
  for (let i = 0; i < h.slots; i++) {
    const id = occ[i];
    if (id === null) {
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
    if (i > 0 && occ[i - 1] === id) continue;
    const ship = byId.get(id)!;
    const st = SHIP_STATS[ship.cls];
    const syn = synergy(byId, occ, i, ship);
    cells.push(
      <div
        key={'s' + id}
        className={`ship-tile ${ship.mode !== 'docked' ? 'out' : ''} ${selShip === id ? 'sel' : ''}`}
        style={{ gridColumn: `${i + 1} / span ${st.slots}`, background: st.color }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/ship', String(id))}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(i);
        }}
        onDrop={(e) => drop(e, i)}
        role="button"
        tabIndex={0}
        aria-pressed={selShip === id}
        onClick={() => onShip(id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onShip(id);
          }
        }}
        title={`${st.name}${syn ? ' · ' + syn : ''}${ship.modules.length ? ' · ' + ship.modules.map((m) => MODULES[m].name).join(', ') : ''}`}
      >
        <span className="nm">{st.slots >= 4 ? st.name : st.short}</span>
        <span className="md">{modeLabel(ship)}</span>
        {syn && <span className="synergy">✚</span>}
        {ship.modules.length > 0 && (
          <span className="mods">{ship.modules.map((m) => MODULES[m].short[0]).join('')}</span>
        )}
        <span className="hp" style={{ width: `${(ship.hull / maxHull(s, ship.cls)) * 100}%` }} />
      </div>,
    );
  }
  const def = HANGAR_TYPES[h.type];
  const order = h.launchOrder;
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    engine.dispatch({ type: 'setLaunchOrder', hangarId: h.id, order: next });
  };
  const used = occ.filter((x) => x !== null).length;
  return (
    <div
      className={`hangar ${selected ? 'selected' : ''}`}
      onClick={(e) => e.target === e.currentTarget && onSelect()}
    >
      <div className="hangar-head">
        <span className="title">Hangar {h.id}</span>
        <select
          value={h.type}
          onChange={(e) =>
            engine.dispatch({
              type: 'retrofitHangar',
              hangarId: h.id,
              hangarType: e.target.value as HangarType,
            })
          }
          title={`Retrofit for ${RETROFIT_COST} credits`}
        >
          {(Object.keys(HANGAR_TYPES) as HangarType[]).map((t) => (
            <option key={t} value={t} disabled={!!hangarLocked(t, s.stats.furthestTier)}>
              {HANGAR_TYPES[t].name}
            </option>
          ))}
        </select>
        <span className="blurb grow">{def.blurb}</span>
        {s.noCoverAt !== undefined && s.time - s.noCoverAt < COVER_BACKOFF + 5 && (
          <span
            className="blurb warn"
            title="Safe-stance drones only mine ore near the carrier, a stationed barge or a fighter while pirates are about"
          >
            No ore in cover
          </span>
        )}
        <span className="blurb">
          {used}/{h.slots}
        </span>
        <button
          disabled={!!creditsShort(s, HANGAR_SLOT_COST(h.slots))}
          onClick={() => engine.dispatch({ type: 'buySlot', hangarId: h.id })}
          title={creditsShort(s, HANGAR_SLOT_COST(h.slots)) ?? 'Buy one more slot'}
        >
          +slot {fmt(HANGAR_SLOT_COST(h.slots))}
        </button>
      </div>
      <div
        className="board"
        style={{ ['--slots' as string]: h.slots }}
        role="group"
        tabIndex={0}
        aria-label={`Hangar ${h.id} board${selected ? ' (selected)' : ''}`}
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
      {autoBuyUnlocked(s) && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="blurb">Auto-buy target</span>
          <div className="order">
            {SHIP_CLASSES.filter((c) => s.unlocked.includes(c)).map((c) => (
              <label key={c} title={`Keep this many ${SHIP_STATS[c].name.toLowerCase()}s here`}>
                <i className="swatch" style={{ background: SHIP_STATS[c].color }} />
                {SHIP_STATS[c].short}
                <input
                  type="number"
                  min={0}
                  max={h.slots}
                  value={h.target[c] ?? 0}
                  aria-label={`Hangar ${h.id} ${SHIP_STATS[c].name} target`}
                  style={{ width: '3.2em' }}
                  onChange={(e) =>
                    engine.dispatch({
                      type: 'setHangarTarget',
                      hangarId: h.id,
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
            .filter((c) => s.unlocked.includes(c))
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
  const s = useGame();
  const ship = s.ships.find((x) => x.id === id);
  if (!ship) return null;
  const st = effectiveStance(s, ship);
  const src = (k: 'engagement' | 'underFire' | 'mining') => stanceSource(s, ship, k);
  const cap = cargoCap(s, ship.cls, ship);
  return (
    <div className="hangar" style={{ borderColor: SHIP_STATS[ship.cls].color }}>
      <div className="hangar-head">
        <span className="title">
          {SHIP_STATS[ship.cls].name} #{ship.id}
        </span>
        <span className="blurb grow">{SHIP_STATS[ship.cls].role}</span>
        <button
          disabled={ship.mode !== 'docked'}
          onClick={() => engine.dispatch({ type: 'scrapShip', shipId: id })}
          title="Scrap for 50 % of base cost (docked only)"
        >
          Scrap
        </button>
      </div>
      <div className="hint">
        {modeLabel(ship)} · hull {Math.round(ship.hull)}/{Math.round(maxHull(s, ship.cls))}
        {cap > 0 && (
          <>
            {' '}
            · cargo {Math.round(ship.cls === 'harvester' ? ship.h2 : ship.cargo)}/{Math.round(cap)}
          </>
        )}
        <br />
        Stance: {st.engagement} <small>({src('engagement')})</small> ·{' '}
        {st.underFire === 'retreatHull'
          ? `retreat at ${Math.round(st.retreatAt * 100)} %`
          : st.underFire}{' '}
        <small>({src('underFire')})</small> · {st.mining} <small>({src('mining')})</small>
      </div>
      <ModuleSlots ship={ship} s={s} />
    </div>
  );
}

function ModuleSlots({ ship, s }: { ship: Ship; s: Sim }) {
  const slots = MODULE_SLOTS[ship.cls];
  const docked = ship.mode === 'docked';
  return (
    <div className="row modules">
      <span className="blurb">Modules</span>
      {Array.from({ length: slots }, (_, slot) => {
        const cur = ship.modules[slot] ?? '';
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
                shipId: ship.id,
                slot,
                module: (e.target.value || null) as ModuleId | null,
              })
            }
          >
            <option value="">— empty —</option>
            {MODULE_IDS.filter((m) => MODULES[m].fits.includes(ship.cls)).map((m) => {
              const locked = moduleLocked(m, ship.cls, s.stats.furthestTier);
              const poor = m !== cur && s.credits < MODULES[m].cost;
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
  const s = useGame();
  const a = s.automation;
  const rebuild = autoRebuildUnlocked(s);
  const buy = autoBuyUnlocked(s);
  if (!rebuild && !buy) return null;
  return (
    <div className="row automation">
      {rebuild && (
        <label title="Pay to rebuild lost ships into their hangar">
          <input
            type="checkbox"
            checked={a.autoRebuild}
            onChange={(e) => setAutomation({ autoRebuild: e.target.checked })}
          />
          Auto-rebuild{a.rebuildQueue.length > 0 ? ` (${a.rebuildQueue.length} queued)` : ''}
        </label>
      )}
      {buy && (
        <label title="Buy toward each hangar's target with spare credits">
          <input
            type="checkbox"
            checked={a.autoBuy}
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
          value={a.creditFloor}
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
  const [sel, setSel] = useState(() => engine.view.hangars[0]?.id ?? 1);
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
      {engine.view.hangars.map((h, i) => (
        <div key={h.id}>
          <HangarBoard
            hangarId={h.id}
            selected={sel === h.id}
            onSelect={() => setSel(h.id)}
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
