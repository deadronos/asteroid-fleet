import { useMemo, useState } from 'react';
import { engine, useGame } from '../game/engine';
import { TIER_NAMES } from '../sim/config';
import { MAX_ROUTES, ROUTE_RATES, routeChance } from '../sim/routeinfo';
import { ROUTE_RESOURCES, type RouteResource } from '../sim/types';
import { carrierChoices } from './inbox';
import { fmt } from './format';
import { Modal } from './Modal';
import { MAP_H, MAP_W, layoutSystems } from './mapLayout';
import { PALETTE } from './palette';

const TIER_COLOR = PALETTE.tier;
const RESOURCE_LABEL: Record<RouteResource, string> = { ore: 'Ore', h2: 'H2', energy: 'Energy' };

/** Strategic star map (#80): switch carriers, warp the focused one, and run supply routes. */
export function StarMap({ onClose }: { onClose: () => void }) {
  const s = useGame();
  const carriers = engine.carriers;
  const labels = carrierChoices(carriers, s.systems);
  const label = (id: number) => labels.find((l) => l.id === id)?.label ?? `Carrier ${id}`;
  const nodes = useMemo(() => layoutSystems(s.systems), [s.systems]);
  const at = (systemId: number) => nodes[systemId] ?? { id: systemId, x: 0, y: 0 };
  const focusedId = engine.focusedCarrierId;
  const focusedSystem = carriers.find((c) => c.id === focusedId)?.systemId ?? s.systemId;
  const [picked, setPicked] = useState<number | null>(null);
  const [from, setFrom] = useState(focusedId);
  const [to, setTo] = useState<number | null>(null);
  const [resource, setResource] = useState<RouteResource>('ore');
  const [rate, setRate] = useState(ROUTE_RATES[1]);

  const dest =
    to !== null && to !== from && carriers.some((c) => c.id === to)
      ? to
      : (carriers.find((c) => c.id !== from)?.id ?? null);
  const pick = picked !== null ? s.systems[picked] : null;
  // Carriers per system, so markers in a shared system sit side by side.
  const slots = new Map<number, number[]>();
  for (const c of carriers) slots.set(c.systemId, [...(slots.get(c.systemId) ?? []), c.id]);
  const marker = (id: number) => {
    const c = carriers.find((x) => x.id === id);
    if (!c) return { x: 0, y: 0 };
    const group = slots.get(c.systemId) ?? [id];
    const p = at(c.systemId);
    return { x: p.x + (group.indexOf(id) - (group.length - 1) / 2) * 22, y: p.y - 26 };
  };

  return (
    <Modal title="Star map" className="starmap" onClose={onClose}>
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="starmap-svg"
        role="group"
        aria-label="Systems"
      >
        {s.routes.map((r) => {
          const a = marker(r.from);
          const b = marker(r.to);
          const chance = routeChance(s, carriers, r);
          return (
            <line
              key={r.id}
              className={`route ${r.resource}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeDasharray={chance > 0 ? '6 4' : undefined}
            />
          );
        })}
        {s.systems.map((sys) => {
          const p = at(sys.id);
          const here = sys.id === focusedSystem;
          return (
            <g
              key={sys.id}
              className={`sys ${sys.discovered ? '' : 'unknown'} ${picked === sys.id ? 'sel' : ''}`}
              role="button"
              aria-label={sys.discovered ? `System ${sys.name}` : 'Unexplored system'}
              onClick={() => setPicked(sys.id)}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={here ? 11 : 8}
                fill={sys.discovered ? TIER_COLOR[sys.tier] : PALETTE.undiscovered}
              />
              <text x={p.x} y={p.y + 26} textAnchor="middle">
                {sys.discovered ? sys.name : '?'}
              </text>
            </g>
          );
        })}
        {carriers.map((c, i) => {
          const m = marker(c.id);
          const on = c.id === focusedId;
          return (
            <g
              key={c.id}
              className={`carrier-mark ${on ? 'on' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`Carrier ${label(c.id)}`}
              aria-pressed={on}
              onClick={() => engine.focusCarrier(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') engine.focusCarrier(c.id);
              }}
            >
              <rect x={m.x - 9} y={m.y - 9} width={18} height={18} rx={4} />
              <text x={m.x} y={m.y + 4} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="starmap-info">
        {pick ? (
          pick.discovered ? (
            <>
              <b>{pick.name}</b> · {TIER_NAMES[pick.tier]} · {pick.distance} jumps out · ore ×
              {pick.oreMult.toFixed(2)} · ☀ {pick.brightness.toFixed(2)}
              {pick.gasGiant ? ' · gas giant' : ''}{' '}
              {pick.id !== focusedSystem && (
                <button onClick={() => engine.dispatch({ type: 'warp', systemId: pick.id })}>
                  Warp {label(focusedId)} here
                </button>
              )}
            </>
          ) : (
            <span className="hint">Unexplored. Scouts and further research reveal it.</span>
          )
        ) : (
          <span className="hint">
            Click a system for details, or a numbered carrier to switch to it.
          </span>
        )}
      </div>

      <h3>Supply routes</h3>
      {carriers.length < 2 ? (
        <p className="hint">Buy a second carrier to move ore, H2 and energy between carriers.</p>
      ) : (
        <>
          <p className="hint">
            Credits and research are shared; ore, H2 and energy are per carrier. A route ships its
            rate every second. Across systems, pirates may intercept a shipment and take it.
          </p>
          {s.routes.length === 0 && <p className="hint">No routes yet.</p>}
          <ul className="routes">
            {s.routes.map((r) => (
              <li key={r.id}>
                <b>{label(r.from)}</b> → <b>{label(r.to)}</b> · {RESOURCE_LABEL[r.resource]}{' '}
                {r.rate}/s · {Math.round(routeChance(s, carriers, r) * 100)}% intercept ·{' '}
                <span className="sub">
                  {fmt(r.moved)} delivered, {fmt(r.lost)} lost
                </span>{' '}
                <button
                  onClick={() => engine.dispatchFor(r.from, { type: 'removeRoute', routeId: r.id })}
                  aria-label={`Remove route ${label(r.from)} to ${label(r.to)}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="row route-form">
            <select
              aria-label="Route from"
              value={from}
              onChange={(e) => setFrom(Number(e.target.value))}
            >
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c.id)}
                </option>
              ))}
            </select>
            →
            <select
              aria-label="Route to"
              value={dest ?? ''}
              onChange={(e) => setTo(Number(e.target.value))}
            >
              {carriers
                .filter((c) => c.id !== from)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {label(c.id)}
                  </option>
                ))}
            </select>
            <select
              aria-label="Route resource"
              value={resource}
              onChange={(e) => setResource(e.target.value as RouteResource)}
            >
              {ROUTE_RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {RESOURCE_LABEL[r]}
                </option>
              ))}
            </select>
            <select
              aria-label="Route rate"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              {ROUTE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}/s
                </option>
              ))}
            </select>
            <button
              disabled={dest === null || s.routes.length >= MAX_ROUTES}
              onClick={() =>
                dest !== null &&
                engine.dispatchFor(from, { type: 'addRoute', to: dest, resource, rate })
              }
            >
              Add route
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
