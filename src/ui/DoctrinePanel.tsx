import { engine, useGame } from '../game/engine';
import { engagementUnlocked } from '../sim/automation';
import { SHIP_STATS } from '../sim/config';
import type { Engagement, MiningStance, ShipClass, Stance, UnderFire } from '../sim/types';
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
          {inherited && <option value="">inherit</option>}
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

export function DoctrinePanel() {
  const s = useGame();
  return (
    <>
      <h3>Stances</h3>
      <p className="hint">
        You never give direct orders. Stances set default behaviour, from broad to specific: fleet
        doctrine, then per ship type, then per hangar. The most specific setting wins; rule cards
        below override stances while they are active.
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
      <RuleCards />
    </>
  );
}
