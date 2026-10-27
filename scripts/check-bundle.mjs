// Gzip budget for the production build. Run after `pnpm run build`.
// Budgets carry ~10% headroom over the current build; raise them deliberately, in a PR.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGET = {
  // Everything index.html loads before the first frame (entry + modulepreloads + css).
  // The scene (three.js + r3f), research tree and settings menu are lazy chunks that load
  // right after first paint (#41), so this covers just the HUD shell. Measured 109.6 kB (~6% headroom) with the Doctrine panel
  // lazy (#134).
  initial: 117 * KB, // was 116; challenge runs panel (#71). Was 115 before the Admiralty panel (#68)
  // Any single JS chunk; three.js is the largest.
  chunk: 200 * KB,
  // Worst-case download: everything except the sim you don't run. The sim ships twice, as the
  // Web Worker bundle and as the lazy main-thread fallback chunk (only fetched when the worker
  // fails); a user gets one of them, so the total counts the larger once, not both.
  // Measured 441.8 kB at the time of writing (#134), so under 1% headroom. Lazy panels move
  // bytes out of `initial` but not out of the total; reclaiming it needs less shipped code,
  // e.g. dropping drei's unused DRACO/Meshopt loaders from the r3f chunk.
  total: 447 * KB, // was 446: v0.0.5 review fixes (modal stack, eval-free SimView, #151); was 445: colour tokens (#136) + shape-coded tactical icons (#125); was 440; shared accessible Modal and side-panel tabs (#119)
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
const workerFile = files.find((f) => /^sim\.worker-.*\.js$/.test(f));
const fallbackFile = files.find((f) => /^localHost-.*\.js$/.test(f));
if (!workerFile || !fallbackFile) {
  console.error('Could not find the worker bundle and the fallback chunk in dist/assets.');
  process.exit(1);
}
const initialSize = initial.reduce((s, f) => s + (sizes.get(f) ?? 0), 0);
const everything = [...sizes.values()].reduce((s, n) => s + n, 0);
const worker = sizes.get(workerFile);
const fallback = sizes.get(fallbackFile);
const total = everything - Math.min(worker, fallback);
console.log(`\nworker   ${fmt(worker)}  ${workerFile}`);
console.log(`fallback ${fmt(fallback)}  ${fallbackFile}`);
console.log(`initial ${fmt(initialSize)} / ${fmt(BUDGET.initial)}`);
console.log(`total   ${fmt(total)} (worst case, sim counted once) / ${fmt(BUDGET.total)}`);
if (initialSize > BUDGET.initial)
  failures.push(`initial ${fmt(initialSize)} > ${fmt(BUDGET.initial)}`);
if (total > BUDGET.total) failures.push(`total ${fmt(total)} > ${fmt(BUDGET.total)}`);

if (failures.length) {
  console.error(`\nBundle budget exceeded:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
