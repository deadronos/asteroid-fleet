import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { engine, useGame } from '../game/engine';
import { readBackups, readPrimaryText } from '../game/save';
import { updateSettings, useSettings } from '../game/settings';
import { setActiveSlot } from '../game/slots';
import { SHIP_STATS } from '../sim/config';
import { SHIP_CLASSES } from '../sim/types';
import { downloadFile } from './download';
import { deepEqual, shallowEqual } from './equal';
import { formatEvent } from './events';
import { type CarrierFilter, type SeverityFilter } from './inbox';
import { LogPanel } from './LogPanel';
import { SceneBoundary } from './ErrorBoundary';
import { FleetPanel } from './FleetPanel';
import { CarrierBar } from './CarrierBar';
import { useHotkeys } from './hotkeys';
import { HotkeyHelp } from './HotkeyHelp';
import { Hud } from './Hud';
import { useStackLayout } from './layout';
import { fmt } from './format';
import { GearButton } from './GearButton';
import { leaveTactical } from '../render/focus';
import { Modal } from './Modal';
import { Tabs } from './Tabs';
import { ICON_SHAPE, PALETTE } from './palette';

// Not needed for the first frame: the scene (three.js + r3f), the research tree
// and the settings menu load as separate chunks right after first paint.
const Scene = lazy(() => import('../render/Scene').then((m) => ({ default: m.Scene })));
const loadCarrier = () => import('./CarrierPanel').then((m) => ({ default: m.CarrierPanel }));
const loadDoctrine = () => import('./DoctrinePanel').then((m) => ({ default: m.DoctrinePanel }));
const loadResearch = () => import('./ResearchPanel').then((m) => ({ default: m.ResearchPanel }));
const loadSettings = () => import('./Settings').then((m) => ({ default: m.SettingsMenu }));
const loadGuide = () => import('./Guide').then((m) => ({ default: m.Guide }));
const CarrierPanel = lazy(loadCarrier);
const DoctrinePanel = lazy(loadDoctrine);
const ResearchPanel = lazy(loadResearch);
const SettingsMenu = lazy(loadSettings);
const Guide = lazy(loadGuide);
const loadStarMap = () => import('./StarMap').then((m) => ({ default: m.StarMap }));
const StarMap = lazy(loadStarMap);

// Warm the secondary chunks once the browser is idle so opening them doesn't pop in.
const whenIdle = (fn: () => void) =>
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(fn, { timeout: 2000 })
    : setTimeout(fn, 2000);
whenIdle(() => {
  void loadCarrier();
  void loadDoctrine();
  void loadResearch();
  void loadSettings();
  void loadGuide();
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

/** Next preset speed up or down from `v`, clamped to 1×–4×. */
export function stepSpeed(v: number, dir: 1 | -1): number {
  const steps = [1, 2, 4];
  const i = steps.findIndex((s) => s >= v);
  const at = i < 0 ? steps.length - 1 : i;
  return steps[Math.max(0, Math.min(steps.length - 1, at + dir))];
}

/** A short first-run card. The full guide is one click away and lives in Settings/Help (#247). */
function Launch({ onClose, onGuide }: { onClose: () => void; onGuide: () => void }) {
  return (
    <Modal title="You are the admiral, not the pilot" onClose={onClose}>
      <p>Your fleet works on its own. You shape where it goes and how it behaves.</p>
      <ul>
        <li>
          <b>Hangars</b> hold your ships. Buy drones, then barges and haulers to bring ore home.
        </li>
        <li>
          <b>Doctrine</b> sets stances and rule cards: when a condition holds, do an action.
        </li>
        <li>
          <b>Carrier</b> warps outward for richer ore and tougher pirates. Research survives a
          prestige reset.
        </li>
      </ul>
      <div className="row">
        <button onClick={onClose}>Take command</button>
        <button onClick={onGuide}>Full guide</button>
      </div>
    </Modal>
  );
}

function Offline() {
  const r = useGame(() => engine.offline, shallowEqual);
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

export function SaveNotice() {
  const notice = useGame(
    () =>
      engine.saveNotice ? { text: engine.saveNotice, backupFailed: engine.saveBackupFailed } : null,
    shallowEqual,
  );
  if (!notice) return null;
  return (
    <div className="save-notice" role="alert">
      <p>{notice.text} Automatic saving is paused so that data is left untouched.</p>
      <div className="row">
        {notice.backupFailed ? (
          <button onClick={() => void downloadUnreadable()}>Download unreadable save</button>
        ) : (
          <>
            <button
              onClick={() => {
                // Like the Settings reset: the new game must not be copied into a slot (#172).
                setActiveSlot(null);
                engine.reset();
              }}
            >
              Start new game (keeps backup)
            </button>
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
  // Expiry is a timestamp on the wall clock, so a toast still expires while the game is paused.
  // The queue's single timer asks for another render when one is due; reading the clock in the
  // selector drops a toast on the next tick without a timer per toast.
  // The live region stays mounted so announcements are not lost on the empty-to-first transition.
  const items = useGame(
    (s) =>
      engine.toasts.shown(Date.now()).map((t) => ({
        key: t.key,
        severity: t.severity,
        text: t.event ? formatEvent(t.event) : t.text,
        openInbox: t.action?.type === 'open-inbox',
        carrierId: t.carrierId,
        system: t.systemId != null ? s.systems[t.systemId]?.name : undefined,
      })),
    deepEqual,
  );
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.key}
          className={`toast sev-${t.severity}`}
          role={t.severity === 'critical' ? 'alert' : undefined}
        >
          <span className="toast-text">{t.text}</span>
          {t.openInbox && (
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
              aria-label={t.system ? `Go to ${t.system}` : 'Go to'}
              onClick={() => engine.goToToast(t.key)}
            >
              Go to
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => engine.dismissToast(t.key)}>
            ×
          </button>
        </div>
      ))}
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
  const [launch, setLaunch] = useState(() => read<string>('af-seen-help', '') !== '1');
  const [help, setHelp] = useState(false);
  const [keysHelp, setKeysHelp] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // While auto-tactical is on the button already shows "on", so a click leaves tactical instead.
  const toggleTactical = () => {
    if (autoTactical) {
      setTactical(false);
      leaveTactical();
    } else setTactical((v) => !v);
  };

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
      run: () => toggleTactical(),
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
        onTactical={toggleTactical}
        onQuality={() => {
          const quality = settings.quality === 'high' ? 'low' : 'high';
          updateSettings({ quality });
          engine.notify(`Quality: ${quality === 'high' ? 'High' : 'Low'}`);
        }}
        onMap={() => setMap(true)}
        onMapIntent={() => void loadStarMap()}
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
      {keysHelp && (
        <HotkeyHelp
          onClose={() => setKeysHelp(false)}
          onHelp={() => {
            setKeysHelp(false);
            setHelp(true);
          }}
        />
      )}
      {help && (
        <Suspense fallback={null}>
          <Guide onClose={() => setHelp(false)} />
        </Suspense>
      )}
      {launch && (
        <Launch
          onClose={() => {
            setLaunch(false);
            write('af-seen-help', '1');
          }}
          onGuide={() => {
            setLaunch(false);
            write('af-seen-help', '1');
            setHelp(true);
          }}
        />
      )}
    </div>
  );
}
