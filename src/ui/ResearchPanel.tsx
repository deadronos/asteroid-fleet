import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { marksPayout, researchPayout } from '../sim/actions';
import { MARKS_DIVISOR, RP_DIVISOR, SHIP_STATS, TIER_NAMES } from '../sim/config';
import {
  RESEARCH,
  canBuyResearch,
  lvl,
  repeatEffect,
  researchLocked,
  type Branch,
} from '../sim/research';
import { SHIP_CLASSES, type ShipClass } from '../sim/types';
import { fmt } from './format';

const GLOBAL: Branch[] = ['Logistics', 'Mining', 'Combat', 'Carrier', 'Reserves', 'Automation'];

export function ResearchPanel() {
  const s = useGame();
  const [confirm, setConfirm] = useState(false);
  const [confirmAdm, setConfirmAdm] = useState(false);
  const marks = marksPayout(s);
  const rp = researchPayout(s);
  const tier = s.stats.furthestTier as 1 | 2 | 3;
  const branch = (b: Branch) => {
    const nodes = RESEARCH.filter((n) => n.branch === b);
    if (!nodes.length) return null;
    const label = SHIP_CLASSES.includes(b as ShipClass) ? SHIP_STATS[b as ShipClass].name : b;
    return (
      <div className="branch" key={b}>
        <h3>
          {label}{' '}
          <span className="hint">
            {nodes.filter((n) => lvl(s, n.id) >= n.maxLevel).length}/
            {nodes.filter((n) => !n.repeat).length} maxed
          </span>
        </h3>
        <div className="nodes">
          {nodes.map((n) => {
            const l = lvl(s, n.id);
            const maxed = l >= n.maxLevel;
            const locked = researchLocked(s, n) || (n.tier && tier < n.tier);
            return (
              <div key={n.id} className={`node ${maxed ? 'maxed' : ''}`}>
                <span className="nname">{n.name}</span>
                <span className="ndesc">
                  {n.desc}
                  {n.tier && tier < n.tier && ` · needs ${TIER_NAMES[n.tier].toLowerCase()}`}
                  {n.repeat &&
                    (l > 0
                      ? ` · level ${fmt(l)}: ${n.repeat.label(repeatEffect(s, n.id))}`
                      : ` · after ${RESEARCH.find((r) => r.id === n.repeat?.base)?.name} is maxed`)}
                </span>
                <div className="row">
                  <div className="pips grow">
                    {!n.repeat &&
                      Array.from({ length: n.maxLevel }, (_, i) => (
                        <i key={i} className={i < l ? 'f' : ''} />
                      ))}
                  </div>
                  <button
                    disabled={!canBuyResearch(s, n.id)}
                    onClick={() => engine.dispatch({ type: 'buyResearch', id: n.id })}
                  >
                    {maxed ? 'max' : locked ? 'locked' : `${fmt(n.cost(l))} RP`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <>
      <div className="prestige-box">
        <div className="row">
          <div className="grow">
            <div className="hint" style={{ margin: 0 }}>
              Research points available
            </div>
            <div className="big">{s.research} RP</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="hint" style={{ margin: 0 }}>
              Prestige now pays
            </div>
            <div className="big" style={{ color: '#c9b6ff' }}>
              +{rp} RP
            </div>
          </div>
        </div>
        <p className="hint">
          RP = ⌊√(ore value delivered ÷ {fmt(RP_DIVISOR)})⌋ × furthest zone tier. This run:{' '}
          {fmt(s.stats.oreValueDelivered)} delivered, furthest {TIER_NAMES[tier]} (×{tier}).
          Prestige resets credits, ships, slots and position; research, unlocked ships and rules,
          doctrine and discovered systems persist.
        </p>
        {!confirm ? (
          <button disabled={rp <= 0} onClick={() => setConfirm(true)}>
            Prestige…
          </button>
        ) : (
          <div className="row">
            <span>Reset this operation for +{rp} RP?</span>
            <button
              onClick={() => {
                engine.doPrestige();
                setConfirm(false);
              }}
            >
              Yes, reset
            </button>
            <button onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>
      <div className="prestige-box">
        <div className="row">
          <div className="grow">
            <div className="hint" style={{ margin: 0 }}>
              Admiralty Marks
            </div>
            <div className="big">{fmt(s.marks)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="hint" style={{ margin: 0 }}>
              Admiralty now pays
            </div>
            <div className="big" style={{ color: '#c9b6ff' }}>
              +{fmt(marks)}
            </div>
          </div>
        </div>
        <p className="hint">
          Marks = ⌊√(lifetime RP ÷ {MARKS_DIVISOR})⌋ less Marks already paid. Admiralty resets the
          research tree, RP and discovered systems along with the run. Automation research, hulls,
          rules and Marks persist.
        </p>
        {!confirmAdm ? (
          <button disabled={marks <= 0} onClick={() => setConfirmAdm(true)}>
            Admiralty reset…
          </button>
        ) : (
          <div className="row">
            <span>Reset research for +{fmt(marks)} Marks?</span>
            <button
              onClick={() => {
                engine.doAdmiralty();
                setConfirmAdm(false);
              }}
            >
              Yes, reset
            </button>
            <button onClick={() => setConfirmAdm(false)}>Cancel</button>
          </div>
        )}
      </div>
      {GLOBAL.map(branch)}
      {SHIP_CLASSES.map((c) => branch(c))}
    </>
  );
}
