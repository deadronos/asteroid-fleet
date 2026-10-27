import { describe, expect, it } from 'vitest';
import { SHIP_STATS } from '../sim/config';
import { SHIP_CLASSES } from '../sim/types';
import { ICON_SHAPE, SHAPES } from './palette';

describe('tactical palette (#125)', () => {
  it('gives every ship class, pirate and map entity a known shape', () => {
    for (const k of [...SHIP_CLASSES, 'pirate', 'carrier', 'container', 'hazard', 'vein'])
      expect(SHAPES).toContain(ICON_SHAPE[k]);
  });
  it('never gives two ship classes the same colour and shape', () => {
    const seen = new Set(SHIP_CLASSES.map((c) => `${SHIP_STATS[c].color}/${ICON_SHAPE[c]}`));
    expect(seen.size).toBe(SHIP_CLASSES.length);
  });
  it('keeps ship colours unique', () => {
    expect(new Set(SHIP_CLASSES.map((c) => SHIP_STATS[c].color)).size).toBe(SHIP_CLASSES.length);
  });
});
