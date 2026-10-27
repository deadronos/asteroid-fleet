import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: ['**/*.test.*', 'src/ui/testUtils.tsx'],
        reporter: ['text', 'lcov'],
      },
    },
  }),
);
