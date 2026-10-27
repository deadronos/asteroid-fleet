import type { CarrierBrief } from '../game/snapshot';

/** Carriers with hotkeys 1–9. */
export const HOTKEYS = 9;

/** The carrier a digit key selects, or null for any other key or an empty slot. */
export function carrierForKey(key: string, carriers: readonly CarrierBrief[]): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const i = Number(key) - 1;
  return i < HOTKEYS ? (carriers[i]?.id ?? null) : null;
}

/** True when the key press belongs to a text field or carries a modifier. */
export function ignoresHotkey(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t?.isContentEditable;
}
