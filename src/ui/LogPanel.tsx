import { engine, useGame } from '../game/engine';
import { resolveAlert } from '../game/toasts';
import { carrierRoster } from './carriers';
import { formatEvent, toneClass } from './events';
import { fmt, formatSimTime } from './format';
import {
  activeCarrier,
  carrierChoices,
  filterEvents,
  inboxKey,
  mergeForInbox,
  type CarrierFilter,
  type SeverityFilter,
} from './inbox';

/** Run summary and filterable event inbox panel. */
export function LogPanel({
  carrier,
  onCarrier,
  severity,
  onSeverity,
}: {
  carrier: CarrierFilter;
  onCarrier: (carrier: CarrierFilter) => void;
  severity: SeverityFilter;
  onSeverity: (severity: SeverityFilter) => void;
}) {
  const s = useGame();
  const st = s.stats;
  const choices = carrierChoices(carrierRoster(engine.carriers, engine.state.ops), s.systems);
  const selected = activeCarrier(
    carrier,
    choices.map((c) => c.id),
  );
  const rows = filterEvents(mergeForInbox(s.log), selected, severity).filter(
    (ev) => resolveAlert(s.alerts, ev.kind, ev.carrierId) !== 'off',
  );
  return (
    <>
      <h3>This run</h3>
      <p className="hint">
        {fmt(st.oreValueDelivered)} ore value delivered · {fmt(st.creditsEarned)} credits earned ·{' '}
        {st.piratesKilled} pirates destroyed · {st.shipsLost} ships lost · prestige ×
        {s.lifetime.prestiges}
      </p>
      <h3>Event inbox</h3>
      <div className="row">
        <label>
          Carrier{' '}
          <select
            aria-label="Carrier"
            value={selected === 'all' ? 'all' : String(selected)}
            onChange={(e) => {
              const v = e.target.value;
              onCarrier(v === 'all' ? 'all' : Number(v));
            }}
          >
            <option value="all">All</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity{' '}
          <select
            aria-label="Severity"
            value={severity}
            onChange={(e) => onSeverity(e.target.value as SeverityFilter)}
          >
            <option value="all">All</option>
            <option value="warn+">Warn+</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </div>
      <div className="log">
        {rows.map((l) => (
          <div key={inboxKey(l)} className={toneClass(l.severity)}>
            <span className="t">{formatSimTime(l.t)}</span>
            {formatEvent(l)}
            {l.count > 1 && <span className="t">x{l.count}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
