import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { cardActive, cardSlots, checkCard, conditionHolds } from '../sim/cards';
import {
  ACTION_DEFS,
  CONDITION_DEFS,
  MAX_CONDITIONS,
  PRESETS,
  SHIP_STATS,
  STANCE_SWITCHES,
} from '../sim/config';
import { carrierRoster } from './carriers';
import { ACTION_LABEL, CONDITION_LABEL, fmtValue, STANCE_LABEL } from './cardText';
import { deepEqual } from './equal';
import type {
  ActionKind,
  CardScope,
  Condition,
  ConditionKind,
  RuleCard,
  RuleId,
  Sim,
  StanceSwitch,
} from '../sim/types';

type Draft = Omit<RuleCard, 'id'>;

interface Activity {
  active: boolean;
  count: number;
}

/**
 * Live firing status per card, derived from the UI mirror on each 5 Hz tick (#246). Carrier cards
 * check their conditions once; ship cards count the units their scope and conditions cover.
 */
function cardActivity(s: Sim): Record<number, Activity> {
  const out: Record<number, Activity> = {};
  for (const card of s.cards) {
    const carrier = ACTION_DEFS[card.then.kind].classes === null;
    if (!card.enabled || !cardActive(s, card)) {
      out[card.id] = { active: false, count: 0 };
    } else if (carrier) {
      out[card.id] = { active: card.when.every((c) => conditionHolds(s, c, null)), count: 0 };
    } else {
      let count = 0;
      for (const sh of s.ships) {
        if (card.scope.kind === 'hangar' && sh.hangarId !== card.scope.id) continue;
        if (card.scope.kind === 'class' && sh.cls !== card.scope.cls) continue;
        if (card.when.every((c) => conditionHolds(s, c, sh))) count++;
      }
      out[card.id] = { active: count > 0, count };
    }
  }
  return out;
}

const CONDITION_KINDS = Object.keys(CONDITION_DEFS) as ConditionKind[];
const ACTION_KINDS = Object.keys(ACTION_DEFS) as ActionKind[];

function scopeLabel(sc: CardScope): string {
  if (sc.kind === 'fleet') return 'All ships';
  if (sc.kind === 'class') return `${SHIP_STATS[sc.cls].short}s`;
  return `Hangar ${sc.id}`;
}

function conditionText(c: Condition): string {
  const def = CONDITION_DEFS[c.kind];
  const text = CONDITION_LABEL[c.kind].toLowerCase();
  return def.value ? `${text} ${fmtValue(def.value, c.value ?? 0)}` : text;
}

