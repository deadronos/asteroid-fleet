import { useEffect, useRef } from 'react';
import { ignoresHotkey } from './carriers';

export interface Hotkey {
  /** `KeyboardEvent.key` values that trigger it; single letters match either case. */
  keys: string[];
  /** Shown in the help overlay and tooltips, e.g. "Space" or "1–9". Omit to hide it from help. */
  label?: string;
  description?: string;
  group?: string;
  /** Higher runs first; ties go to the most recently registered. Modals use {@link MODAL_PRIORITY}. */
  priority?: number;
  /** Fire even while a text field has focus (modal Escape). */
  allowInInput?: boolean;
  /** Return false to decline the key so lower-priority bindings can take it. */
  run: (e: KeyboardEvent) => boolean | void;
}

export const MODAL_PRIORITY = 100;

interface Entry {
  hotkey: Hotkey;
  seq: number;
}

const entries = new Set<Entry>();
const listeners = new Set<() => void>();
let seq = 0;
let installed = false;

const norm = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

/** The single keydown handler: matching bindings run in priority order until one accepts the key. */
export function dispatchHotkey(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const key = norm(e.key);
  const blocked = ignoresHotkey(e);
  const hits = [...entries]
    .filter(({ hotkey }) => hotkey.keys.some((k) => norm(k) === key))
    .filter(
      ({ hotkey }) => !blocked || (hotkey.allowInInput && !e.ctrlKey && !e.metaKey && !e.altKey),
    )
    .sort((a, b) => (b.hotkey.priority ?? 0) - (a.hotkey.priority ?? 0) || b.seq - a.seq);
  for (const { hotkey } of hits) {
    if (hotkey.run(e) === false) continue;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
}

function notify() {
  listeners.forEach((l) => l());
}

/** Adds bindings; returns the remover. The window listener exists only while something is registered. */
export function registerHotkeys(list: Hotkey[]): () => void {
  const added = list.map((hotkey) => ({ hotkey, seq: seq++ }));
  added.forEach((x) => entries.add(x));
  if (!installed) {
    window.addEventListener('keydown', dispatchHotkey);
    installed = true;
  }
  notify();
  return () => {
    added.forEach((x) => entries.delete(x));
    if (entries.size === 0 && installed) {
      window.removeEventListener('keydown', dispatchHotkey);
      installed = false;
    }
    notify();
  };
}

/** Documented bindings, de-duplicated by label, for the help overlay. */
export function listHotkeys(): {
  group: string;
  label: string;
  description: string;
}[] {
  const seen = new Set<string>();
  const out: { group: string; label: string; description: string }[] = [];
  for (const { hotkey } of entries) {
    if (!hotkey.label || !hotkey.description || seen.has(hotkey.label)) continue;
    seen.add(hotkey.label);
    out.push({
      group: hotkey.group ?? 'General',
      label: hotkey.label,
      description: hotkey.description,
    });
  }
  return out;
}

export function subscribeHotkeys(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Registers bindings for the component's lifetime; handlers may close over fresh state. */
export function useHotkeys(list: Hotkey[]): void {
  const ref = useRef(list);
  useEffect(() => {
    ref.current = list;
  });
  useEffect(
    () =>
      registerHotkeys(
        list.map((h, i) => ({
          ...h,
          run: (e: KeyboardEvent) => ref.current[i].run(e),
        })),
      ),
    // Bindings are static in shape; only their closures change, which `ref` covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
