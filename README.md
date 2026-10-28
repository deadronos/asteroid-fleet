# Asteroid Fleet

A browser idle game with an autobattler setup, in full 3D. You are the admiral, not the pilot: outfit a mining carrier's hangars, set stances and rules, and warp outward into richer, more dangerous systems while the fleet works on its own. See [asteroid-fleet-game-concept.md](asteroid-fleet-game-concept.md) for the design.

## Screenshot

![Screenshot of Asteroid Fleet](image.png)

## Run it

```sh
pnpm install
pnpm run dev       # http://localhost:5173/asteroid-fleet/
pnpm test
```

The game is published to GitHub Pages at https://deadronos.github.io/asteroid-fleet/ . Every command, what CI checks, the bundle budget and how releases work are in [docs/agents/workflow.md](docs/agents/workflow.md).

## What is in this first playable slice

| Concept area                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logistics chain drone → barge → hauler → carrier refinery | Playable. Barges park at rich clusters as depots; the Carrier tab shows the throughput links and the current bottleneck.                                                                                                                                                                                                                                                                                                                                |
| Hangars as the board                                      | Slot sizes (drone 1, fighter/hauler 2, harvester 3, barge 4), drag-and-drop between slots, launch order per hangar, launch bay / cargo bay / dry dock (frontier) / fabrication bay (deep space) types, repair-drone adjacency synergy.                                                                                                                                                                                                                  |
| Stances                                                   | Fleet → ship type → hangar scopes, most specific wins. Engagement (aggressive, defensive, escort, passive), under fire (stand, retreat at X % hull, unload first), mining (greedy, safe).                                                                                                                                                                                                                                                               |
| Rules                                                     | Condition/action cards (up to 12): a scope (fleet, ship type or hangar), 1–3 conditions joined by AND, one action. The most specific scope wins, then card order. Actions unlock by zone, each dealt as a preset card: drones unload at barges, barges call a hauler, haulers park (starter); fighters escort on wave, barges fall back, recall on low shields, keep warp energy in reserve (frontier); harvesters shelter from H2 storms (deep space). |
| Modules & scouts                                          | Fit modules per ship (mining laser, core drill, tractor beam, shield emitter, ore compressor; 1–2 slots by class). Scouts survey clusters, mark rich veins for drones and chart hazards so drones steer clear.                                                                                                                                                                                                                                          |
| Automation                                                | Research unlocks auto-buy toward a per-hangar target and paid auto-rebuild of lost ships, both kept above a credit floor.                                                                                                                                                                                                                                                                                                                               |
| Zones                                                     | 10 systems across starter, frontier and deep space, two with gas giants. Pirate waves scale with distance and cargo heat; debris and radiation hazards; solar storms, H2 storms around gas giants.                                                                                                                                                                                                                                                      |
| Carrier                                                   | One energy pool (solar, later fusion from H2) feeding refinery, shields, warp and drift; power modes; sublight "follow richest cluster"; warp with charge time, automatic recall, and losses for ships left outside.                                                                                                                                                                                                                                    |
| Prestige & research                                       | RP = ⌊√(ore value delivered ÷ 10,000)⌋ × furthest tier. Hybrid tree: global branches plus one small branch per ship class, loss-buffer reserves.                                                                                                                                                                                                                                                                                                        |
| Offline                                                   | Settled from timestamps at 50 % of recent mining income (salvage excluded), no pirate waves, energy recharges from solar, reserves keep rebuilding. Offline credits do not count toward RP.                                                                                                                                                                                                                                                             |
| Save                                                      | IndexedDB with localStorage fallback, manual save slots and text export/import from the ☰ menu.                                                                                                                                                                                                                                                                                                                                                        |
| Rendering                                                 | React Three Fiber, low-poly glTF ships and asteroids (Kenney Space Kit) with an instanced placeholder LOD at distance, engine trails, line-segment beams, bloom, nebula skybox, tactical sensor view (toggle or zoom far out), low-quality mode with a frame cap.                                                                                                                                                                                       |

## Choices made for the open questions

1. **Energy at zero**: shields stop regenerating and refining stops, but the carrier is never stranded because solar keeps trickling in.
2. **H2**: fusion fuel only, not direct warp fuel.
3. **Reserves offline**: reserve ships keep rebuilding on their cooldown while you are away.
4. **Rule depth**: condition/action cards (a scope, 1–3 AND-ed conditions, one action, up to 12 cards), with the old fixed rules kept as preset cards (#82).

## Save migrations

Saves are versioned JSON and migrate step by step on load. The rules for changing the save schema, the version history and the backup behaviour for unreadable saves are in [docs/agents/save-and-migrations.md](docs/agents/save-and-migrations.md).

## Layout

- `src/sim/`: deterministic simulation (seeded RNG, fixed 10 Hz tick), pure TypeScript with no React or three.js.
- `src/game/`: the sim host that runs the tick loop in a Web Worker (falling back to the main thread), the main-thread engine mirror, and save/load.
- `src/render/`: the 3D scene.
- `src/ui/`: HTML/React panels over the canvas.

How the layers fit together is in [docs/agents/architecture/overview.md](docs/agents/architecture/overview.md). Not yet built: short expeditions, async PvP.

The engine is exposed as `__fleet` in the browser console for debugging and balancing.

## Contributing and agent docs

[AGENTS.md](AGENTS.md) indexes the docs in [docs/agents/](docs/agents/): workflow, conventions, testing and architecture.
