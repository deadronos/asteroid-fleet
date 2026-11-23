# Rendering (`src/render/`)

Source of truth: `Scene.tsx`, `Environment.tsx`, `Effects.tsx`, `Fx.tsx`, `AudioBridge.tsx`, `RenderLoop.tsx`, `Tactical.tsx`, `CameraRig.tsx`, `frameState.ts`, `focus.ts`, `Fleet.tsx`, `AsteroidField.tsx`, `models.ts`, `geometry.ts`, `constants.ts`, `public/models/README.md`.

## Shape of the scene

- React Three Fiber. `Scene` is lazily loaded from `ui/App.tsx`, so three.js stays out of the initial bundle.
- `ViewOptions` carries `tactical`, `quality` (`high` | `low`), `bloom` and `fpsCap`. Low quality shortens LOD distances (`ASTEROID_LOD`, `FLEET_LOD` in `constants.ts`) and can cap the frame rate (`FrameCap`). HQ caps `dpr` at `[1, 1.5]` and `Effects.tsx` scales `EffectComposer` `multisampling` down as DPR rises (#239). Bloom is unmounted when it is off, not just disabled.
- `FrameCap` (`RenderLoop.tsx`) also throttles to `PAUSED_FPS` when `engine.paused` is true (unless LQ already caps lower), waking temporarily on pointer/wheel input so orbit and zoom stay smooth (#239).
- `Sky` (`Environment.tsx`) bakes the static per-tier nebula into an equirectangular `WebGLRenderTarget` on mount and tier changes rather than running 3D fBm every frame (#238).
- `Beams` and `Explosions` live in `Fx.tsx`: beams draw as additive instanced open cylinders scaled and oriented per kind (#231), while explosions and warp arrivals share layered instanced core flashes, shockwave rings, and deterministically seeded radial sparks/streaks (#232), hiding empty meshes when idle.
- `Carrier` (`Scene.tsx`) draws its shield as an additive Fresnel rim `ShaderMaterial` with an impact flash when `carrier.shield` drops and a low-shield flicker below `0.25` (#234). Its hull reads `carrier.heading` from the sim and eases toward it with `shortestArc`, rather than inferring facing from `carrier.target` (#161).
- `PIRATE_SCALE` (`frameState.ts`) gives interceptors, gunships and bombers a subtle size difference through the per-instance scale already in `fleetFrame`. Ship layers and trails read it, so wave composition stays readable without adding draw calls (#161).
- `Hazards` and `GasGiant` (`Environment.tsx`) replace wireframe primitives with Fresnel/wave shells (`DEBRIS_SHELL_FRAG`, `RADIATION_FRAG`, `STORM_FRAG` in `geometry.ts`) plus one shared `InstancedMesh` of tumbling debris chunks across all debris hazards (#234).
- Tactical view draws anti-aliased shape-coded icons (`ICON_SHAPE`, `SHAPES` from `ui/palette.ts`), a pulsing warning ring while `wave.warning` is set, and turns on automatically when you zoom far out (#235).
- `FocusReticle`, `MiningSparks` and `SurveyPings` (`Fx.tsx`) draw diegetic cues straight from `fleetFrame` and the view in `useFrame`: a bracket on the focused ship, glints where mining beams meet rock, and expanding radar rings when scouts survey a cluster or chart a hazard. Other carriers' far-LOD ships use soft round point sprites instead of square dots (#235).
- `AudioBridge.tsx` is the only link from the render layer to the lazy `game/audio.ts` synth. It unlocks Web Audio on the first gesture, forwards new events and per-frame FX, and turns button presses into UI clicks; the synth itself holds no React state (#236).
- `CameraRig` eases tactical moves instead of snapping them (cancelling on manual orbit), applies damped shake on hull hits, near explosions and warp jumps, and adds a small FOV kick in the last two seconds of warp charge. Shake and FOV cues respect `prefers-reduced-motion` (#237).

## Per-frame data

- `fleetFrame` (`frameState.ts`) is one shared, preallocated set of typed arrays (`MAX_ENTITIES = 2048`) holding every live ship and pirate, interpolated **once per frame** by `FleetPass`. Docked ships and drones riding in a barge are omitted (#181). Ship layers, trails and beams all read from it. Entities are bucketed by render class (`CLASSES`: ship classes, then pirate).
- `AsteroidField` skips spin, matrix recomputation, and `instanceMatrix` uploads while `engine.paused` is true unless the camera moves, LOD changes, or the asteroid list/system changes (#239).
- Don't allocate in `useFrame`. Reuse module-level scratch vectors, colors and buffers, as the existing components do (`BEAM_SPECS` and scratch matrices in `Fx.tsx`, `chunkBuf` in `Environment.tsx`).
- Read the engine directly in `useFrame` (`engine.view`, `lerpPos`, `lerpCarrier`). Don't route positions through React state.
- R3F mutates three.js objects inside `useFrame` by design, which is why the `react/immutability` lint rule is off.

## Resource lifetime

- Geometries, materials, textures, render targets and baked models allocated in `useMemo` are owned by that component instance and get a `useEffect(() => () => resource.dispose(), [resource])` cleanup. R3F still disposes JSX-declared children; the explicit cleanup covers objects passed through `args` or `material={...}` (#250).
- Module-level scratch objects (`dummy`, `ORE_COLORS`, shard buffers) outlive mounts and are never disposed. `Sky`'s baker target and `CarrierModel`'s baked hull use the same per-instance cleanup rule as everything else.

## LOD and models

- Near entities draw glTF models, and far ones draw an instanced placeholder that scales up so it stays at least `FAR_SHIP_MIN_PX` long.
- Ship and carrier models are the "Foundry" fleet, built procedurally in Blender by `scripts/blender/build_fleet.py` (shapes in `foundry.py`, helpers in `shiplib.py`) into `public/models/foundry_<class>.glb`. `models.ts` relies on the material slot names `hull`, `hull2`, `dark`, `glow` and `metalRed`. `metalRed` is recoloured per class, and `bakeShipModel` splits `glow` into a matching HDR-scaled geometry rendered unlit in `Fleet.tsx` for bloom (#233). Asteroids use Kenney Space Kit `meteor.glb` (CC0) via `bakeModel`.
- To regenerate the models, see `public/models/README.md`. Models are static assets, not bundled.

## Colors

Ship colors live in `SHIP_STATS` (`sim/config.ts`). Other scene colors live in `PALETTE` (`ui/palette.ts`). Both are colour-blind-safe (#125), so reuse them instead of adding hex literals.
