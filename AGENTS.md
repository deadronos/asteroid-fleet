# Asteroid Fleet

A browser idle/autobattler game in 3D: a deterministic TypeScript simulation in a Web Worker, rendered with React Three Fiber. pnpm, Vite, Vitest, Playwright, oxlint and oxfmt. Run `pnpm install` once per checkout.

Before calling a change done, run `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test`. CI also runs the build, the bundle budget and e2e; [workflow.md](docs/agents/workflow.md) says when to run those locally.

## Rules that apply everywhere

- `src/sim/` stays deterministic and pure: randomness only through `rand(s)`, never `Math.random()`, and no DOM, React or three.js.
- Any change to the shape of `GameState` or `Operation` needs a save migration.
- Branch from current `main`. Bring the branch up to date with `main` before opening a PR. Never merge a PR without the user's approval.
- `scratch.md` at the repo root is the maintainer's work queue. Don't act on its items unless the user asks.

## Read what your task needs

- [docs/agents/workflow.md](docs/agents/workflow.md): before running anything beyond the gate above, or before a commit, PR or release
- [docs/agents/conventions.md](docs/agents/conventions.md): before writing code (TypeScript, comments, lint, performance idioms, naming)
- [docs/agents/testing.md](docs/agents/testing.md): before adding or changing tests, or when a golden, scale or e2e test fails
- [docs/agents/architecture/overview.md](docs/agents/architecture/overview.md): before any code change (layers, import rules, data flow)
  - [sim.md](docs/agents/architecture/sim.md): before touching `src/sim/`
  - [host-and-protocol.md](docs/agents/architecture/host-and-protocol.md): before touching the worker, runner, messages or engine in `src/game/`
  - [rendering.md](docs/agents/architecture/rendering.md): before touching `src/render/`
  - [ui.md](docs/agents/architecture/ui.md): before touching `src/ui/`
- [docs/agents/save-and-migrations.md](docs/agents/save-and-migrations.md): before changing `GameState`, `Operation` or save/load code
- [docs/agents/game-design.md](docs/agents/game-design.md): before changing gameplay or balance, to see which design decisions are settled

## Keep docs and code in step

- Code is the source of truth. The docs are a map of it.
- When you change behaviour, structure or a convention that a doc above describes, update that doc in the same change.
- When you notice code that disagrees with these docs and you are not changing that area, tell the user what differs and where. Don't silently follow either one.
- Each doc names its source files at the top. Keep that line accurate.
