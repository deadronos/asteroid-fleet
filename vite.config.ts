import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vendor chunks change far less often than game code, so they cache across deploys.
// Rolldown's `codeSplitting.groups` replaces Rollup's deprecated `manualChunks`.
// pnpm nests packages, so match the path after the last `node_modules/`.
const pkg = (names: string) =>
  new RegExp(`node_modules[\\\\/](${names})[\\\\/][^\\\\/]*?(?!.*node_modules)`);
// Groups also capture their dependencies, so higher-priority (earlier) groups claim
// shared packages first; postprocessing comes last to stay a lazy, standalone chunk.
const VENDOR_GROUPS: [name: string, test: RegExp][] = [
  ['three', pkg('three')],
  ['react', pkg('react|react-dom|scheduler|use-sync-external-store|zustand')],
  [
    'r3f',
    pkg(
      '@react-three[\\\\/](?:fiber|drei)|three-stdlib|maath|camera-controls|its-fine|suspend-react|react-use-measure',
    ),
  ],
  ['postprocessing', pkg('postprocessing|@react-three[\\\\/]postprocessing|n8ao')],
];

const SIM_FALLBACK =
  /src[\\/](game[\\/](runner|localHost)|sim[\\/](actions|tick|background|routes|world))\.ts/;

export default defineConfig({
  plugins: [react()],
  base: '/asteroid-fleet/',
  build: {
    // three.js alone is ~740 kB minified by design; scripts/check-bundle.mjs enforces the real
    // gzip budgets, so the generic size warning is just noise.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            ...VENDOR_GROUPS.map(([name, test], i) => ({
              name,
              test,
              priority: VENDOR_GROUPS.length - i,
            })),
            // The main-thread sim fallback (only fetched when the worker fails) and the
            // command/tick code only it uses, kept out of the entry chunk. Modules the UI
            // shares stay in the entry, so dependencies are not pulled along.
            {
              name: 'localHost',
              test: SIM_FALLBACK,
              priority: 0,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
});
