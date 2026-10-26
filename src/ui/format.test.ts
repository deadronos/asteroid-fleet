import { describe, expect, it } from 'vitest';
import { fmt } from './format';

describe('fmt', () => {
  it('prints small values in full', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(9999)).toBe('9,999');
  });
  it('uses K/M/B/T suffixes', () => {
    expect(fmt(12_500)).toBe('12.5K');
    expect(fmt(3.2e6)).toBe('3.2M');
    expect(fmt(4e9)).toBe('4.0B');
    expect(fmt(7.77e12)).toBe('7.8T');
  });
  it('rolls over to e-notation past the suffixes without overflowing a suffix', () => {
    expect(fmt(999_960)).toBe('1.0M');
    expect(fmt(2.5e15)).toBe('2.5e15');
    expect(fmt(-2.5e6)).toBe('-2.5M');
  });
  it('is safe on non-finite input', () => {
    expect(fmt(Infinity)).toBe('∞');
    expect(fmt(NaN)).toBe('0');
  });
});
