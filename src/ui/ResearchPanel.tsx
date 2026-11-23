import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { marksPayout, researchMult, researchPayout } from '../sim/costs';
import { RESEARCH_DESC } from './researchText';
import {
  CARRIER_COST,
  HULLS,
  MARKS_DIVISOR,
  RP_DIVISOR,
  RP_PER_MARK,
  SHIP_STATS,
  TIER_NAMES,
} from '../sim/config';
import {
  RESEARCH,
  canBuyResearch,
  lvl,
  repeatEffect,
  researchLocked,
  type Branch,
} from '../sim/research';
import { MILESTONES, carrierSlots } from '../sim/milestones';
import { SHIP_CLASSES, type ChallengeId, type HullId, type ShipClass } from '../sim/types';
import { CHALLENGES, CHALLENGE_IDS, MODIFIERS, challengeProgress } from '../sim/modifiers';
import {
  ADMIRALTY_UPGRADES,
  admiraltyCost,
  admiraltyEffect,
  admiraltyLevel,
  canBuyAdmiralty,
} from '../sim/admiralty';
import { deepEqual } from './equal';
import { fmt } from './format';

const GLOBAL: Branch[] = ['Logistics', 'Mining', 'Combat', 'Carrier', 'Reserves', 'Automation'];

function BuyCarrier(p: { owned: number; cost: number; canAfford: boolean; slots: number }) {
  const free = p.owned < p.slots;
  return (
    <div className="row">
      <button
        disabled={!free || !p.canAfford}
        onClick={() => engine.dispatch({ type: 'buyCarrier' })}
        title={
          free ? 'A new carrier starts in the home system' : 'Reach the next Admiralty milestone'
        }
      >
        Buy carrier · {fmt(p.cost)} cr
      </button>
      <span className="hint">
        {p.owned} of {p.slots} carrier slots in use
      </span>
    </div>
  );
}

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
        <div className="big" style={{ color: 'var(--accent-research)' }}>
          {p.bv}
        </div>
      </div>
    </div>
  );
}

