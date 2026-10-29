import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { cardSlots, checkCard } from '../sim/cards';
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
import type {
  ActionKind,
  CardScope,
  Condition,
  ConditionKind,
  Sim,
  RuleCard,
  RuleId,
  StanceSwitch,
} from '../sim/types';

type Draft = Omit<RuleCard, 'id'>;

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

function newDraft(s: Sim): Draft {
  const then = ACTION_KINDS.find((a) => s.unlockedRules.includes(ACTION_DEFS[a].unlock));
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
  const s = useGame();
  const [d, setD] = useState<Draft>(() => structuredClone(initial));
  // Hangars of every carrier: the mirror holds only the focused operation (#178).
  const hangarIds = carrierRoster(engine.carriers, engine.state.ops).flatMap((c) => c.hangars);
  // The sim's own check, on a copy, so the editor can say what is wrong before sending.
  const err = checkCard(s, structuredClone(d), hangarIds);
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
          onChange={(e) => setD({ ...d, scope: JSON.parse(e.target.value) as CardScope })}
        >
          {scopeOption({ kind: 'fleet' }, 'All ships')}
          {s.unlocked.map((cls) =>
            scopeOption({ kind: 'class', cls }, `${SHIP_STATS[cls].short}s`),
          )}
          {hangarIds.map((id) => scopeOption({ kind: 'hangar', id }, `Hangar ${id}`))}
        </select>
      </label>
      {d.when.map((c, i) => (
        <div className="cond" key={i}>
          <span className="lbl">{i === 0 ? 'When' : 'and'}</span>
          <select
            value={c.kind}
            aria-label={`Condition ${i + 1}`}
            onChange={(e) => pickCond(i, e.target.value as ConditionKind)}
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
          onChange={(e) => pickAction(e.target.value as ActionKind)}
        >
          {ACTION_KINDS.map((a) => (
            <option key={a} value={a} disabled={!s.unlockedRules.includes(ACTION_DEFS[a].unlock)}>
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
            onChange={(e) =>
              setD({ ...d, then: { ...d.then, to: e.target.value as StanceSwitch } })
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
              onChange={(e) => {
                const sec = Math.max(0, Math.round(Number(e.target.value) || 0));
                setD({ ...d, then: { ...d.then, seconds: sec || undefined } });
              }}
            />
            s after (0 = while it holds)
          </span>
        </label>
      )}
      {err && <p className="hint">{err}</p>}
      <div className="row">
        <button
          className="on"
          disabled={!!err}
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
  const s = useGame();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const slots = cardSlots(s);
  const full = s.cards.length >= slots;
  const presets = (Object.keys(PRESETS) as RuleId[]).filter((id) => s.unlockedRules.includes(id));
  return (
    <>
      <h3>
        Rule cards{' '}
        <span className="hint">
          {s.cards.length} / {slots}
        </span>
      </h3>
      <p className="hint">
        A card fires when all its conditions hold and overrides the stance while active. The most
        specific scope wins (hangar, then ship type, then fleet), then the higher card.
        {presets.length < Object.keys(PRESETS).length && ' More actions unlock further out.'}
      </p>
      {s.cards.map((card, i) =>
        editing === card.id ? (
          <Editor
            key={card.id}
            initial={card}
            onDone={() => setEditing(null)}
            submit={(d) => engine.dispatch({ type: 'updateCard', id: card.id, card: d })}
          />
        ) : (
          <div
            key={card.id}
            className={`rule ${!s.unlockedRules.includes(ACTION_DEFS[card.then.kind].unlock) ? 'locked' : !card.enabled ? 'off' : ''}`}
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
                disabled={i === s.cards.length - 1}
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
        ),
      )}
      {editing === 'new' ? (
        <Editor
          initial={newDraft(s)}
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
