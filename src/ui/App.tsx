import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { engine, useGame } from '../game/engine';
import { readBackups, readPrimaryText } from '../game/save';
import { updateSettings, useSettings } from '../game/settings';
import { SHIP_STATS } from '../sim/config';
import { SHIP_CLASSES } from '../sim/types';
import { downloadFile } from './download';
import { resolveAlert } from '../game/toasts';
import { formatEvent, toneClass } from './events';
import {
  activeCarrier,
  carrierChoices,
  filterEvents,
  inboxKey,
  mergeForInbox,
  type CarrierFilter,
  type SeverityFilter,
} from './inbox';
import { SceneBoundary } from './ErrorBoundary';
import { FleetPanel } from './FleetPanel';
import { CarrierBar } from './CarrierBar';
import { useHotkeys } from './hotkeys';
import { HotkeyHelp } from './HotkeyHelp';
import { Hud } from './Hud';
import { useStackLayout } from './layout';
import { fmt, formatSimTime } from './format';
import { GearButton } from './GearButton';
import { tierHint } from '../sim/config';
import { Modal } from './Modal';
import { Tabs } from './Tabs';
import { ICON_SHAPE, PALETTE } from './palette';

// Not needed for the first frame: the scene (three.js + r3f), the research tree
// and the settings menu load as separate chunks right after first paint.
const Scene = lazy(() => import('../render/Scene').then((m) => ({ default: m.Scene })));
const loadResearch = () => import('./ResearchPanel').then((m) => ({ default: m.ResearchPanel }));
const loadSettings = () => import('./Settings').then((m) => ({ default: m.SettingsMenu }));
const CarrierPanel = lazy(() =>
  import('./CarrierPanel').then((m) => ({ default: m.CarrierPanel })),
);
const DoctrinePanel = lazy(() =>
  import('./DoctrinePanel').then((m) => ({ default: m.DoctrinePanel })),
);
const ResearchPanel = lazy(loadResearch);
const SettingsMenu = lazy(loadSettings);
const loadStarMap = () => import('./StarMap').then((m) => ({ default: m.StarMap }));
const StarMap = lazy(loadStarMap);

// Warm the secondary chunks once the browser is idle so opening them doesn't pop in.
const whenIdle = (fn: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(fn, 2000);
whenIdle(() => {
  void loadResearch();
  void loadSettings();
  void loadStarMap();
});

type Tab = 'fleet' | 'doctrine' | 'carrier' | 'research' | 'log';
const TABS: [Tab, string][] = [
  ['fleet', 'Hangars'],
  ['doctrine', 'Doctrine'],
  ['carrier', 'Carrier'],
  ['research', 'Research'],
  ['log', 'Log'],
];

function read<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

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
  const choices = carrierChoices(engine.state.ops, s.systems);
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

/** Next preset speed up or down from `v`, clamped to 1×–4×. */
export function stepSpeed(v: number, dir: 1 | -1): number {
  const steps = [1, 2, 4];
  const i = steps.findIndex((s) => s >= v);
  const at = i < 0 ? steps.length - 1 : i;
  return steps[Math.max(0, Math.min(steps.length - 1, at + dir))];
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="You are the admiral, not the pilot" onClose={onClose}>
      <p>Your mining carrier's fleet works on its own. You shape how it behaves:</p>
      <ul>
        <li>
          <b>Hangars</b> are the board: buy ships into slots (drone 1, fighter 2, barge 4).
          Neighbours can trigger synergies, and each hangar has a launch order.
        </li>
        <li>
          <b>Doctrine</b>: stances for the whole fleet, per ship type and per hangar, plus rule
          cards: when these conditions hold, do that.
        </li>
        <li>
          <b>Logistics</b>: drones mine, barges park at rich clusters as depots, haulers shuttle ore
          home, the refinery turns ore into credits with energy. The slowest link sets your income.
        </li>
        <li>
          <b>Carrier</b>: warp outward for richer ore and tougher pirates, or back to safety. Ships
          outside at jump time are lost for good.
        </li>
        <li>
          <b>Research</b>: prestige resets the operation for research points that persist.
        </li>
      </ul>
      <h3>Glossary</h3>
      <dl className="glossary">
        <dt>Tiers</dt>
        <dd>
          Starter, Frontier and Deep space systems. {tierHint(2)} to unlock fighters, repair ships
          and more; Deep space is further out still.
        </dd>
        <dt>RP</dt>
        <dd>Research points. Only a Prestige pays them; they buy research and persist.</dd>
        <dt>Prestige</dt>
        <dd>Resets credits, ships and position for RP. Research and discoveries stay.</dd>
        <dt>Admiralty Marks</dt>
        <dd>Paid by an Admiralty reset, spent in the Admiralty shop (Research tab).</dd>
        <dt>Admiralty reset</dt>
        <dd>
          The bigger reset: also clears research and discovered systems. Marks and milestones stay.
        </dd>
      </dl>
      <p className="hint">
        Drag to orbit, scroll to zoom, right-drag to pan. Zoom far out (or press Tactical) for the
        sensor view. The game saves itself and keeps working at reduced rate while you are away.
      </p>
      <button onClick={onClose}>Take command</button>
    </Modal>
  );
}

