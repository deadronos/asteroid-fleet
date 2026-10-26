import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { engine, useGame } from '../game/engine';
import { readBackups, readPrimaryText } from '../game/save';
import { updateSettings, useSettings } from '../game/settings';
import { SHIP_STATS } from '../sim/config';
import { SHIP_CLASSES } from '../sim/types';
import { CarrierPanel } from './CarrierPanel';
import { DoctrinePanel } from './DoctrinePanel';
import { downloadFile } from './download';
import { formatEvent, toneClass } from './events';
import { SceneBoundary } from './ErrorBoundary';
import { FleetPanel } from './FleetPanel';
import { Hud } from './Hud';
import { fmt } from './format';
import { GearButton } from './GearButton';

// Not needed for the first frame: the scene (three.js + r3f), the research tree
// and the settings menu load as separate chunks right after first paint.
const Scene = lazy(() => import('../render/Scene').then((m) => ({ default: m.Scene })));
const loadResearch = () => import('./ResearchPanel').then((m) => ({ default: m.ResearchPanel }));
const loadSettings = () => import('./Settings').then((m) => ({ default: m.SettingsMenu }));
const ResearchPanel = lazy(loadResearch);
const SettingsMenu = lazy(loadSettings);

// Warm the secondary chunks once the browser is idle so opening them doesn't pop in.
const whenIdle = (fn: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(fn, 2000);
whenIdle(() => {
  void loadResearch();
  void loadSettings();
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

function LogPanel() {
  const s = useGame();
  const st = s.stats;
  return (
    <>
      <h3>This run</h3>
      <p className="hint">
        {fmt(st.oreValueDelivered)} ore value delivered · {fmt(st.creditsEarned)} credits earned ·{' '}
        {st.piratesKilled} pirates destroyed · {st.shipsLost} ships lost · prestige ×
        {s.lifetime.prestiges}
      </p>
      <h3>Event log</h3>
      <div className="log">
        {s.log.map((l, i) => (
          <div key={i} className={toneClass(l.severity)}>
            <span className="t">{new Date(l.t * 1000).toISOString().slice(11, 19)}</span>
            {formatEvent(l)}
          </div>
        ))}
      </div>
    </>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>You are the admiral, not the pilot</h2>
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
            <b>Logistics</b>: drones mine, barges park at rich clusters as depots, haulers shuttle
            ore home, the refinery turns ore into credits with energy. The slowest link sets your
            income.
          </li>
          <li>
            <b>Carrier</b>: warp outward for richer ore and tougher pirates, or back to safety.
            Ships outside at jump time are lost for good.
          </li>
          <li>
            <b>Research</b>: prestige resets the operation for research points that persist.
          </li>
        </ul>
        <p className="hint">
          Drag to orbit, scroll to zoom, right-drag to pan. Zoom far out (or press Tactical) for the
          sensor view. The game saves itself and keeps working at reduced rate while you are away.
        </p>
        <button onClick={onClose}>Take command</button>
      </div>
    </div>
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

function Toast() {
  useGame();
  const t = engine.toast;
  // The engine re-renders every tick, so reading the clock here hides the toast on time.
  // oxlint-disable-next-line react/purity
  if (!t || Date.now() - t.at > 2500) return null;
  return <div className="toast">{t.text}</div>;
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => read('af-tab', 'fleet'));
  const [tactical, setTactical] = useState(false);
  const [autoTactical, setAutoTactical] = useState(false);
  const settings = useSettings();
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(() => read<string>('af-seen-help', '') !== '1');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => write('af-tab', tab), [tab]);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  }, [settings.uiScale]);
  const closeMenu = useCallback(() => setMenu(false), []);

  return (
    <div className="app">
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
        onQuality={() => updateSettings({ quality: settings.quality === 'high' ? 'low' : 'high' })}
      />
      <GearButton onClick={() => setMenu(true)} />
      <div className={`side ${collapsed ? 'collapsed' : ''}`}>
        <div className="tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={tab === id && !collapsed ? 'on' : ''}
              onClick={() => {
                if (tab === id) setCollapsed((c) => !c);
                else {
                  setTab(id);
                  setCollapsed(false);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!collapsed && (
          <div className="panel-body">
            {tab === 'fleet' && <FleetPanel />}
            {tab === 'doctrine' && <DoctrinePanel />}
            {tab === 'carrier' && <CarrierPanel />}
            {tab === 'research' && (
              <Suspense fallback={null}>
                <ResearchPanel />
              </Suspense>
            )}
            {tab === 'log' && <LogPanel />}
          </div>
        )}
      </div>
      <div className="legend">
        {SHIP_CLASSES.map((c) => (
          <span key={c}>
            <i className="swatch" style={{ background: SHIP_STATS[c].color }} />
            {SHIP_STATS[c].name}
          </span>
        ))}
        <span>
          <i className="swatch" style={{ background: '#ff3b3b' }} />
          Pirate
        </span>
      </div>
      <SaveNotice />
      <Toast />
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
