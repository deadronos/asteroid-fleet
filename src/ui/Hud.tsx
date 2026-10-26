import { engine, useGame } from '../game/engine';
import { lvl } from '../sim/research';
import { maxEnergy } from '../sim/state';
import { carrierStorage } from '../sim/hangar';
import { refineRate, TIER_NAMES } from '../sim/config';
import { heatFactor } from '../sim/tick';
import { leftBehind } from '../sim/warp';
import { fmt } from './format';

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
}: {
  tactical: boolean;
  autoTactical: boolean;
  quality: 'high' | 'low';
  onTactical: () => void;
  onQuality: () => void;
}) {
  const s = useGame();
  const c = s.carrier;
  const sys = s.systems[s.systemId];
  const emax = maxEnergy(s);
  const storage = carrierStorage(s);
  const heat = heatFactor(s);
  const outside = s.ships.filter((x) => x.mode !== 'docked').length;
  return (
    <>
      <div className="hud">
        <div className="chip">
          <span className="k">Credits</span>
          <span className="v">{fmt(s.credits)}</span>
          <span className="sub">
            {s.incomeAvg >= 0 ? '+' : ''}
            {s.incomeAvg.toFixed(1)}/s
          </span>
        </div>
        <div
          className="chip"
          title="Energy pool: solar recharge, spent on refining, shields, warp and drift"
        >
          <span className="k">Energy</span>
          <span className="v" style={{ color: 'var(--energy)' }}>
            {Math.floor(c.energy)}
          </span>
          <Bar v={c.energy / emax} color="var(--energy)" />
        </div>
        <div className="chip">
          <span className="k">Shields · Hull</span>
          <span className="v">
            <span style={{ color: 'var(--shield)' }}>{Math.round(c.shield * 100)}%</span>{' '}
            <span className="sub">{Math.round((c.hull / c.maxHull) * 100)}%</span>
          </span>
          <Bar v={c.shield} color="var(--shield)" />
        </div>
        <div
          className="chip"
          title="Unrefined ore in the carrier. The refinery converts it to credits using energy."
        >
          <span className="k">Ore hold</span>
          <span className="v">
            {fmt(c.ore)}
            <span className="sub"> / {fmt(storage)}</span>
          </span>
          <span className="sub">refine {refineRate(c.refinery).toFixed(0)}/s</span>
        </div>
        {lvl(s, 'fusion') > 0 && (
          <div className="chip">
            <span className="k">H2</span>
            <span className="v" style={{ color: '#ff9f5a' }}>
              {c.h2.toFixed(0)}
            </span>
          </div>
        )}
        <div className="chip" title="Ore held by the fleet and carrier raises pirate wave size">
          <span className="k">Cargo heat</span>
          <span
            className="v"
            style={{ color: heat > 2 ? 'var(--bad)' : heat > 1.4 ? 'var(--warn)' : 'var(--text)' }}
          >
            ×{heat.toFixed(2)}
          </span>
          <span className="sub">{outside} ships out</span>
        </div>
        <div className="chip">
          <span className="k">System</span>
          <span className="v">{sys.name}</span>
          <span className={`sub t${sys.tier}`}>
            {TIER_NAMES[sys.tier]} · ☀ {sys.brightness.toFixed(2)}
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

function Alerts() {
  const s = useGame();
  if (s.warp) {
    const outside = leftBehind(s).length;
    return (
      <div className="alert warp">
        Warp to {s.systems[s.warp.targetSystem].name} in {Math.ceil(s.warp.charge)} s · recalling
        fleet ({outside} outside){' '}
        <button
          onClick={() => engine.dispatch({ type: 'jumpNow' })}
          title="Ships still outside are lost"
        >
          Jump now
        </button>{' '}
        <button onClick={() => engine.dispatch({ type: 'cancelWarp' })}>Cancel</button>
      </div>
    );
  }
  if (s.wave.active) return <div className="alert">Pirate attack · {s.pirates.length} raiders</div>;
  if (s.wave.warning)
    return (
      <div className="alert warn">
        Pirate wave inbound in {Math.ceil(s.wave.timer)} s · {s.wave.size} raiders
      </div>
    );
  if (s.storm.active > 0 && s.systems[s.systemId].gasGiant)
    return <div className="alert warn">H2 storm · ships near the gas giant take damage</div>;
  if (s.storm.active > 0)
    return <div className="alert warn">Solar storm · ships outside cover take damage</div>;
  return null;
}