function Offline() {
  useGame();
  const r = engine.offline;
  if (!r) return null;
  const h = Math.floor(r.seconds / 3600);
  const m = Math.floor((r.seconds % 3600) / 60);
  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>Welcome back, admiral</h2>
        <p>
          You were away for {h ? `${h} h ` : ''}
          {m} min. The fleet kept working the system safely at reduced rate and earned{' '}
          <b>{fmt(r.credits)} credits</b>.{r.rebuilt > 0 && ` Reserves rebuilt ${r.rebuilt} ships.`}
        </p>
        <button onClick={() => engine.dismissOffline()}>Resume</button>
      </div>
    </div>
  );
}

function downloadText(name: string, body: string) {
  downloadFile(name, body, 'text/plain');
}

async function downloadBackups() {
  const entries = await readBackups();
  if (entries.length === 0) return;
  const body =
    entries.length === 1
      ? entries[0].text
      : JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.key, entry.text])));
  downloadText(
    entries.length === 1 ? `${entries[0].key}.txt` : 'asteroid-fleet-save-backups.json',
    body,
  );
}

/** The primary save as it sits in storage, for when no backup could be written. */
async function downloadUnreadable() {
  const text = await readPrimaryText();
  if (text === null) return;
  downloadText('asteroid-fleet-unreadable-save.txt', text);
}

function SaveNotice() {
  useGame();
  if (!engine.saveNotice) return null;
  return (
    <div className="save-notice" role="alert">
      <p>{engine.saveNotice} Automatic saving is paused so that data is left untouched.</p>
      <div className="row">
        {engine.saveBackupFailed ? (
          <button onClick={() => void downloadUnreadable()}>Download unreadable save</button>
        ) : (
          <>
            <button onClick={() => engine.reset()}>Start new game (keeps backup)</button>
            <button onClick={() => void downloadBackups()}>Download backup</button>
          </>
        )}
      </div>
    </div>
  );
}

