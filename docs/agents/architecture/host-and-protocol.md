# Sim host, protocol and engine (`src/game/`)

Source of truth: `host.ts`, `localHost.ts`, `sim.worker.ts`, `runner.ts`, `protocol.ts`, `snapshot.ts`, `events.ts`, `toasts.ts`, `engine.ts`.

## Host

- `createSimHost` (`host.ts`) starts `sim.worker.ts` as a module worker. Until the worker answers, it buffers outgoing messages. If the worker fails to load, it replays them into a lazily imported local host on the main thread.
- `createLocalHost` (`localHost.ts`) speaks the same protocol on the main thread and `structuredClone`s messages both ways, so neither side can hold a live reference into the other's state. Keep that guarantee: never share objects between engine and runner.
- The sim therefore ships twice (worker bundle and lazy fallback chunk). `scripts/check-bundle.mjs` counts only the larger one.

## Runner (`runner.ts`)

`SimRunner` owns the authoritative state and the tick loop. It has no DOM, and it is driven by `handle(msg)` and `pump(now)`; tests call both directly.

- It pumps every `PUMP_MS = 25` ms, accumulates wall time × speed, and runs whole ticks. It catches up at most `MAX_CATCHUP_TICKS = 600` ticks (one minute). A longer gap, such as a background tab, goes through `settleOffline` instead.
- Backpressure: at most `MAX_INFLIGHT = 4` unacknowledged pump-driven messages. The main thread replies `{t:'ack'}` after handling each one.
- Tiering: carriers in the focused system are Tier A (full `stepOp`). The others are dematerialised to Tier B (`stepBackground`). `retier()` handles the transitions on a jump or a focus change.
- `adopt(state)` installs a new run (load, import, prestige, challenge) and resets event merging.

## Messages (`protocol.ts`)

- `InMsg` (main → sim): `init`, `cmd`, `focus`, `speed`, `pause`, `prestige`, `admiralty`, `challenge`, `replace`, `ack`, `snapshot`.
- `OutMsg` (sim → main):
  - `frame`: every pump, focused carrier only. Ids, positions (Float64 so mirrors save exactly), mode bytes (`MODES` index), and targets as typed arrays, transferred.
  - `state`: about 5 Hz. A `UiSnapshot` (`snapshot.ts`) packs ships, pirates and asteroids as rows of one Float64Array each, with a `focus` part and a `global` part, plus `carriers` and `others` summaries. Fields are sent only when the system changed.
  - `events`: drained sim events, merged and ranked.
  - `error`: a refused command's message.
  - `snapshot`: the full `GameState`, used by the save path.
- `epoch`: a `replace` bumps the run generation. Event batches carry it, and the engine drops stale ones so an in-flight message cannot toast the previous run.
- Adding a ship mode means appending to `MODES`. Adding snapshot data means extending `encodeSnapshot` and `applySnapshot` together; `snapshot.test.ts` round-trips them.

## Events and toasts

- `EventAggregator` (`events.ts`) merges events of the same kind and carrier within `MERGE_WINDOW_S = 5` sim seconds. Each merged event keeps a stable `id`, so receivers replace rather than append. Events are ranked most severe first.
- `ToastQueue` (`toasts.ts`) runs on the wall clock, not sim time, so toasts expire while paused. Alert rules (`AlertMode`: off, inbox, toast, pause, focus) resolve fleet-wide and then per carrier.

## Engine (`engine.ts`)

- `engine` is a singleton: the main-thread mirror, the toast queue, focus and carrier-bar data, autosave every 15 s, and the `dispatch` / `doPrestige` / `replace` / `reset` entry points.
- Interpolation: `engine.prev` holds last-frame positions, `alpha()` gives the blend factor, and `lerpPos` / `lerpCarrier` give interpolated positions.
- React reads it via `useGame` (see [ui.md](ui.md)). The renderer reads `engine.view` directly inside `useFrame`.
- Settings (`settings.ts`) are stored apart from saves under their own key, so reset and import never touch them.
