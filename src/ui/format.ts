const SUFFIXES = [
  ['T', 1e12],
  ['B', 1e9],
  ['M', 1e6],
  ['K', 1e3],
] as const;

/** Largest value shown with a suffix; beyond this we switch to e-notation. */
const E_NOTATION_FROM = 1e15;

/**
 * The one number formatter for every panel: full digits below 10K, then
 * K/M/B/T, then e-notation (policy for #63).
 */
export function fmt(n: number, digits = 1): string {
  if (Number.isNaN(n)) return '0';
  if (!Number.isFinite(n)) return n < 0 ? '-∞' : '∞';
  const a = Math.abs(n);
  if (a < 1e4) return Math.floor(n).toLocaleString('en-US');
  if (a >= E_NOTATION_FROM) {
    const [m, e] = n.toExponential(digits).split('e');
    return `${m}e${e.replace('+', '')}`;
  }
  for (let i = 0; i < SUFFIXES.length; i++) {
    const [suffix, size] = SUFFIXES[i];
    if (a < size) continue;
    const text = (n / size).toFixed(digits);
    // 999,960 rounds to "1000.0K": promote to the next suffix instead.
    if (Math.abs(Number(text)) >= 1000 && i > 0)
      return (n / SUFFIXES[i - 1][1]).toFixed(digits) + SUFFIXES[i - 1][0];
    return text + suffix;
  }
  return String(Math.floor(n));
}