function Toasts({
  onOpenInbox,
}: {
  onOpenInbox: (dest: { carrier: 'all'; severity: 'critical' }) => void;
}) {
  useGame();
  // Expiry is a timestamp on the wall clock, so a toast still expires while the game is paused.
  // The queue's single timer asks for another render when one is due; reading the clock here
  // drops a toast on the next tick without a timer per toast.
  // The live region stays mounted so announcements are not lost on the empty-to-first transition.
  // oxlint-disable-next-line react/purity
  const items = engine.toasts.shown(Date.now());
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => {
        const system = t.systemId != null ? engine.state.systems[t.systemId]?.name : undefined;
        const openInbox = t.action?.type === 'open-inbox';
        return (
          <div
            key={t.key}
            className={`toast sev-${t.severity}`}
            role={t.severity === 'critical' ? 'alert' : undefined}
          >
            <span className="toast-text">{t.event ? formatEvent(t.event) : t.text}</span>
            {openInbox && (
              <button
                type="button"
                onClick={() => {
                  const dest = engine.openToastInbox(t.key);
                  if (dest) onOpenInbox(dest);
                }}
              >
                Open inbox
              </button>
            )}
            {t.carrierId !== null && (
              <button
                type="button"
                aria-label={system ? `Go to ${system}` : 'Go to'}
                onClick={() => engine.goToToast(t.key)}
              >
                Go to
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => engine.dismissToast(t.key)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => read('af-tab', 'fleet'));
  const [logCarrier, setLogCarrier] = useState<CarrierFilter>('all');
  const [logSeverity, setLogSeverity] = useState<SeverityFilter>('all');
  const [tactical, setTactical] = useState(false);
  const [autoTactical, setAutoTactical] = useState(false);
  const settings = useSettings();
  const [menu, setMenu] = useState(false);
  const [map, setMap] = useState(false);
  const [help, setHelp] = useState(() => read<string>('af-seen-help', '') !== '1');
  const [keysHelp, setKeysHelp] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useStackLayout();
  useEffect(() => write('af-tab', tab), [tab]);
  useHotkeys([
    {
      keys: [' '],
      label: 'Space',
      description: 'Pause or resume',
      group: 'Time',
      // A focused button already uses Space to activate itself.
      run: (e) => {
        if ((e.target as Element | null)?.closest?.('button, a, summary')) return false;
        engine.togglePause();
      },
    },
    {
      keys: ['+', '=', ']'],
      label: '+ / ]',
      description: 'Faster (1× → 2× → 4×)',
      group: 'Time',
      run: () => engine.setSpeed(stepSpeed(engine.speed, 1)),
    },
    {
      keys: ['-', '_', '['],
      label: '− / [',
      description: 'Slower',
      group: 'Time',
      run: () => engine.setSpeed(stepSpeed(engine.speed, -1)),
    },
    {
      keys: ['t'],
      label: 'T',
      description: 'Toggle tactical view',
      group: 'View',
      run: () => setTactical((v) => !v),
    },
    {
      keys: ['m'],
      label: 'M',
      description: 'Open or close the star map',
      group: 'View',
      run: () => setMap((v) => !v),
    },
    {
      keys: ['?'],
      label: '?',
      description: 'Show this list',
      group: 'General',
      run: () => setKeysHelp((v) => !v),
    },
  ]);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  }, [settings.uiScale]);
  const closeMenu = useCallback(() => setMenu(false), []);
  const openCriticalInbox = useCallback((dest: { carrier: 'all'; severity: 'critical' }) => {
    setTab('log');
    setCollapsed(false);
    setLogCarrier(dest.carrier);
    setLogSeverity(dest.severity);
  }, []);

  return (
    <div className="app" id="app-root" tabIndex={-1}>
      <div className="canvas-wrap">
        <SceneBoundary>
          <Suspense fallback={null}>
            <Scene
              tactical={tactical}
              quality={settings.quality}
              bloom={settings.bloom}
              fpsCap={settings.fpsCap}
              onAutoTactical={setAutoTactical}
            />
          </Suspense>
        </SceneBoundary>
      </div>
      <Hud
        tactical={tactical}
        autoTactical={autoTactical}
        quality={settings.quality}
        onTactical={() => setTactical((v) => !v)}
        onQuality={() => {
          const quality = settings.quality === 'high' ? 'low' : 'high';
          updateSettings({ quality });
          engine.notify(`Quality: ${quality === 'high' ? 'High' : 'Low'}`);
        }}
        onMap={() => setMap(true)}
      />
      <CarrierBar />
      <GearButton onClick={() => setMenu(true)} />
      <div className={`side ${collapsed ? 'collapsed' : ''}`}>
        <div className="tabs">
          <Tabs
            tabs={TABS}
            value={tab}
            idPrefix="side-tab"
            label="Panels"
            controls={collapsed ? undefined : 'side-panel'}
            highlight={!collapsed}
            onSelect={(id) => {
              setTab(id);
              setCollapsed(false);
            }}
          />
          <button
            className="collapse-btn"
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : 'side-panel'}
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? '▾' : '▴'}
          </button>
        </div>
        {!collapsed && (
          <div
            className="panel-body"
            id="side-panel"
            role="tabpanel"
            aria-labelledby={`side-tab-${tab}`}
          >
            {tab === 'fleet' && <FleetPanel />}
            {tab === 'doctrine' && (
              <Suspense fallback={null}>
                <DoctrinePanel />
              </Suspense>
            )}
            {tab === 'carrier' && (
              <Suspense fallback={null}>
                <CarrierPanel />
              </Suspense>
            )}
            {tab === 'research' && (
              <Suspense fallback={null}>
                <ResearchPanel />
              </Suspense>
            )}
            {tab === 'log' && (
              <LogPanel
                carrier={logCarrier}
                onCarrier={setLogCarrier}
                severity={logSeverity}
                onSeverity={setLogSeverity}
              />
            )}
          </div>
        )}
      </div>
      <div className="legend">
        {SHIP_CLASSES.map((c) => (
          <span key={c}>
            <i
              className={`swatch shape-${ICON_SHAPE[c]}`}
              style={{ background: SHIP_STATS[c].color }}
            />
            {SHIP_STATS[c].name}
          </span>
        ))}
        {(
          [
            ['Pirate', 'pirate'],
            ['Carrier', 'carrier'],
            ['Container', 'container'],
            ['Hazard', 'hazard'],
          ] as const
        ).map(([name, k]) => (
          <span key={k}>
            <i className={`swatch shape-${ICON_SHAPE[k]}`} style={{ background: PALETTE[k] }} />
            {name}
          </span>
        ))}
      </div>
      <SaveNotice />
      <Toasts onOpenInbox={openCriticalInbox} />
      <Offline />
      {menu && (
        <Suspense fallback={null}>
          <SettingsMenu
            onClose={closeMenu}
            onHelp={() => {
              setMenu(false);
              setHelp(true);
            }}
          />
        </Suspense>
      )}
      {map && (
        <Suspense
          fallback={
            <div className="modal-bg" role="status">
              <div className="modal">Loading star map…</div>
            </div>
          }
        >
          <StarMap onClose={() => setMap(false)} />
        </Suspense>
      )}
      {keysHelp && <HotkeyHelp onClose={() => setKeysHelp(false)} />}
      {help && (
        <Help
          onClose={() => {
            setHelp(false);
            write('af-seen-help', '1');
          }}
        />
      )}
    </div>
  );
}
