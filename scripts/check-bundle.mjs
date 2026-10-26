// Gzip budget for the production build. Run after `pnpm run build`.
// Budgets carry ~10% headroom over the current build; raise them deliberately, in a PR.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGET = {
  // Everything index.html loads before the first frame (entry + modulepreloads + css).
  // The scene (three.js + r3f), research tree and settings menu are lazy chunks that load
  // right after first paint (#41), so this covers just the HUD shell: ~101 kB + headroom.
  initial: 115 * KB,
  // Any single JS chunk; three.js is the largest.
  chunk: 200 * KB,
  // All JS and CSS, lazy chunks and the sim worker included. Raised from 415 for the typed
  // event bus (#72), which put main at 415.3 kB; the sim ships in both the worker and the
  // main-thread fallback, so sim code counts twice.
  total: 420 * KB,
};

const dist = 'dist';
const assets = join(dist, 'assets');
const gz = (file) => gzipSync(readFileSync(join(assets, file)), { level: 9 }).length;
const files = readdirSync(assets).filter((f) => /\.(js|css)$/.test(f));
const sizes = new Map(files.map((f) => [f, gz(f)]));

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = [...new Set([...html.matchAll(/assets\/([^"']+\.(?:js|css))/g)].map((m) => m[1]))];

const fmt = (n) => `${(n / KB).toFixed(1)} kB`;
const failures = [];
for (const [f, n] of [...sizes].sort((a, b) => b[1] - a[1])) {
  const lazy = initial.includes(f) ? '' : ' (lazy)';
  console.log(`${fmt(n).padStart(10)}  ${f}${lazy}`);
  if (f.endsWith('.js') && n > BUDGET.chunk) failures.push(`${f} ${fmt(n)} > ${fmt(BUDGET.chunk)}`);
}
const initialSize = initial.reduce((s, f) => s + (sizes.get(f) ?? 0), 0);
const total = [...sizes.values()].reduce((s, n) => s + n, 0);
console.log(`\ninitial ${fmt(initialSize)} / ${fmt(BUDGET.initial)}`);
console.log(`total   ${fmt(total)} / ${fmt(BUDGET.total)}`);
if (initialSize > BUDGET.initial)
  failures.push(`initial ${fmt(initialSize)} > ${fmt(BUDGET.initial)}`);
if (total > BUDGET.total) failures.push(`total ${fmt(total)} > ${fmt(BUDGET.total)}`);

if (failures.length) {
  console.error(`\nBundle budget exceeded:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
