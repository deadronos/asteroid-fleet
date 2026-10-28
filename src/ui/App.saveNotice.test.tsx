// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../game/engine';
import { ACTIVE_SLOT_KEY, slotKey } from '../game/slots';
import { newGame } from '../sim/state';
import { SaveNotice } from './App';
import { click, mount } from './testUtils';

vi.mock('idb-keyval', () => ({
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
  entries: async () => [],
}));

afterEach(() => {
  engine.saveNotice = null;
  localStorage.clear();
});

describe('unreadable-save notice (#172)', () => {
  it('"Start new game" leaves the active save slot untouched', async () => {
    const kept = JSON.stringify(newGame(5));
    localStorage.setItem(slotKey(2), kept);
    localStorage.setItem(ACTIVE_SLOT_KEY, '2');
    engine.saveNotice = 'Your save could not be loaded.';
    const m = await mount(<SaveNotice />, newGame(1));
    await click(m.button(/Start new game/)!);
    expect(localStorage.getItem(slotKey(2))).toBe(kept);
    expect(localStorage.getItem(ACTIVE_SLOT_KEY)).toBeNull();
    await m.cleanup();
  });
});
