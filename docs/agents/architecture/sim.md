# Simulation (`src/sim/`)

Source of truth: `tick.ts`, `ctx.ts`, `view.ts`, `state.ts`, `types.ts`, `config.ts`, `actions.ts`, `background.ts`, `worldgen.ts`.

## State model

- `GameState` (`types.ts`) is plain, JSON-serialisable data, and the whole of it is the save. Anything that cannot round-trip through `JSON.stringify` does not belong in it. One exception: timers use `Infinity` for "never", which is stored as `null` and restored on load (see [save-and-migrations.md](../save-and-migrations.md)).
- Run-wide fields (credits, research, cards, doctrine, systems, log...) sit on `GameState`. Per-carrier fields (carrier, hangars, ships, pirates, asteroids, warp, wave, rng...) sit on one `Operation` in `GameState.ops` (#75). Hangar ids are still unique across the run, because rule cards and stances name a hangar by id alone (#173). Each carrier keeps its own rebuild queue and automation timer. The auto-buy and auto-rebuild toggles and the credit floor stay on the run, because credits are shared (#174).
- A `Sim` is a `GameState` and one `Operation` bound together by `bind(g, op)` (`view.ts`). Most sim functions take a `Sim` and read both halves through one flat object. `stateOf(s)` gets the `GameState` back. `focused(g)` binds the operation the player is looking at.
- `SimView` (`viewAccessors.ts`) is **generated** by `pnpm run gen:view` from `OP_KEYS` and `GAME_KEYS` in `view.ts`. When you add a field to `Operation` or `GameState`, add it to the matching list (a `satisfies` check fails to compile otherwise), then run `gen:view`. `view.test.ts` fails until you do. Never edit `viewAccessors.ts` by hand.
- `state.ts` re-exports the public surface of `view.ts`, `worldgen.ts`, `economy.ts` and `events.ts` so imports stay stable. Import from `./state` unless you are inside one of those modules.

## Asteroid fields (#176)

There is one field per system for the whole run. While any carrier is on the map (Tier A) in a system, its `asteroids` array is the field, and every carrier there holds the **same array object**, so mining by any of them depletes it and `field()` ticks it once (the first holder does). `enterSystem` joins the array another carrier already holds, or else seeds the field and applies the system's `fields` record. A carrier leaving the array behind (`leaveField`: a warp, or `dematerialise` in the runner's `retier`) writes the record only if no other carrier still holds it, and drops its own reference. Tier B carriers hold an empty `asteroids`; `joinField` loads it again when they come back to Tier A. `fields[id]` therefore exists only for systems nobody is on the map in, and is consumed when the next carrier enters. Background mining does not touch the field (it pays credits from `miningIncomeAvg`). Saves keep one copy per carrier; `linkFields` merges them on load (`SimRunner.adopt`), keeping the least ore per rock.

## The tick

- Fixed step: `TICK_HZ = 10`, `DT = 0.1` (`config.ts`).
- `step(g, op)` moves the run clock, plays one operation through `stepOp`, then runs the supply routes (`stepRoutes`). It does not touch other carriers: the runner (`src/game/runner.ts`) steps those in `stepOthers`, through `stepOp` for carriers in the viewed system (Tier A) and `stepBackground` for the rest (Tier B, one aggregate step per second, `background.ts`). Dropping a carrier to Tier B resolves a wave that is still active, with the same roll as a background wave (#177). Offline time is Tier C: `settleOffline` (`actions.ts`) runs the background model over the time away with `waves: false`, so no new wave rolls (#179). A wave already on the map is resolved with events first (#177).
- `stepSim(s)` does the same for one bound operation and is the test and benchmark entry point.
- `stepOp` runs in a fixed order: fx decay → power → threats → launch → each ship's behaviour → turrets → pirates → hazards → refine → field → containers → reserves → automation → drift → cleanup → challenge check → income averages → warp. Order matters for determinism and for golden tests, so don't reorder it casually.
- Behaviour per ship class lives in `mining.ts` (drone, barge, hauler, harvester) and `combat.ts` (fighter, scout, repair, pirates). Environment is in `world.ts`, jumps in `warp.ts`, supply routes in `routes.ts`.

## Per-tick context (`ctx.ts`)

`buildCtx(s)` derives lookup maps, the compiled rule cards, the asteroid grid (`PointGrid`) and per-tick tallies (`income`, `mining`, `powerShort`) at the start of each step. The context is never saved. Its containers are **reused between ticks** so the hot path does not allocate. Follow the same pattern in new code: refill arrays in place, compact them with a write index (see the cleanup loop in `stepOp`), and avoid closures and `.map/.filter` in per-ship loops on the hot path. `scale.test.ts` enforces 8 ms per tick at 1000 ships.

## Determinism

- All randomness goes through `rand(s)` / `randRange(s, ...)` (`math.ts`, mulberry32). The RNG state is `Operation.rng`, so it lives in the save. Generation from a fixed seed uses `seeded(seed)`. Never call `Math.random()` in `sim/`.
- Background carriers and supply routes use only their own rng and the run clock, so a result never depends on what else was stepped (`background.ts`, `routes.ts` headers).
- Floating-point results differ across platforms (libm), so tests compare two in-process runs rather than stored hashes (`cards.golden.test.ts`).

## Player commands (`actions.ts`)

- `Order` is a discriminated union of every player action. `Command = Order & { carrierId }`.
- `apply(g, cmd)` and `order(s, order)` return `null` on success or a short human-readable refusal string, which the UI shows. They never throw for invalid input.
- Resets that build a new run (`prestige`, `admiralty`, `startChallenge`) return a new `GameState`, and the runner adopts it.
- Small pure costs that UI panels need live in `costs.ts`, `warpReason.ts` and `routeinfo.ts`, so panels don't pull the whole command interpreter into the initial bundle. Keep UI-facing helpers in modules like these.

## Tuning and data tables

- `config.ts` holds every gameplay constant and data table (`SHIP_STATS`, `HULLS`, `MODULES`, `PRESETS`, `HANGAR_TYPES`...). Magic numbers belong there (#133), with a doc comment saying what they are, and the issue number when one exists.
- Research nodes are in `research.ts`. Repeatable nodes use a soft cap, `cap × (1 − (1 − step)^level)` (`softcap`), with geometric cost. Admiralty upgrades (`admiralty.ts`) follow the same shape.
- Run modifiers (`modifiers.ts`) are read through one small hook each, so every rule has one place that names it. Add a hook there rather than checking `s.modifiers` inline.
- Stances resolve from most specific to least: active card > hangar > ship type > fleet doctrine (`doctrine.ts`, `cards.ts`). Cards are compiled once per tick into per-action lists that are already in priority order.

## Events

`emit(s, kind, data)` (`events.ts`) reports something to the player. Events are write-only: the sim never reads them back, and they must not affect simulation results. Payload shapes are typed in `EventData` (`types.ts`), and the UI turns kind and data into text (`ui/events.ts`). Adding an event kind means adding an `EventData` entry, a severity in `SEVERITY`, and a formatter case.
