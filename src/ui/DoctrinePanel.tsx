import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { engagementUnlocked } from '../sim/automation';
import { SHIP_STATS } from '../sim/config';
import type {
  AlertMode,
  Engagement,
  MiningStance,
  ShipClass,
  SimEventKind,
  Stance,
  UnderFire,
} from '../sim/types';
import { TOAST_POLICY } from '../game/toasts';
import { formatEventKind } from './events';
import { carrierRoster } from './carriers';
import { carrierChoices } from './inbox';
import { RuleCards } from './RuleCards';

const ENGAGE: [Engagement, string][] = [
  ['aggressive', 'Aggressive'],
  ['defensive', 'Defensive'],
  ['escort', 'Escort'],
  ['passive', 'Passive'],
];
const FIRE: [UnderFire, string][] = [
  ['stand', 'Stand ground'],
  ['retreatHull', 'Retreat at hull'],
  ['retreatCargo', 'Unload first'],
];
const MINING: [MiningStance, string][] = [
  ['safe', 'Safe'],
  ['greedy', 'Greedy'],
];
const RETREAT = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];

type Scope = 'fleet' | ShipClass | number;

function StanceRow({
  label,
  scope,
  value,
  inherited,
}: {
  label: React.ReactNode;
  scope: Scope;
  value: Partial<Stance>;
  inherited: boolean;
}) {
  const s = useGame();
  const set = (key: keyof Stance, raw: string) => {
    if (raw === '') engine.dispatch({ type: 'setStance', scope, patch: null, key });
    else
      engine.dispatch({
        type: 'setStance',
        scope,
        patch: { [key]: key === 'retreatAt' ? Number(raw) : raw },
      });
  };
  const engageLocked = !engagementUnlocked(s);
  const cell = (key: keyof Stance, opts: [string | number, string][], disabled = false) => {
    const v = value[key];
    return (
      <td>
        <select
          className={v === undefined ? 'inherit' : ''}
          value={v === undefined ? '' : String(v)}
          onChange={(e) => set(key, e.target.value)}
          disabled={disabled}
        >
          {inherited && (
            <option value="" title="Use the setting from the broader scope">
              inherit
            </option>
          )}
          {opts.map(([o, l]) => (
            <option key={String(o)} value={String(o)}>
              {l}
            </option>
          ))}
        </select>
      </td>
    );
  };
  return (
    <tr>
      <td>{label}</td>
      {cell('engagement', ENGAGE, engageLocked)}
      {cell('underFire', FIRE)}
      {cell(
        'retreatAt',
        RETREAT.map((r) => [r, `${Math.round(r * 100)} %`] as [number, string]),
      )}
      {cell('mining', MINING)}
    </tr>
  );
}

const ALERT_LABEL: [AlertMode, string][] = [
  ['off', 'Off'],
  ['inbox', 'Inbox'],
  ['toast', 'Toast'],
  ['pause', 'Toast + pause'],
  ['focus', 'Toast + focus'],
];
const ALERT_GROUPS: [string, SimEventKind[]][] = [
  [
    'Combat',
    [
      'PirateWaveIncoming',
      'PiratesArrived',
      'WaveRepelled',
      'ShipLost',
      'ShipRetreating',
      'BargeWrecked',
    ],
  ],
  ['Travel', ['WarpCharging', 'WarpCancelled', 'Warped', 'EmergencyJump']],
  ['Hazards and mining', ['StormStarted', 'StormPassed', 'HazardCharted', 'VeinFound']],
  ['Fleet', ['CarrierOnline', 'BargeFallback', 'ReserveRebuilt', 'ShipRebuilt', 'HangarInstalled']],
  ['Progress', ['Prestiged', 'Admiralty', 'ChallengeStarted', 'ChallengeComplete', 'WelcomeBack']],
];
const GROUPED = new Set(ALERT_GROUPS.flatMap(([, ks]) => ks));
const ALERT_OTHER = (Object.keys(TOAST_POLICY) as SimEventKind[]).filter(
  (k) => k !== 'Legacy' && !GROUPED.has(k),
);
if (ALERT_OTHER.length) ALERT_GROUPS.push(['Other', ALERT_OTHER]);

function AlertRules() {
  const s = useGame();
  const choices = carrierChoices(carrierRoster(engine.carriers, engine.state.ops), s.systems);
  const [scope, setScope] = useState<'fleet' | number>('fleet');
  const active = scope === 'fleet' || choices.some((c) => c.id === scope) ? scope : 'fleet';
  const set = (kind: SimEventKind, raw: string) =>
    engine.dispatch({
      type: 'setAlert',
      scope: active,
      kind,
      mode: raw === '' ? null : (raw as AlertMode),
    });
  return (
    <>
      <h3>Alerts</h3>
      <p className="hint">
        Choose what each event does. A carrier&apos;s own setting beats the fleet-wide one. Off
        hides the event from the inbox too. Unset events use the default; “inherit” means a carrier
        follows the fleet-wide rule.
      </p>
      {choices.length > 1 && (
        <label>
          Rules for{' '}
          <select
            aria-label="Alert scope"
            value={String(active)}
            onChange={(e) =>
              setScope(e.target.value === 'fleet' ? 'fleet' : Number(e.target.value))
            }
          >
            <option value="fleet">Whole fleet</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {ALERT_GROUPS.map(([group, kinds], i) => (
        <details key={group} open={i === 0}>
          <summary>{group}</summary>
          <table className="doc">
            <tbody>
              {kinds.map((kind) => {
                const own =
                  active === 'fleet' ? s.alerts.fleet[kind] : s.alerts.byCarrier[active]?.[kind];
                return (
                  <tr key={kind}>
                    <td>{formatEventKind(kind)}</td>
                    <td>
                      <select
                        aria-label={formatEventKind(kind)}
                        className={own === undefined ? 'inherit' : ''}
                        value={own ?? ''}
                        onChange={(e) => set(kind, e.target.value)}
                      >
                        <option value="">{active === 'fleet' ? 'default' : 'inherit'}</option>
                        {ALERT_LABEL.map(([m, l]) => (
                          <option key={m} value={m}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ))}
    </>
  );
}

export function DoctrinePanel() {
  const s = useGame();
  return (
    <>
      <h3>Stances</h3>
      <p className="hint">
        You never give direct orders. Stances set default behaviour, from broad to specific: fleet
        doctrine, then per ship type, then per hangar. The most specific setting wins; rule cards
        below override stances while they are active. “Inherit” means: use the broader scope’s
        setting.
        {!s.unlocked.includes('fighter') && ' Engagement stances unlock in the frontier.'}
      </p>
      <table className="doc">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Engagement</th>
            <th>Under fire</th>
            <th>Retreat at</th>
            <th>Mining</th>
          </tr>
        </thead>
        <tbody>
          <StanceRow
            label={<b>Fleet</b>}
            scope="fleet"
            value={s.doctrine.fleet}
            inherited={false}
          />
          {s.unlocked.map((c) => (
            <StanceRow
              key={c}
              label={
                <>
                  <i className="swatch" style={{ background: SHIP_STATS[c].color }} />
                  {SHIP_STATS[c].short}
                </>
              }
              scope={c}
              value={s.doctrine.byClass[c] ?? {}}
              inherited
            />
          ))}
          {s.hangars.map((h) => (
            <StanceRow
              key={h.id}
              label={`Hangar ${h.id}`}
              scope={h.id}
              value={h.stance}
              inherited
            />
          ))}
        </tbody>
      </table>
      <AlertRules />
      <RuleCards />
    </>
  );
}
