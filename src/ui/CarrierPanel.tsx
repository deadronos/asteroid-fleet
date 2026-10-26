import { engine, useGame } from '../game/engine';
import {
  MAX_REFINERY,
  MINING_RATE,
  REFINE_ENERGY,
  REFINERY_COST,
  refineRate,
  FUSION_RATE,
  HANGAR_UPKEEP,
  SHIP_STATS,
  SHIP_UPKEEP,
  TIER_NAMES,
  warpCost,
  warpPayment,
} from '../sim/config';
import { lvl, repeatEffect } from '../sim/research';
import { solarRate, upkeep } from '../sim/state';
import { cargoCap } from '../sim/tick';
import { SHIP_CLASSES, type Sim } from '../sim/types';
import { fmt } from './format';

/** Rough per-link rates for the throughput = min(...) readout. Ore units per second. */
function throughput(s: Sim) {
  const drones = s.ships.filter((x) => x.cls === 'drone').length;
  const barges = s.ships.filter((x) => x.cls === 'barge').length;
  const haulers = s.ships.filter((x) => x.cls === 'hauler').length;
  const mining =
    drones * MINING_RATE * (1 + 0.15 * lvl(s, 'yield')) * (1 + repeatEffect(s, 'deepYield')) * 0.45; // ~45 % of a cycle spent drilling
  const avgTrip = 30;
  const droneTransport =
    (drones * cargoCap(s, 'drone')) /
    ((2 * (barges ? avgTrip * 0.35 : avgTrip)) / SHIP_STATS.drone.speed + 4);
  const haulerTransport = barges
    ? (haulers * cargoCap(s, 'hauler')) / ((2 * avgTrip) / SHIP_STATS.hauler.speed + 3)
    : Infinity;
  const spare = Math.max(0, solarRate(s) - upkeep(s).total);
  const refinery = Math.min(refineRate(s.carrier.refinery), spare / REFINE_ENERGY);
  const links = [
    { name: 'Mining', v: mining },
    { name: 'Drone transport', v: droneTransport },
    ...(barges ? [{ name: 'Hauler transport', v: haulers ? haulerTransport : 0 }] : []),
    { name: 'Refinery (energy-limited)', v: refinery },
  ];
  const min = Math.min(...links.map((l) => l.v));
  return { links, min };
}