export function ResearchPanel() {
  const r = useGame((s) => {
    const tier = s.stats.furthestTier as 1 | 2 | 3;
    const progress = challengeProgress(s);
    const owned = engine.carriers.length;
    const carrierCost = CARRIER_COST(owned);
    return {
      research: s.research,
      rp: researchPayout(s),
      marks: s.marks,
      marksGain: marksPayout(s),
      tier,
      oreDelivered: fmt(s.stats.oreValueDelivered),
      researchMult: researchMult(s).toFixed(2),
      hullClass: s.carrier.hullClass,
      hulls: [...s.hulls],
      unlocked: [...s.unlocked],
      prestiges: s.lifetime.prestiges,
      modifiers: [...s.modifiers],
      challenge: s.challenge,
      progressPct: progress !== null ? Math.floor(progress * 100) : null,
      challengesDone: [...s.challengesDone],
      admiralties: s.lifetime.admiralties,
      carrierSlots: carrierSlots(s),
      ownedCarriers: owned,
      carrierCost,
      canBuyCarrier: s.credits >= carrierCost,
      admiraltyUpgrades: ADMIRALTY_UPGRADES.map((u) => ({
        id: u.id,
        level: fmt(admiraltyLevel(s, u.id)),
        label: u.label(admiraltyEffect(s, u.id)),
        canBuy: canBuyAdmiralty(s, u.id),
        cost: fmt(admiraltyCost(s, u.id)),
      })),
      nodes: RESEARCH.map((n) => {
        const l = lvl(s, n.id);
        return {
          id: n.id,
          level: l,
          maxed: l >= n.maxLevel,
          locked: !!(researchLocked(s, n) || (n.tier && tier < n.tier)),
          canBuy: canBuyResearch(s, n.id),
          cost: fmt(n.cost(l)),
          repeatLabel: n.repeat && l > 0 ? n.repeat.label(repeatEffect(s, n.id)) : null,
        };
      }),
    };
  }, deepEqual);
  const [confirm, setConfirm] = useState(false);
  const [confirmAdm, setConfirmAdm] = useState(false);
  const [confirmChallenge, setConfirmChallenge] = useState<ChallengeId | null>(null);
  const [hull, setHull] = useState<HullId | null>(null);
  // Late layers only appear once the player has earned a prestige, or already owns the progress
  // they unlock (an imported save, a challenge or a second carrier) (#247).
  const lateGame =
    r.prestiges > 0 ||
    r.admiralties > 0 ||
    r.marks > 0 ||
    r.challengesDone.length > 0 ||
    r.challenge !== null ||
    r.ownedCarriers > 1;
  const pick = hull && r.hulls.includes(hull) ? hull : r.hullClass;
  const nodeById = new Map(r.nodes.map((n) => [n.id, n]));
  const branch = (b: Branch) => {
    const nodes = RESEARCH.filter((n) => n.branch === b);
    if (!nodes.length) return null;
    const label = SHIP_CLASSES.includes(b as ShipClass) ? SHIP_STATS[b as ShipClass].name : b;
    return (
      <div className="branch" key={b}>
        <h3>
          {label}{' '}
          <span className="hint">
            {nodes.filter((n) => nodeById.get(n.id)!.maxed).length}/
            {nodes.filter((n) => !n.repeat).length} maxed
          </span>
        </h3>
        <div className="nodes">
          {nodes.map((n) => {
            const st = nodeById.get(n.id)!;
            return (
              <div key={n.id} className={`node ${st.maxed ? 'maxed' : ''}`}>
                <span className="nname">{n.name}</span>
                <span className="ndesc">
                  {RESEARCH_DESC[n.id]}
                  {n.tier && r.tier < n.tier && ` · needs ${TIER_NAMES[n.tier].toLowerCase()}`}
                  {n.repeat &&
                    (st.level > 0
                      ? ` · level ${fmt(st.level)}: ${st.repeatLabel}`
                      : ` · after ${RESEARCH.find((x) => x.id === n.repeat?.base)?.name} is maxed`)}
                </span>
                <div className="row">
                  <div className="pips grow">
                    {!n.repeat &&
                      Array.from({ length: n.maxLevel }, (_, i) => (
                        <i key={i} className={i < st.level ? 'f' : ''} />
                      ))}
                  </div>
                  <button
                    disabled={!st.canBuy}
                    onClick={() => engine.dispatch({ type: 'buyResearch', id: n.id })}
                  >
                    {st.maxed ? 'max' : st.locked ? 'locked' : `${st.cost} RP`}
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
          av={`${r.research} RP`}
          b="Prestige now pays"
          bv={`+${r.rp} RP`}
        />
        <details>
          <summary className="hint">How RP works</summary>
          <p className="hint">
            RP = ⌊√(ore value delivered ÷ {fmt(RP_DIVISOR)})⌋ × furthest zone tier × (1 +{' '}
            {Math.round(RP_PER_MARK * 100)} % per Admiralty Mark earned). This run: {r.oreDelivered}{' '}
            delivered, furthest {TIER_NAMES[r.tier]} (×{r.tier}), Marks ×{r.researchMult}. Prestige
            resets credits, ships, slots and position; research, unlocked ships and rules, doctrine
            and discovered systems persist.
          </p>
        </details>
        {!confirm ? (
          <button disabled={r.rp <= 0} onClick={() => setConfirm(true)}>
            Prestige…
          </button>
        ) : (
          <div className="row">
            <span>Reset this operation for +{r.rp} RP?</span>
            {r.hulls.length > 1 && (
              <select
                aria-label="Hull class for the next run"
                value={pick}
                onChange={(e) => setHull(e.target.value as HullId)}
              >
                {r.hulls.map((id) => (
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
      {lateGame && (
        <>
          <div className="prestige-box">
            <Pair
              a="Admiralty Marks"
              av={fmt(r.marks)}
              b="Admiralty now pays"
              bv={`+${fmt(r.marksGain)}`}
            />
            <details>
              <summary className="hint">How Marks work</summary>
              <p className="hint">
                Marks = ⌊√(lifetime RP ÷ {MARKS_DIVISOR})⌋ minus Marks paid. Resets research and
                discovered systems; automation and hulls stay.
              </p>
            </details>
            {!confirmAdm ? (
              <button disabled={r.marksGain <= 0} onClick={() => setConfirmAdm(true)}>
                Admiralty reset…
              </button>
            ) : (
              <div className="row">
                <span>Reset for +{fmt(r.marksGain)} Marks?</span>
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
          <div className="prestige-box" aria-label="Challenge runs">
            <div className="hint" style={{ margin: 0 }}>
              Challenge runs
            </div>
            {r.modifiers.length > 0 && (
              <p className="hint">
                Active modifiers: {r.modifiers.map((m) => MODIFIERS[m].name).join(', ')}.
                {r.challenge && r.progressPct !== null && ` Goal ${r.progressPct}% delivered.`}
              </p>
            )}
            {CHALLENGE_IDS.map((id) => {
              const def = CHALLENGES[id];
              const done = r.challengesDone.includes(id);
              return (
                <div className="row" key={id}>
                  <div className="grow">
                    <b>{def.name}</b>
                    {done && ' (complete)'}
                    <div className="hint" style={{ margin: 0 }}>
                      {def.blurb} Deliver {fmt(def.goal)} ore value with{' '}
                      {def.modifiers.map((m) => MODIFIERS[m].name.toLowerCase()).join(' + ')}. Pays
                      +{def.marks} Marks and +{Math.round(def.oreBonus * 100)}% ore value for good.
                    </div>
                  </div>
                  {confirmChallenge === id ? (
                    <>
                      <button
                        onClick={() => {
                          engine.doChallenge(id, pick);
                          setConfirmChallenge(null);
                        }}
                      >
                        Reset and start
                      </button>
                      <button onClick={() => setConfirmChallenge(null)}>Cancel</button>
                    </>
                  ) : (
                    <button disabled={done} onClick={() => setConfirmChallenge(id)}>
                      {r.challenge === id ? 'Restart…' : 'Start…'}
                    </button>
                  )}
                </div>
              );
            })}
            <p className="hint">Starting a challenge resets the operation like a prestige.</p>
          </div>
          <div className="branch">
            <h3>
              Admiralty shop <span className="hint">{fmt(r.marks)} Marks</span>
            </h3>
            {ADMIRALTY_UPGRADES.map((u, idx) => {
              const st = r.admiraltyUpgrades[idx];
              return (
                <div className="row" key={u.id}>
                  <div className="grow">
                    <b>{u.name}</b>
                    <div className="hint" style={{ margin: 0 }}>
                      {u.desc} · level {st.level}: {st.label}
                    </div>
                  </div>
                  <button
                    disabled={!st.canBuy}
                    onClick={() => engine.dispatch({ type: 'buyAdmiralty', id: u.id })}
                  >
                    {st.cost} Marks
                  </button>
                </div>
              );
            })}
          </div>
          <div className="prestige-box">
            <Pair
              a="Admiralty resets"
              av={String(r.admiralties)}
              b="Carrier slots"
              bv={String(r.carrierSlots)}
            />
            {MILESTONES.map((m) => (
              <div key={m.at} className="hint">
                {r.admiralties >= m.at ? '✓' : '○'} {m.at}: {m.label}
              </div>
            ))}
            <BuyCarrier
              owned={r.ownedCarriers}
              cost={r.carrierCost}
              canAfford={r.canBuyCarrier}
              slots={r.carrierSlots}
            />
          </div>
        </>
      )}
      {GLOBAL.map(branch)}
      {SHIP_CLASSES.filter((c) => r.unlocked.includes(c)).map((c) => branch(c))}
    </>
  );
}
