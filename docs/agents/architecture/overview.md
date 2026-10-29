# Architecture overview

Source of truth: `src/main.tsx`, `src/sim/tick.ts`, `src/game/runner.ts`, `src/game/engine.ts`.

## Layers

| Folder        | What it is                                                                                                           | May import                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `src/sim/`    | Deterministic simulation. Pure TypeScript, no React, no three.js, no DOM.                                            | nothing outside `sim/`                      |
| `src/game/`   | Sim host (worker or main thread), main-thread engine mirror, save/load. React only for `useSyncExternalStore` hooks. | `sim/` (never `ui/`, lint-enforced)         |
| `src/render/` | React Three Fiber scene.                                                                                             | `sim/`, `game/`, `ui/palette`, `ui/hotkeys` |
| `src/ui/`     | HTML/React panels over the canvas.                                                                                   | `sim/`, `game/`, `render/focus`             |

Tests may cross these lines (for example a sim test importing a `game/` helper); production code may not. `sim/` must stay importable from a Web Worker and from Node (the balance harness), so nothing in it may touch `window`, `document`, React or three.js. The only wall-clock read in the game sim is `savedAt: Date.now()` in `newGame`. The Node-only balance harness (`sim/balance/`) also times its own run with `performance.now()`, which never feeds into a game.

## Data flow

```
UI panel ──engine.dispatch(order)──► SimHost.post({t:'cmd'})
                                            │  (worker, or structuredClone on main thread)
                                            ▼
                                   SimRunner.handle → apply(g, cmd)   src/sim/actions.ts
                                   SimRunner.pump   → step(g, op)     src/sim/tick.ts, 10 Hz
                                            │
              ┌─────────────── frame (every pump, typed arrays, transferred)
              │  ┌──────────── state (UiSnapshot, ~5 Hz)
              │  │  ┌───────── events (merged, ranked BusEvents)
              ▼  ▼  ▼
                Engine (src/game/engine.ts): mirror GameState + prev positions
                    │                         │
     useGame(selector) in ui/        lerpPos / fleetFrame in render/
```

- The worker owns the authoritative `GameState`. The main thread holds a mirror rebuilt from snapshots, which equals the sim state closely enough that saves taken from it are exact.
- Player input only ever becomes a `Command` (`src/sim/actions.ts`). The UI never mutates state directly.
- Rendering interpolates between the last two frames (`engine.alpha()`), so the scene stays smooth at display rate while the sim ticks at 10 Hz.
- The engine is `globalThis.__fleet` in the browser console.

## Where to read next

- Simulation internals: [sim.md](sim.md)
- Worker, protocol, snapshots, events: [host-and-protocol.md](host-and-protocol.md)
- 3D scene and assets: [rendering.md](rendering.md)
- Panels, hooks, hotkeys: [ui.md](ui.md)
- Save format and migrations: [../save-and-migrations.md](../save-and-migrations.md)