export function CarrierPanel() {
  const s = useGame();
  const sys = s.systems[s.systemId];
  const t = throughput(s);
  const refCost = REFINERY_COST(s.carrier.refinery);
  const solar = solarRate(s);
  const up = upkeep(s);
  const net = solar - up.total;
  return (
    <>
      <h3>Throughput</h3>
      <p className="hint">The slowest link sets your income. Estimates in ore units per second.</p>
      <table className="doc">
        <tbody>
          {t.links.map((l) => (
            <tr key={l.name}>
              <td>{l.name}</td>
              <td style={{ textAlign: 'right', color: l.v === t.min ? 'var(--warn)' : undefined }}>
                {l.v.toFixed(1)}/s {l.v === t.min && '← bottleneck'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Power</h3>
      <p className="hint">
        One energy pool for upkeep, refinery, shields, warp and drift. Every hangar and every
        launched ship draws upkeep first; docked ships are free. At zero, shields stay down,
        refining stops, hangars hold launches and ships between jobs dock until it recharges.
      </p>
      <table className="doc">
        <tbody>
          <tr>
            <td>Solar</td>
            <td style={{ textAlign: 'right' }}>+{solar.toFixed(2)}/s</td>
          </tr>
          {lvl(s, 'fusion') > 0 && (
            <tr>
              <td>Fusion (while H2 lasts)</td>
              <td style={{ textAlign: 'right' }}>up to +{FUSION_RATE}/s</td>
            </tr>
          )}
          <tr title={`The next hangar adds ${HANGAR_UPKEEP(up.hangars).toFixed(2)}/s`}>
            <td>Hangars × {up.hangars}</td>
            <td style={{ textAlign: 'right' }}>−{up.hangarRate.toFixed(2)}/s</td>
          </tr>
          {SHIP_CLASSES.filter((c) => up.launched[c] > 0).map((c) => (
            <tr key={c}>
              <td>
                {SHIP_STATS[c].short} × {up.launched[c]} launched
              </td>
              <td style={{ textAlign: 'right' }}>
                −{(up.launched[c] * SHIP_UPKEEP[c]).toFixed(2)}/s
              </td>
            </tr>
          ))}
          <tr>
            <td>Left for refinery and shields</td>
            <td style={{ textAlign: 'right', color: net < 0 ? 'var(--warn)' : undefined }}>
              {net >= 0 ? '+' : '−'}
              {Math.abs(net).toFixed(2)}/s
            </td>
          </tr>
        </tbody>
      </table>
      <div className="row">
        {(
          [
            ['income', 'Income', 'Refine down to 0 energy; slow shield regen'],
            ['balanced', 'Balanced', 'Keep 15 % energy in reserve'],
            ['defense', 'Defense', 'Keep 50 % in reserve; fast shield regen'],
          ] as const
        ).map(([m, l, tip]) => (
          <button
            key={m}
            className={s.powerMode === m ? 'on' : ''}
            onClick={() => engine.dispatch({ type: 'setPower', mode: m })}
            title={tip}
          >
            {l}
          </button>
        ))}
      </div>

      <h3>Refinery · level {s.carrier.refinery}</h3>
      <div className="row">
        <span className="grow hint" style={{ margin: 0 }}>
          {refineRate(s.carrier.refinery).toFixed(0)} ore/s, {REFINE_ENERGY} energy per unit
        </span>
        <button
          disabled={s.carrier.refinery >= MAX_REFINERY || s.credits < refCost}
          onClick={() => engine.dispatch({ type: 'upgradeRefinery' })}
        >
          Upgrade · {fmt(refCost)} cr
        </button>
      </div>

      <h3>Sublight</h3>
      <div className="row">
        <button
          className={s.carrier.stance === 'followRich' ? 'on' : ''}
          onClick={() => engine.dispatch({ type: 'setCarrierStance', stance: 'followRich' })}
        >
          Follow richest cluster
        </button>
        <button
          className={s.carrier.stance === 'hold' ? 'on' : ''}
          onClick={() => engine.dispatch({ type: 'setCarrierStance', stance: 'hold' })}
        >
          Hold position
        </button>
      </div>

      <h3>Star map</h3>
      <p className="hint">
        Warp costs energy (any shortfall is paid in stored H2, at a poor rate) and charges for a few
        seconds while the fleet is recalled. Ships still outside at jump time are lost. Pirates
        scale with distance and cargo heat.
      </p>
      {s.systems.map((o) => {
        const here = o.id === s.systemId;
        const cost = warpCost(sys.distance, o.distance);
        const pay = warpPayment(cost, s.carrier.energy, s.carrier.h2);
        return (
          <div key={o.id} className={`sys ${here ? 'here' : ''} ${o.discovered ? '' : 'unknown'}`}>
            <span className={`tier t${o.tier}`}>{TIER_NAMES[o.tier]}</span>
            <div className="grow">
              <div>
                <b>{o.discovered ? o.name : 'Uncharted'}</b>{' '}
                {o.gasGiant && o.discovered && <span title="Gas giant: H2 for fusion">🪐</span>}
              </div>
              {o.discovered && (
                <div className="hint" style={{ margin: 0 }}>
                  ore ×{o.oreMult.toFixed(2)} · ☀ {o.brightness.toFixed(2)} · distance {o.distance}
                </div>
              )}
            </div>
            {here ? (
              <span className="tone-good">here</span>
            ) : (
              <button
                disabled={!o.discovered || !!s.warp || !pay}
                onClick={() => engine.dispatch({ type: 'warp', systemId: o.id })}
                title={o.distance < sys.distance ? 'Warp back to a safer system' : 'Warp outward'}
              >
                Warp · {cost} E
                {pay && pay.h2 > 0 && (
                  <span className="hint" title="Energy short: H2 covers the gap at a poor rate">
                    {' '}
                    ({Math.round(pay.energy)} E + {pay.h2} H2)
                  </span>
                )}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
