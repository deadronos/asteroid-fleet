import { focusOp } from '../sim/state';
import type { GameState } from '../sim/types';
import { decodeSave, type DecodeResult } from './save';

/** Manual save slots, separate from the autosaved primary save. */
export const SLOT_COUNT = 3;
export const SLOT_KEY_PREFIX = 'asteroid-fleet-slot-';
export const ACTIVE_SLOT_KEY = 'asteroid-fleet-active-slot';

export type SlotInfo =
  | { slot: number; empty: true }
  | { slot: number; empty: false; savedAt: number; summary: string }
  | { slot: number; empty: false; error: string };

type SlotStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): SlotStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function slotKey(slot: number): string {
  return `${SLOT_KEY_PREFIX}${slot}`;
}

function isSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT;
}

export function summarize(state: GameState): string {
  const system = state.systems[focusOp(state).systemId]?.name ?? 'Unknown system';
  const credits = Math.floor(state.credits).toLocaleString('en-US');
  const ships = state.ops.reduce((n, op) => n + op.ships.length, 0);
  return `${system} · ${credits} credits · ${ships} ships · prestige ×${state.lifetime.prestiges}`;
}

/** Slot text is plain JSON, so it decodes (and migrates) the same way as a save file. */
export function readSlot(slot: number, store = storage()): DecodeResult | null {
  if (!isSlot(slot) || !store) return null;
  let text: string | null;
  try {
    text = store.getItem(slotKey(slot));
  } catch {
    return null;
  }
  return text === null ? null : decodeSave(text);
}

export function slotInfo(slot: number, store = storage()): SlotInfo {
  const read = readSlot(slot, store);
  if (!read) return { slot, empty: true };
  if (!read.ok) return { slot, empty: false, error: read.error };
  return { slot, empty: false, savedAt: read.state.savedAt, summary: summarize(read.state) };
}

export function listSlots(store = storage()): SlotInfo[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => slotInfo(i + 1, store));
}

export function writeSlot(slot: number, state: GameState, store = storage()): boolean {
  if (!isSlot(slot) || !store) return false;
  const json = JSON.stringify(state);
  try {
    store.setItem(slotKey(slot), json);
    return store.getItem(slotKey(slot)) === json;
  } catch {
    return false;
  }
}

export function deleteSlot(slot: number, store = storage()): void {
  if (!isSlot(slot) || !store) return;
  try {
    store.removeItem(slotKey(slot));
    if (getActiveSlot(store) === slot) store.removeItem(ACTIVE_SLOT_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The slot autosave also writes to, set when the player loads or saves a slot. */
export function getActiveSlot(store = storage()): number | null {
  try {
    const slot = Number(store?.getItem(ACTIVE_SLOT_KEY));
    return isSlot(slot) ? slot : null;
  } catch {
    return null;
  }
}

export function setActiveSlot(slot: number | null, store = storage()): void {
  try {
    if (slot === null || !isSlot(slot)) store?.removeItem(ACTIVE_SLOT_KEY);
    else store?.setItem(ACTIVE_SLOT_KEY, String(slot));
  } catch {
    /* storage blocked */
  }
}
