import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { marksPayout, researchPayout } from '../sim/actions';
import { HULLS, MARKS_DIVISOR, RP_DIVISOR, SHIP_STATS, TIER_NAMES } from '../sim/config';
import {
  RESEARCH,
  canBuyResearch,
  lvl,
  repeatEffect,
  researchLocked,
  type Branch,
} from '../sim/research';
import { SHIP_CLASSES, type HullId, type ShipClass } from '../sim/types';
import {
  ADMIRALTY_UPGRADES,
  admiraltyCost,
  admiraltyEffect,
  admiraltyLevel,
  canBuyAdmiralty,
} from '../sim/admiralty';
import { fmt } from './format';

const GLOBAL: Branch[] = ['Logistics', 'Mining', 'Combat', 'Carrier', 'Reserves', 'Automation'];

function Pair(p: { a: string; av: string; b: string; bv: string }) {
  return (
    <div className="row">
      <div className="grow">
        <div className="hint" style={{ margin: 0 }}>
          {p.a}
        </div>
        <div className="big">{p.av}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="hint" style={{ margin: 0 }}>
          {p.b}
        </div>
        <div className="big" style={{ color: '#c9b6ff' }}>
          {p.bv}
        </div>
      </div>
    </div>
  );
}

export function ResearchPanel() {
  const s = useGame();
  const [confirm, setConfirm] = useState(false);
  const [confirmAdm, setConfirmAdm] = useState(false);
  const marks = marksPayout(s);
  const current = s.carrier.hullClass;
  const [hull, setHull] = useState<HullId | null>(null);
  const pick = hull && s.hulls.includes(hull) ? hull : current;
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
        <Pair
          a="Research points available"
          av={`${s.research} RP`}
          b="Prestige now pays"
          bv={`+${rp} RP`}
        />
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
            {s.hulls.length > 1 && (
              <select
                aria-label="Hull class for the next run"
                value={pick}
                onChange={(e) => setHull(e.target.value as HullId)}
              >
                {s.hulls.map((id) => (
                  <option key={id} value={id} title={HULLS[id].blurb}>
                    {HULLS[id].name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => {
                engine.doPrestige(pick);
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
        <Pair a="Admiralty Marks" av={fmt(s.marks)} b="Admiralty now pays" bv={`+${fmt(marks)}`} />
        <p className="hint">
          Marks = ⌊√(lifetime RP ÷ {MARKS_DIVISOR})⌋ minus Marks paid. Resets research and
          discovered systems; automation and hulls stay.
        </p>
        {!confirmAdm ? (
          <button disabled={marks <= 0} onClick={() => setConfirmAdm(true)}>
            Admiralty reset…
          </button>
        ) : (
          <div className="row">
            <span>Reset for +{fmt(marks)} Marks?</span>
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
      <div className="branch">
        <h3>
          Admiralty shop <span className="hint">{fmt(s.marks)} Marks</span>
        </h3>
        {ADMIRALTY_UPGRADES.map((u) => (
          <div className="row" key={u.id}>
            <div className="grow">
              <b>{u.name}</b>
              <div className="hint" style={{ margin: 0 }}>
                {u.desc} · level {fmt(admiraltyLevel(s, u.id))}: {u.label(admiraltyEffect(s, u.id))}
              </div>
            </div>
            <button
              disabled={!canBuyAdmiralty(s, u.id)}
              onClick={() => engine.dispatch({ type: 'buyAdmiralty', id: u.id })}
            >
              {fmt(admiraltyCost(s, u.id))} Marks
            </button>
          </div>
        ))}
      </div>
      {GLOBAL.map(branch)}
      {SHIP_CLASSES.map((c) => branch(c))}
    </>
  );
}
