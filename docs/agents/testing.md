# Testing

Source of truth: `vitest.config.ts`, `playwright.config.ts`, `src/sim/testing.ts`, `src/ui/testUtils.tsx`, `e2e/helpers.ts`.

## Unit and component tests (Vitest)

- Tests sit next to their code as `foo.test.ts(x)`. Topic-specific files are fine (`App.log.test.tsx`, `cards.golden.test.ts`).
- Sim tests: `game(seed)` from `src/sim/testing.ts` returns a fresh `newGame` bound to its only operation. Drive it with `stepSim(s)` and `order(s, {...})`. Prefer fixed seeds and assert on state, not on wall time.
- Component tests: put `// @vitest-environment happy-dom` at the top, then `mount(<Panel />, state)` and `click(button)` from `src/ui/testUtils.tsx`. `mount` swaps `engine.state` and restores it in `cleanup`, so call `cleanup` in `afterEach`.
- Runner and host: construct `SimRunner` with a fake `post` and `now`, then call `handle` and `pump(now)` directly.
- Use `vi.useFakeTimers()` for code on the wall clock (toasts, engine). Use `it.each` for tables of cases.

## Special suites

- **Golden equivalence** (`cards.golden.test.ts`): runs the same seed twice in one process and compares exact end state, because stored hashes differ across platforms (libm). Use this pattern when refactoring behaviour that must stay identical.
- **Scale** (`scale.test.ts`): wall-clock budget of 8 ms per tick at 1000 ships / 600 asteroids, best of several batches. It is excluded from coverage because instrumentation skews timing. If it fails, look for allocations or O(n²) loops in the hot path before touching the budget.
- **Balance** (`balance.test.ts`, `balance/`): opt-in with `BALANCE=1`, skipped otherwise. Never in CI.
- **Save fixtures** (`src/game/fixtures/`, `save.test.ts`): see [save-and-migrations.md](save-and-migrations.md).
- **Generated code** (`view.test.ts`): fails when `viewAccessors.ts` is stale.

## End-to-end (Playwright, `e2e/`)

- Runs against the built preview. `makeGame()` / `run()` in `e2e/helpers.ts` build a state with the real sim, and `seedSave(page, state)` makes the app load it through the normal load-and-migrate path.
- Waits are signal-based (`engineReady`), and the 60 s timeout is only a ceiling for software GL on CI. Don't add fixed sleeps.
- The smoke spec fails on any console error or HTTP ≥ 400. Keep the app's console clean.
