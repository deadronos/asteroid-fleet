import { describe, expect, it } from 'vitest';
import { fmt, formatSimTime } from './format';

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

describe('formatSimTime', () => {
  it('prints hh:mm:ss below a day of sim time', () => {
    expect(formatSimTime(0)).toBe('00:00:00');
    expect(formatSimTime(59)).toBe('00:00:59');
    expect(formatSimTime(23 * 3600 + 59 * 60 + 59)).toBe('23:59:59');
  });
  it('adds the day count instead of wrapping at 24 h', () => {
    expect(formatSimTime(24 * 3600)).toBe('1d 00:00:00');
    expect(formatSimTime(2 * 86400 + 3 * 3600 + 4 * 60 + 5)).toBe('2d 03:04:05');
    expect(formatSimTime(36 * 3600 + 30)).toBe('1d 12:00:30');
  });
  it('truncates fractions and clamps bad input to zero', () => {
    expect(formatSimTime(59.9)).toBe('00:00:59');
    expect(formatSimTime(-5)).toBe('00:00:00');
    expect(formatSimTime(Number.NaN)).toBe('00:00:00');
  });
});
