// Headless balance harness (#59). Loads the TypeScript sim through Vite's module
// runner, so no build step or extra dependency is needed. See src/sim/balance/harness.ts.
//   pnpm run balance --hours 6 --rp-divisor 1e4,1e5,1e6
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const { module } = await runnerImport(
  fileURLToPath(new URL('../src/sim/balance/harness.ts', import.meta.url)),
  {
    configFile: false,
    logLevel: 'error',
  },
);
try {
  console.log(module.main(process.argv.slice(2)));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
