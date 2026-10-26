import { describe, expect, it } from 'vitest';
import { order } from './actions';
import { HANGAR_SLOT_COST, NEW_HANGAR_COST } from './config';
import { game } from './testing';

describe('hangar growth has no hard cap', () => {
  it('slot and hangar costs rise steeply and monotonically past the old maxima', () => {
    for (let n = 6; n < 40; n++) {
      expect(HANGAR_SLOT_COST(n + 1)).toBeGreaterThan(HANGAR_SLOT_COST(n));
    }
    for (let n = 2; n < 15; n++) {
      expect(NEW_HANGAR_COST(n + 1)).toBeGreaterThan(NEW_HANGAR_COST(n));
    }
    expect(HANGAR_SLOT_COST(13) / HANGAR_SLOT_COST(12)).toBeGreaterThan(1.45);
    expect(NEW_HANGAR_COST(6) / NEW_HANGAR_COST(5)).toBeGreaterThan(3);
  });

  it('keeps the old curve below the old maxima', () => {
    expect(HANGAR_SLOT_COST(6)).toBe(120);
    expect(NEW_HANGAR_COST(2)).toBe(1500);
  });

  it('lets a rich player buy past 12 slots and 5 hangars', () => {
    const s = game(1);
    s.credits = 1e15;
    s.stats.furthestTier = 9;
    const h = s.hangars[0];
    h.slots = 12;
    expect(order(s, { type: 'buySlot', hangarId: h.id })).toBeNull();
    expect(h.slots).toBe(13);
    while (s.hangars.length < 6) {
      expect(order(s, { type: 'buyHangar', hangarType: s.hangars[0].type })).toBeNull();
    }
    expect(s.hangars.length).toBe(6);
  });
});
