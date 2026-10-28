# Rendering (`src/render/`)

Source of truth: `Scene.tsx`, `frameState.ts`, `Fleet.tsx`, `AsteroidField.tsx`, `models.ts`, `constants.ts`, `public/models/README.md`.

## Shape of the scene

- React Three Fiber. `Scene` is lazily loaded from `ui/App.tsx`, so three.js stays out of the initial bundle.
- `ViewOptions` carries `tactical`, `quality` (`high` | `low`), `bloom` and `fpsCap`. Low quality shortens LOD distances (`ASTEROID_LOD`, `FLEET_LOD` in `constants.ts`) and can cap the frame rate (`FrameCap`). Bloom is unmounted when it is off, not just disabled.
- Tactical view draws shape-coded icons (`ICON_SHAPE`, `SHAPES` from `ui/palette.ts`) and turns on automatically when you zoom far out.

## Per-frame data

- `fleetFrame` (`frameState.ts`) is one shared, preallocated set of typed arrays (`MAX_ENTITIES = 2048`) holding every live ship and pirate, interpolated **once per frame** by `FleetPass`. Docked ships and drones riding in a barge are omitted (#181). Ship layers, trails and beams all read from it. Entities are bucketed by render class (`CLASSES`: ship classes, then pirate).
- Don't allocate in `useFrame`. Reuse module-level scratch vectors, colors and buffers, as the existing components do (`BEAM_COLORS`, `MAX_SEG` line buffers).
- Read the engine directly in `useFrame` (`engine.view`, `lerpPos`, `lerpCarrier`). Don't route positions through React state.
- R3F mutates three.js objects inside `useFrame` by design, which is why the `react/immutability` lint rule is off.

## LOD and models

- Near entities draw glTF models, and far ones draw an instanced placeholder that scales up so it stays at least `FAR_SHIP_MIN_PX` long.
- Ship and carrier models are the "Foundry" fleet, built procedurally in Blender by `scripts/blender/build_fleet.py` (shapes in `foundry.py`, helpers in `shiplib.py`) into `public/models/foundry_<class>.glb`. `models.ts` relies on the material slot names `hull`, `hull2`, `dark`, `glow` and `metalRed`. `metalRed` is recoloured per class, and `glow` is drawn unlit for bloom. Asteroids use Kenney Space Kit `meteor.glb` (CC0).
- To regenerate the models, see `public/models/README.md`. Models are static assets, not bundled.

## Colors

Ship colors live in `SHIP_STATS` (`sim/config.ts`). Other scene colors live in `PALETTE` (`ui/palette.ts`). Both are colour-blind-safe (#125), so reuse them instead of adding hex literals.