function actionText(card: Pick<Draft, 'then'>): string {
  const t = card.then;
  if (t.kind !== 'stance') return ACTION_LABEL[t.kind].replace(/ \(.*/, '').toLowerCase();
  const to = t.to ? STANCE_LABEL[t.to] : '?';
  return `switch to ${to.toLowerCase()}${t.seconds ? ` for ${t.seconds} s` : ''}`;
}

/** Short name for a preset in the picker. */
const describe = (c: Pick<Draft, 'scope' | 'then'>) => `${scopeLabel(c.scope)}: ${actionText(c)}`;

/** Scopes go through the <select> as JSON, built in the same key order as the sim's. */
const scopeOption = (sc: CardScope, label: string) => (
  <option key={label} value={JSON.stringify(sc)}>
    {label}
  </option>
);

function newDraft(unlockedRules: readonly RuleId[]): Draft {
  const then = ACTION_KINDS.find((a) => unlockedRules.includes(ACTION_DEFS[a].unlock));
  return {
    enabled: true,
    scope: { kind: 'fleet' },
    when: [{ kind: 'always' }],
    then: then === 'stance' ? { kind: then, to: 'engagement:escort' } : { kind: then ?? 'park' },
  };
}

function ValueInput({ c, onChange }: { c: Condition; onChange: (v: number) => void }) {
  const def = CONDITION_DEFS[c.kind].value;
  if (!def) return null;
  const v = c.value ?? 0;
  return (
    <span className="val">
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={v}
        aria-label={`${CONDITION_LABEL[c.kind]} value`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {fmtValue(def, v)}
    </span>
  );
}

function Editor({
  initial,
  onDone,
  submit,
}: {
  initial: Draft;
  onDone: () => void;
  submit: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(() => structuredClone(initial));
  const e = useGame((s) => {
    // Hangars of every carrier: the mirror holds only the focused operation (#178).
    const hangarIds = carrierRoster(engine.carriers, engine.state.ops).flatMap((c) => c.hangars);
    return {
      unlocked: [...s.unlocked],
      unlockedRules: [...s.unlockedRules],
      hangarIds,
      // The sim's own check, on a copy, so the editor can say what is wrong before sending.
      err: checkCard(s, structuredClone(d), hangarIds),
    };
  }, deepEqual);
  const setCond = (i: number, c: Condition) =>
    setD({ ...d, when: d.when.map((x, j) => (j === i ? c : x)) });
  const pickCond = (i: number, kind: ConditionKind) => {
    const def = CONDITION_DEFS[kind].value;
    setCond(i, def ? { kind, value: def.def } : { kind });
  };
  const pickAction = (kind: ActionKind) =>
    setD({
      ...d,
      then: kind === 'stance' ? { kind, to: d.then.to ?? 'engagement:escort' } : { kind },
    });
  return (
    <div className="card-edit">
      <label>
        Who
        <select
          value={JSON.stringify(d.scope)}
          onChange={(ev) => setD({ ...d, scope: JSON.parse(ev.target.value) as CardScope })}
        >
          {scopeOption({ kind: 'fleet' }, 'All ships')}
          {e.unlocked.map((cls) =>
            scopeOption({ kind: 'class', cls }, `${SHIP_STATS[cls].short}s`),
          )}
          {e.hangarIds.map((id) => scopeOption({ kind: 'hangar', id }, `Hangar ${id}`))}
        </select>
      </label>
      {d.when.map((c, i) => (
        <div className="cond" key={i}>
          <span className="lbl">{i === 0 ? 'When' : 'and'}</span>
          <select
            value={c.kind}
            aria-label={`Condition ${i + 1}`}
            onChange={(ev) => pickCond(i, ev.target.value as ConditionKind)}
          >
            {CONDITION_KINDS.map((k) => (
              <option key={k} value={k}>
                {CONDITION_LABEL[k]}
              </option>
            ))}
          </select>
          <ValueInput c={c} onChange={(v) => setCond(i, { ...c, value: v })} />
          {d.when.length > 1 && (
            <button
              title="Remove condition"
              onClick={() => setD({ ...d, when: d.when.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {d.when.length < MAX_CONDITIONS && (
        <button onClick={() => setD({ ...d, when: [...d.when, { kind: 'always' }] })}>
          + and…
        </button>
      )}
      <label>
        Then
        <select
          value={d.then.kind}
          aria-label="Action"
          onChange={(ev) => pickAction(ev.target.value as ActionKind)}
        >
          {ACTION_KINDS.map((a) => (
            <option key={a} value={a} disabled={!e.unlockedRules.includes(ACTION_DEFS[a].unlock)}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      {d.then.kind === 'stance' && (
        <label>
          Switch to
          <select
            value={d.then.to}
            onChange={(ev) =>
              setD({ ...d, then: { ...d.then, to: ev.target.value as StanceSwitch } })
            }
          >
            {STANCE_SWITCHES.map((to) => (
              <option key={to} value={to}>
                {STANCE_LABEL[to]}
              </option>
            ))}
          </select>
          <span className="val">
            for
            <input
              type="number"
              min={0}
              max={600}
              value={d.then.seconds ?? 0}
              aria-label="Seconds to hold"
              onChange={(ev) => {
                const sec = Math.max(0, Math.round(Number(ev.target.value) || 0));
                setD({ ...d, then: { ...d.then, seconds: sec || undefined } });
              }}
            />
            s after (0 = while it holds)
          </span>
        </label>
      )}
      {e.err && <p className="hint">{e.err}</p>}
      <div className="row">
        <button
          className="on"
          disabled={!!e.err}
          onClick={() => {
            submit(d);
            onDone();
          }}
        >
          Save
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export function RuleCards() {
  const r = useGame(
    (s) => ({
      slots: cardSlots(s),
      cards: structuredClone(s.cards),
      unlockedRules: [...s.unlockedRules],
    }),
    deepEqual,
  );
  const activity = useGame(cardActivity, deepEqual);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const full = r.cards.length >= r.slots;
  const presets = (Object.keys(PRESETS) as RuleId[]).filter((id) => r.unlockedRules.includes(id));
  return (
    <>
      <h3>
        Rule cards{' '}
        <span className="hint">
          {r.cards.length} / {r.slots}
        </span>
      </h3>
      <p className="hint">
        A card fires when all its conditions hold and overrides the stance while active. The most
        specific scope wins (hangar, then ship type, then fleet), then the higher card.
        {presets.length < Object.keys(PRESETS).length && ' More actions unlock further out.'}
      </p>
      {r.cards.map((card, i) => {
        const live = activity[card.id];
        return editing === card.id ? (
          <Editor
            key={card.id}
            initial={card}
            onDone={() => setEditing(null)}
            submit={(d) => engine.dispatch({ type: 'updateCard', id: card.id, card: d })}
          />
        ) : (
          <div
            key={card.id}
            className={`rule ${!r.unlockedRules.includes(ACTION_DEFS[card.then.kind].unlock) ? 'locked' : !card.enabled ? 'off' : ''}`}
            data-card={card.id}
          >
            <input
              type="checkbox"
              checked={card.enabled}
              aria-label="Card enabled"
              onChange={(e) =>
                engine.dispatch({
                  type: 'updateCard',
                  id: card.id,
                  card: { ...card, enabled: e.target.checked },
                })
              }
            />
            <div className="when">
              <b>{scopeLabel(card.scope)}</b> · when {card.when.map(conditionText).join(' and ')} →{' '}
              {actionText(card)}
              {live?.active && (
                <span
                  className="card-live"
                  aria-label={live.count ? `${live.count} ships firing` : 'Card firing'}
                >
                  {' '}
                  ● active
                  {live.count ? ` · ${live.count} ${live.count === 1 ? 'ship' : 'ships'}` : ''}
                </span>
              )}
            </div>
            <div className="card-tools">
              <button
                title="Move up"
                disabled={i === 0}
                onClick={() => engine.dispatch({ type: 'moveCard', id: card.id, to: i - 1 })}
              >
                ▲
              </button>
              <button
                title="Move down"
                disabled={i === r.cards.length - 1}
                onClick={() => engine.dispatch({ type: 'moveCard', id: card.id, to: i + 1 })}
              >
                ▼
              </button>
              <button title="Edit" onClick={() => setEditing(card.id)}>
                ✎
              </button>
              <button
                title="Delete"
                onClick={() => engine.dispatch({ type: 'deleteCard', id: card.id })}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
      {editing === 'new' ? (
        <Editor
          initial={newDraft(r.unlockedRules)}
          onDone={() => setEditing(null)}
          submit={(d) => engine.dispatch({ type: 'addCard', card: d })}
        />
      ) : (
        <div className="row">
          <button disabled={full} onClick={() => setEditing('new')}>
            + New card
          </button>
          <select
            value=""
            disabled={full || presets.length === 0}
            aria-label="Add a preset card"
            onChange={(e) => {
              const id = e.target.value as RuleId;
              if (!id) return;
              const card: Draft = {
                enabled: true,
                preset: id,
                ...structuredClone(PRESETS[id].card),
              };
              engine.dispatch({ type: 'addCard', card });
            }}
          >
            <option value="">+ Preset…</option>
            {presets.map((id) => (
              <option key={id} value={id}>
                {describe(PRESETS[id].card)}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
