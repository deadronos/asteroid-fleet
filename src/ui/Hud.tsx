import { engine, useGame } from '../game/engine';
import { lvl } from '../sim/research';
import { maxEnergy, refineThroughput } from '../sim/state';
import { carrierStorage } from '../sim/hangar';
import { TIER_NAMES } from '../sim/config';
import { heatFactor } from '../sim/combat';
import { leftBehind } from '../sim/warp';
import { fmt } from './format';
import { shallowEqual } from './equal';

function Bar({ v, color }: { v: number; color: string }) {
  return (
    <div className="bar">
      <i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: color }} />
    </div>
  );
}

export function Hud({
  tactical,
  autoTactical,
  quality,
  onTactical,
  onQuality,
  onMap,
}: {
  tactical: boolean;
  autoTactical: boolean;
  quality: 'high' | 'low';
  onTactical: () => void;
  onQuality: () => void;
  onMap: () => void;
}) {
  // Everything drawn, rounded as it is displayed, so a tick that changes nothing visible skips the render.
  const h = useGame((s) => {
    const c = s.carrier;
    const sys = s.systems[s.systemId];
    const emax = maxEnergy(s);
    const heat = heatFactor(s);
    return {
      credits: fmt(s.credits),
      income: `${s.incomeAvg >= 0 ? '+' : ''}${s.incomeAvg.toFixed(1)}`,
      energy: Math.floor(c.energy),
      energyBar: Math.round((c.energy / emax) * 1000) / 1000,
      shieldPct: Math.round(c.shield * 100),
      shieldBar: Math.round(c.shield * 1000) / 1000,
      hullPct: Math.round((c.hull / c.maxHull) * 100),
      ore: fmt(c.ore),
      storage: fmt(carrierStorage(s)),
      refine: refineThroughput(s).toFixed(0),
      fusion: lvl(s, 'fusion') > 0,
      h2: c.h2.toFixed(0),
      heat: heat.toFixed(2),
      heatNum: Math.round(heat * 100) / 100,
      outside: s.ships.filter((x) => x.mode !== 'docked').length,
      sysName: sys.name,
      sysTier: sys.tier,
      brightness: sys.brightness.toFixed(2),
    };
  }, shallowEqual);
  return (
    <>
      <div className="hud">
        <div className="chip">
          <span className="k">Credits</span>
          <span className="v">{h.credits}</span>
          <span className="sub">
            {h.income}/s
          </span>
        </div>
        <div
          className="chip"
          title="Energy pool: solar recharge, spent on refining, shields, warp and drift"
        >
          <span className="k">Energy</span>
          <span className="v" style={{ color: 'var(--energy)' }}>
            {h.energy}
          </span>
          <Bar v={h.energyBar} color="var(--energy)" />
        </div>
        <div className="chip">
          <span className="k">Shields · Hull</span>
          <span className="v">
            <span style={{ color: 'var(--shield)' }}>{h.shieldPct}%</span>{' '}
            <span className="sub">{h.hullPct}%</span>
          </span>
          <Bar v={h.shieldBar} color="var(--shield)" />
        </div>
        <div
          className="chip"
          title="Unrefined ore in the carrier. The refinery converts it to credits using energy."
        >
          <span className="k">Ore hold</span>
          <span className="v">
            {h.ore}
            <span className="sub"> / {h.storage}</span>
          </span>
          <span className="sub">refine {h.refine}/s</span>
        </div>
        {h.fusion && (
          <div className="chip">
            <span className="k">H2</span>
            <span className="v" style={{ color: '#ff9f5a' }}>
              {h.h2}
            </span>
          </div>
        )}
        <div className="chip" title="Ore held by the fleet and carrier raises pirate wave size">
          <span className="k">Cargo heat</span>
          <span
            className="v"
            style={{ color: h.heatNum > 2 ? 'var(--bad)' : h.heatNum > 1.4 ? 'var(--warn)' : 'var(--text)' }}
          >
            ×{h.heat}
          </span>
          <span className="sub">{h.outside} ships out</span>
        </div>
        <div className="chip">
          <span className="k">System</span>
          <span className="v">{h.sysName}</span>
          <span className={`sub t${h.sysTier}`}>
            {TIER_NAMES[h.sysTier]} · ☀ {h.brightness}
          </span>
        </div>
        <div className="spacer" />
        <div className="controls">
          <button
            className={engine.paused ? 'on' : ''}
            onClick={() => engine.togglePause()}
            title="Pause"
          >
            {engine.paused ? '▶' : '❚❚'}
          </button>
          {[1, 2, 4].map((v) => (
            <button
              key={v}
              className={engine.speed === v && !engine.paused ? 'on' : ''}
              onClick={() => engine.setSpeed(v)}
            >
              {v}×
            </button>
          ))}
          <button onClick={onMap} title="Star map and supply routes (M)">
            Map
          </button>
          <button
            className={tactical || autoTactical ? 'on' : ''}
            onClick={onTactical}
            title="Tactical sensor view (also turns on when you zoom far out). Cyan: scouted rich veins, orange: charted hazards"
          >
            Tactical
          </button>
          <button
            onClick={onQuality}
            title="Low quality turns off bloom and caps resolution and frame rate"
          >
            {quality === 'high' ? 'HQ' : 'LQ'}
          </button>
        </div>
      </div>
      <Alerts />
    </>
  );
}

type AlertView =
  | { kind: 'warp'; target: string; seconds: number; outside: number }
  | { kind: 'attack'; raiders: number }
  | { kind: 'wave'; seconds: number; size: number }
  | { kind: 'storm'; gas: boolean }
  | null;

function Alerts() {
  const a = useGame((s): AlertView => {
    if (s.warp)
      return {
        kind: 'warp',
        target: s.systems[s.warp.targetSystem].name,
        seconds: Math.ceil(s.warp.charge),
        outside: leftBehind(s).length,
      };
    if (s.wave.active) return { kind: 'attack', raiders: s.pirates.length };
    if (s.wave.warning) return { kind: 'wave', seconds: Math.ceil(s.wave.timer), size: s.wave.size };
    if (s.storm.active > 0) return { kind: 'storm', gas: s.systems[s.systemId].gasGiant };
    return null;
  }, shallowEqual);
  if (!a) return null;
  if (a.kind === 'warp')
    return (
      <div className="alert warp">
        Warp to {a.target} in {a.seconds} s · recalling fleet ({a.outside} outside){' '}
        <button
          onClick={() => engine.dispatch({ type: 'jumpNow' })}
          title="Ships still outside are lost"
        >
          Jump now
        </button>{' '}
        <button onClick={() => engine.dispatch({ type: 'cancelWarp' })}>Cancel</button>
      </div>
    );
  if (a.kind === 'attack') return <div className="alert">Pirate attack · {a.raiders} raiders</div>;
  if (a.kind === 'wave')
    return (
      <div className="alert warn">
        Pirate wave inbound in {a.seconds} s · {a.size} raiders
      </div>
    );
  if (a.gas) return <div className="alert warn">H2 storm · ships near the gas giant take damage</div>;
  return <div className="alert warn">Solar storm · ships outside cover take damage</div>;
}
