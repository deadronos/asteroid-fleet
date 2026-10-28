# Asteroid Fleet

A browser idle/autobattler game in 3D: a deterministic TypeScript simulation in a Web Worker, rendered with React Three Fiber. pnpm, Vite, Vitest, Playwright, oxlint and oxfmt.

Before calling a change done, run `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test`.

## Read what your task needs

- [docs/agents/workflow.md](docs/agents/workflow.md): commands, CI, bundle budget, releases, commit style
- [docs/agents/conventions.md](docs/agents/conventions.md): TypeScript, comments, lint, performance idioms, naming
- [docs/agents/testing.md](docs/agents/testing.md): test helpers, golden/scale/balance suites, e2e
- [docs/agents/architecture/overview.md](docs/agents/architecture/overview.md): layers, import rules, data flow (start here for any code change)
  - [sim.md](docs/agents/architecture/sim.md): state model, tick, determinism, commands, tuning
  - [host-and-protocol.md](docs/agents/architecture/host-and-protocol.md): worker, runner, messages, events, engine
  - [rendering.md](docs/agents/architecture/rendering.md): scene, per-frame data, LOD, models
  - [ui.md](docs/agents/architecture/ui.md): `useGame`, panels, hotkeys, modals, styling
- [docs/agents/save-and-migrations.md](docs/agents/save-and-migrations.md): read this before changing `GameState` or `Operation`
- [docs/agents/game-design.md](docs/agents/game-design.md): what the game is and which design decisions are settled

## Keep docs and code in step

- Code is the source of truth. The docs are a map of it.
- When you change behaviour, structure or a convention that a doc above describes, update that doc in the same change.
- When you notice code that disagrees with these docs and you are not changing that area, tell the user what differs and where. Don't silently follow either one.
- Each doc names its source files at the top. Keep that line accurate.
