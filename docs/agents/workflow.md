# Workflow and tooling

Source of truth: `package.json`, `.github/workflows/`, `scripts/`, `.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig.json`.

## Stack

pnpm 12, Node 22 (CI), TypeScript 7 (`tsc -b`, strict, `noUnusedLocals/Parameters`), Vite 8, React 19, React Three Fiber 9 / three 0.186, Vitest 5, Playwright, oxlint (type-aware via tsgolint), and oxfmt.

## Commands

| Command                            | What it does                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm run dev`                     | Dev server at `http://localhost:5173/asteroid-fleet/`                                 |
| `pnpm test`                        | Vitest, all unit/component tests                                                      |
| `pnpm run typecheck`               | `tsc -b`                                                                              |
| `pnpm run lint`                    | oxlint `--type-aware --deny-warnings`; warnings fail                                  |
| `pnpm run format` / `format:check` | oxfmt: 100 columns, single quotes                                                     |
| `pnpm run build`                   | typecheck + production build into `dist/`                                             |
| `pnpm run check:bundle`            | gzip budgets on `dist/` (run after build)                                             |
| `pnpm run test:e2e`                | Playwright against `vite preview` on :4173 (builds are not automatic, so build first) |
| `pnpm run test:coverage`           | v8 coverage, excluding `scale.test.ts`                                                |
| `pnpm run gen:view`                | Regenerate `src/sim/viewAccessors.ts`                                                 |
| `pnpm run balance`                 | Headless economy run (`src/sim/balance/harness.ts`); flags in its header              |
| `pnpm run balance:modules`         | `BALANCE=1` module comparison test                                                    |

**Before you call a change done:** `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test`. Run `pnpm run build && pnpm run check:bundle` when you add code or dependencies that ship, and `pnpm run test:e2e` when you touch flows the e2e specs cover.

## CI (`.github/workflows/ci.yml`)

It runs on every PR and on pushes to `main`. The `check` job runs install `--frozen-lockfile`, lint, format:check, typecheck, test, test:coverage, build and check:bundle. The `e2e` job builds and runs Playwright on Chromium with SwiftShader GL. Balance runs are local only and must stay out of CI.

## Bundle budget (`scripts/check-bundle.mjs`)

Gzip budgets apply to the initial load (entry + modulepreloads + CSS), to any single chunk, and to the total (with the sim counted once, although it ships as both the worker and the fallback). Budgets carry little headroom. Raise one only deliberately, in its own commit or PR, and append the reason and issue to the `// was N` trail on that line.

## Releases

Pushing a `v*` tag deploys to GitHub Pages (`deploy-pages.yml`), after CI and e2e pass. The base path is `/asteroid-fleet/`.

## Git

- Commit and PR titles are short imperative sentences that end with the issue(s) in parentheses, for example `Back off safe drones with no ore in cover (#156)`. The squash merge appends the PR number.
- pnpm shares one package store, so worktrees reuse downloaded packages.
