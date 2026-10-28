import { describe, expect, it } from 'vitest';
import { panelShift } from './viewOffset';

describe('panelShift', () => {
  it('centres the view in the space right of an open left panel', () => {
    expect(panelShift({ left: 10, right: 480, height: 800 }, 1440, 900)).toBe(240);
  });

  it('does not shift for a collapsed panel, a bottom sheet, or no panel', () => {
    expect(panelShift({ left: 10, right: 480, height: 60 }, 1440, 900)).toBe(0);
    expect(panelShift({ left: 10, right: 365, height: 380 }, 375, 812)).toBe(0);
    expect(panelShift(null, 1440, 900)).toBe(0);
  });
});
