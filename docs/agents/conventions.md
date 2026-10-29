# Code conventions

Source of truth: the code itself, plus `.oxlintrc.json` and `.oxfmtrc.json`. When this page and the surrounding code disagree, match the surrounding code and flag the difference.

## TypeScript

- Strict mode, with no unused locals or parameters. Named exports only (the one exception is `render/Effects.tsx`, a lazy default). No `enum` or `namespace`: use string-literal unions, with a runtime list beside them when one is needed (`SHIP_CLASSES`, `ALERT_MODES`, `MODES`).
- Data tables are `Record<Union, Def>` objects in `config.ts` and friends (`SHIP_STATS`, `HULLS`, `MODULES`, `MODIFIERS`). Adding a union member then fails to compile until every table has an entry. Lean on that, and use `satisfies` where a list must cover a type (`OP_KEYS`).
- Prefer plain functions over classes. Classes are used for stateful runtime objects (`SimRunner`, `EventAggregator`, `ToastQueue`, `PointGrid`, `Engine`), plus the generated `SimView` and the React error boundary `SceneBoundary`, which must be a class.
- Fallible operations return a value instead of throwing: `string | null` refusals (`order`), `{ ok: true, ... } | { ok: false, reason }` results (`migrate`, `decodeSave`).
- Casts are fine at three.js, DOM and JSON boundaries (`no-unsafe-type-assertion` is off). Elsewhere, narrow properly.

## Comments

- Doc comments (`/** ... */`) on exported functions, constants and non-obvious fields. Each says what the thing is or guarantees, in one or two plain sentences. Constants state their unit (`seconds`, `energy/s`, `ms`).
- A file with a non-obvious role opens with a `//` header saying what lives there and what does not (`tick.ts`, `ctx.ts`, `routes.ts`, `background.ts`).
- Cite the GitHub issue that motivated a rule or number: `(#156)`. That is the project's link from code to the design discussion.
- Comments explain _why_ (constraints, invariants, what would break), not what the next line does.
- Prose is plain and declarative, with no em-dashes, and spelling follows the file you are in.

## Formatting and lint

- oxfmt: 100 columns, single quotes. Run `pnpm run format` instead of hand-formatting.
- oxlint runs with `--deny-warnings`. A rule turned off project-wide goes in `.oxlintrc.json` with a one-line comment saying why. A single deliberate exception can use `// oxlint-disable-next-line <rule>` (see `game/host.ts`).
- `src/game/**` must not import `src/ui` (enforced by lint). The `sim/` purity rule ([architecture/overview.md](architecture/overview.md)) is not lint-enforced, so keep it by hand.

## Performance idioms (sim hot path and `useFrame`)

- No per-tick or per-frame allocation in hot loops: reuse arrays and typed buffers, refill in place, and compact with a write index.
- Typed arrays for bulk data crossing the worker boundary or feeding the GPU.
- Asteroid lookups go through `ctx.asteroidGrid` (a `PointGrid`, `sim/spatial.ts`). If a new query over a large set shows up in `scale.test.ts`, give it a grid too, rather than scanning linearly.

## Naming

- Files: `camelCase.ts` for modules, `PascalCase.tsx` for components.
- Short names are fine in the sim where the type says it all: `s: Sim`, `g: GameState`, `op: Operation`, `ctx: Ctx`, `dt`.
- Game terms: carrier / operation (one carrier's state), hangar, slot, stance, doctrine, card (rule card), tier (zone depth), RP (research points), Marks (Admiralty currency), prestige / Admiralty (the two reset layers).
