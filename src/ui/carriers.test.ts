import { describe, expect, it } from 'vitest';
import type { CarrierBrief } from '../game/snapshot';
import { carrierForKey, ignoresHotkey } from './carriers';

const c = (id: number): CarrierBrief => ({
  id,
  systemId: 0,
  hull: 1,
  energy: 0,
  maxEnergy: 1,
  income: 0,
});

describe('carrier hotkeys', () => {
  it('maps digits to carriers in order', () => {
    const list = [c(4), c(7)];
    expect(carrierForKey('1', list)).toBe(4);
    expect(carrierForKey('2', list)).toBe(7);
  });
  it('ignores empty slots, zero and other keys', () => {
    expect(carrierForKey('3', [c(4)])).toBeNull();
    expect(carrierForKey('0', [c(4)])).toBeNull();
    expect(carrierForKey('a', [c(4)])).toBeNull();
  });
  it('ignores modified keys and text fields', () => {
    const base = { ctrlKey: false, metaKey: false, altKey: false, target: null };
    expect(ignoresHotkey(base)).toBe(false);
    expect(ignoresHotkey({ ...base, metaKey: true })).toBe(true);
    expect(ignoresHotkey({ ...base, target: { tagName: 'INPUT' } as unknown as EventTarget })).toBe(
      true,
    );
  });
});
