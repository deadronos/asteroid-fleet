import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import {
  COVER_BACKOFF,
  HANGAR_SLOT_COST,
  HANGAR_TYPES,
  MODULES,
  SHIP_STATS,
  hangarLocked,
} from '../sim/config';
import { autoBuyUnlocked } from '../sim/automation';
import { creditsShort, RETROFIT_COST } from '../sim/costs';
import { occupancy, repairSynergy, type RepairSynergyKind } from '../sim/hangar';
import { maxHull } from '../sim/state';
import { SHIP_CLASSES, type HangarType, type ModuleId, type ShipClass } from '../sim/types';
import { deepEqual } from './equal';
import { fmt } from './format';
import { modeLabel, shipIndex, SYNERGY_LABEL } from './fleetBoard';

/** One hangar's board: ship tiles, slot movement, retrofit, auto-buy and launch order (#250). */
export function HangarBoard({
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
    const occ = occupancy(s, h, byId);
    const ships: {
      id: number;
      start: number;
      cls: ShipClass;
      out: boolean;
      mode: string;
      syn: RepairSynergyKind | null;
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
        syn: repairSynergy(s, occ, ship, byId)?.kind ?? null,
        modules: [...ship.modules],
        hpPct: Math.round((ship.hull / mh) * 1000) / 10,
      });
    }
    const slotCost = HANGAR_SLOT_COST(h.slots);
    const autoBuy = autoBuyUnlocked(s);
    const unlocked = SHIP_CLASSES.filter((c) => s.unlocked.includes(c));
    const selected = selShip >= 0 ? s.ships.find((x) => x.id === selShip) : undefined;
    return {
      id: h.id,
      type: h.type,
      slots: h.slots,
      used,
      occ,
      selSize: selected ? SHIP_STATS[selected.cls].slots : 0,
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
  // Tap/keyboard movement: a ship stays selected until it is moved or Escape cancels it.
  // Allow overlapping the ship's own slots (matches sim/hangar.ts `fits`), so multi-slot ships can shift left.
  const free = (start: number) =>
    board.selSize > 0 &&
    start + board.selSize <= board.slots &&
    board.occ.slice(start, start + board.selSize).every((id) => id === null || id === selShip);
  const move = (start: number) => {
    if (!free(start)) return;
    engine.dispatch({ type: 'moveShip', shipId: selShip, hangarId: board.id, start });
    onShip(-1);
  };
  const cancel = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && selShip >= 0) {
      e.preventDefault();
      e.stopPropagation();
      onShip(-1);
    }
  };
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
          className={`slot ${over === i ? 'drop' : ''} ${free(i) ? 'valid' : ''}`}
          style={{ gridColumn: `${i + 1}` }}
          role="button"
          tabIndex={free(i) ? 0 : -1}
          aria-label={
            free(i)
              ? `Move selected ship to slot ${i + 1}`
              : `Empty slot ${i + 1} in hangar ${board.id}`
          }
          onDragOver={(e) => {
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver(-1)}
          onDrop={(e) => drop(e, i)}
          onClick={() => (free(i) ? move(i) : onSelect())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              move(i);
            } else cancel(e);
          }}
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
        aria-label={`${st.name} #${ship.id}, slot ${i + 1}`}
        onClick={() => onShip(ship.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onShip(ship.id);
          } else cancel(e);
        }}
        title={`${st.name}${ship.syn ? ' · ' + SYNERGY_LABEL[ship.syn] : ''}${ship.modules.length ? ' · ' + ship.modules.map((m) => MODULES[m].name).join(', ') : ''}`}
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
          if (e.key === 'Escape') cancel(e);
          else if (e.key === 'Enter' || e.key === ' ') {
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
