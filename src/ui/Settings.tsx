import { useState, type ReactNode } from 'react';
import { engine } from '../game/engine';
import {
  SAVE_BACKUP_FAILED_NOTICE,
  SAVE_BACKUP_NOTICE,
  decodeSave,
  exportSave,
  exportSaveFile,
  saveOverwriteBlocked,
} from '../game/save';
import { FPS_CAPS, UI_SCALES, updateSettings, useSettings } from '../game/settings';
import {
  deleteSlot,
  getActiveSlot,
  listSlots,
  readSlot,
  setActiveSlot,
  writeSlot,
  type SlotInfo,
} from '../game/slots';
import type { GameState } from '../sim/types';
import { downloadFile } from './download';
import { Modal } from './Modal';
import { Tabs } from './Tabs';

type Tab = 'ui' | 'visuals' | 'audio' | 'saves';
const TABS: [Tab, string][] = [
  ['ui', 'UI'],
  ['visuals', 'Visuals'],
  ['audio', 'Audio'],
  ['saves', 'Save Management'],
];

export function GearButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="gear" onClick={onClick} aria-label="Settings" title="Settings">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
          transform="translate(-1 0)"
        />
      </svg>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function UiTab({ onHelp }: { onHelp: () => void }) {
  const s = useSettings();
  return (
    <>
      <Field label="UI scale">
        <select
          value={s.uiScale}
          onChange={(e) => updateSettings({ uiScale: Number(e.target.value) })}
        >
          {UI_SCALES.map((v) => (
            <option key={v} value={v}>
              {Math.round(v * 100)}%
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <button onClick={onHelp}>How to play</button>
      </div>
    </>
  );
}

function VisualsTab() {
  const s = useSettings();
  return (
    <>
      <Field label="Quality">
        <select
          value={s.quality}
          onChange={(e) => updateSettings({ quality: e.target.value === 'low' ? 'low' : 'high' })}
        >
          <option value="high">High</option>
          <option value="low">Low (no post effects, capped resolution and frame rate)</option>
        </select>
      </Field>
      <Field label="Bloom">
        <input
          type="checkbox"
          checked={s.bloom}
          disabled={s.quality === 'low'}
          onChange={(e) => updateSettings({ bloom: e.target.checked })}
        />
      </Field>
      <Field label="Frame-rate cap (low quality)">
        <select
          value={s.fpsCap}
          disabled={s.quality === 'high'}
          onChange={(e) => updateSettings({ fpsCap: Number(e.target.value) })}
        >
          {FPS_CAPS.map((v) => (
            <option key={v} value={v}>
              {v ? `${v} fps` : 'Uncapped'}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function Volume({ label, k }: { label: string; k: 'masterVolume' | 'musicVolume' | 'sfxVolume' }) {
  const s = useSettings();
  return (
    <Field label={`${label} · ${Math.round(s[k] * 100)}%`}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={s[k]}
        onChange={(e) => updateSettings({ [k]: Number(e.target.value) })}
      />
    </Field>
  );
}

function AudioTab() {
  return (
    <>
      <p className="hint">The game has no sound yet. These levels are kept for when it does.</p>
      <Volume label="Master" k="masterVolume" />
      <Volume label="Music" k="musicVolume" />
      <Volume label="Effects" k="sfxVolume" />
    </>
  );
}

function slotStatus(info: SlotInfo): string {
  if (info.empty) return 'Empty';
  if ('error' in info) return `Unreadable: ${info.error}`;
  return `${new Date(info.savedAt).toLocaleString()} · ${info.summary}`;
}

function download(name: string, body: string) {
  downloadFile(name, body, 'application/json');
}

/** Replacing the live game loses it unless it is in a slot; say so, and warn about an unbacked-up save. */
export function confirmReplace(what: string): boolean {
  const lost = engine.saveBackupFailed
    ? ' The unreadable save could not be backed up and will be lost.'
    : ' Your current game is replaced unless it is saved in a slot.';
  return confirm(`${what}${lost}`);
}

function SavesTab() {
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [mode, setMode] = useState<'none' | 'export' | 'import'>('none');
  const [text, setText] = useState('');
  const slots = listSlots();
  const active = getActiveSlot();

  const adopt = (state: GameState, note: string) => {
    engine.replace(state);
    setMsg({ text: note });
    refresh();
  };

  const tryImport = (source: string) => {
    const decoded = decodeSave(source);
    if (!decoded.ok) {
      setMsg({ text: decoded.error, bad: true });
      return;
    }
    if (!confirmReplace('Import this save?')) return;
    setActiveSlot(null);
    adopt(decoded.state, 'Save imported.');
    setText('');
    setMode('none');
  };

  return (
    <>
      <h3>Slots</h3>
      <div className="save-slots">
        {slots.map((info) => (
          <div key={info.slot} className={`save-slot ${active === info.slot ? 'active' : ''}`}>
            <div className="save-slot-head">
              <b>Slot {info.slot}</b>
              {active === info.slot && <span className="tag">active</span>}
            </div>
            <div className="hint">{slotStatus(info)}</div>
            <div className="row">
              <button
                disabled={info.empty || 'error' in info}
                onClick={() => {
                  const read = readSlot(info.slot);
                  if (!read?.ok) return;
                  if (!confirmReplace(`Load slot ${info.slot}?`)) return;
                  setActiveSlot(info.slot);
                  adopt(read.state, `Loaded slot ${info.slot}.`);
                }}
              >
                Load
              </button>
              <button
                onClick={async () => {
                  if (!info.empty && !confirm(`Overwrite slot ${info.slot}?`)) return;
                  const state = await engine.fullState();
                  state.savedAt = Date.now();
                  if (!writeSlot(info.slot, state)) {
                    setMsg({ text: 'Could not write to browser storage.', bad: true });
                    return;
                  }
                  setActiveSlot(info.slot);
                  setMsg({ text: `Saved to slot ${info.slot}.` });
                  refresh();
                }}
              >
                Save here
              </button>
              <button
                disabled={info.empty}
                onClick={() => {
                  if (!confirm(`Delete slot ${info.slot}? This cannot be undone.`)) return;
                  deleteSlot(info.slot);
                  setMsg({ text: `Deleted slot ${info.slot}.` });
                  refresh();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="hint">The active slot is updated whenever the game autosaves.</p>

      <h3>Export / import</h3>
      <div className="row">
        <button
          onClick={async () =>
            download(
              `asteroid-fleet-${new Date().toISOString().slice(0, 10)}.json`,
              exportSaveFile(await engine.fullState()),
            )
          }
        >
          Export file
        </button>
        <button
          className={mode === 'export' ? 'on' : ''}
          onClick={async () => {
            setText(exportSave(await engine.fullState()));
            setMode('export');
          }}
        >
          Export text
        </button>
        <label className="button">
          Import file
          <input
            type="file"
            accept=".json,.txt,application/json,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              file
                .text()
                .then(tryImport, () => setMsg({ text: 'Could not read that file.', bad: true }));
            }}
          />
        </label>
        <button
          className={mode === 'import' ? 'on' : ''}
          onClick={() => {
            setText('');
            setMode('import');
          }}
        >
          Import text
        </button>
      </div>
      {mode === 'export' && (
        <>
          <textarea readOnly value={text} onFocus={(e) => e.target.select()} />
          <button
            onClick={() =>
              navigator.clipboard.writeText(text).then(
                () => setMsg({ text: 'Copied to clipboard.' }),
                () => setMsg({ text: 'Copy failed; select the text and copy it.', bad: true }),
              )
            }
          >
            Copy
          </button>
        </>
      )}
      {mode === 'import' && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste an exported save here."
          />
          <button onClick={() => tryImport(text)}>Import</button>
        </>
      )}

      <h3>Danger zone</h3>
      <div className="row">
        <button
          onClick={async () => {
            if (saveOverwriteBlocked()) {
              setMsg({
                text: `${engine.saveBackupFailed ? SAVE_BACKUP_FAILED_NOTICE : SAVE_BACKUP_NOTICE} It was not overwritten.`,
                bad: true,
              });
              return;
            }
            setMsg({ text: 'Saving…' });
            // "Saved." only once storage holds it, so a reload right after keeps it.
            if (await engine.save()) setMsg({ text: 'Saved.' });
            else setMsg({ text: 'Save failed: storage is unavailable.', bad: true });
          }}
        >
          Save now
        </button>
        <button
          onClick={() => {
            const question = !saveOverwriteBlocked()
              ? 'Wipe everything, including research? Save slots are kept.'
              : engine.saveBackupFailed
                ? 'Start a new game? The unreadable save could not be backed up and will be lost.'
                : 'Start a new game? The unreadable save stays in its backup, and the primary slot will be replaced.';
            if (!confirm(question)) return;
            setActiveSlot(null);
            engine.reset();
            setMsg({ text: 'New game started.' });
            refresh();
          }}
        >
          Hard reset
        </button>
      </div>
      {msg && (
        <p className={`hint ${msg.bad ? 'tone-bad' : ''}`} role="status">
          {msg.text}
        </p>
      )}
    </>
  );
}

export function SettingsMenu({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const [tab, setTab] = useState<Tab>('ui');
  return (
    <Modal title="Settings" className="settings" onClose={onClose}>
      <div className="tabs">
        <Tabs
          tabs={TABS}
          value={tab}
          onSelect={setTab}
          idPrefix="settings-tab"
          label="Settings sections"
        />
      </div>
      <div className="settings-body">
        {tab === 'ui' && <UiTab onHelp={onHelp} />}
        {tab === 'visuals' && <VisualsTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'saves' && <SavesTab />}
      </div>
    </Modal>
  );
}
