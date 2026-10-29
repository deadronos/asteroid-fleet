import type { CarrierBrief } from '../game/snapshot';

/**
 * Every carrier in the run. After the first worker snapshot `engine.state.ops` holds only the
 * focused operation, so the list comes from the briefs; the ops stand in before one arrives (#178).
 */
export function carrierRoster(
  briefs: readonly CarrierBrief[],
  ops: readonly { id: number; systemId: number; hangars: readonly { id: number }[] }[],
): { id: number; systemId: number; hangars: number[] }[] {
  if (briefs.length > 0) return [...briefs];
  return ops.map((op) => ({
    id: op.id,
    systemId: op.systemId,
    hangars: op.hangars.map((h) => h.id),
  }));
}

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
