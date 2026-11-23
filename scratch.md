# Next up: v0.0.14 review follow-ups

The v0.0.14 review is grouped under five umbrellas:

- **#219** — Bugs and spec drift (#224–#230)
- **#220** — Visuals, FX and game feel (#231–#237)
- **#221** — Performance and render hygiene (#238–#241)
- **#222** — Gameplay, balance and progression (#242–#245)
- **#223** — UX, accessibility, saves and maintainability (#246–#250)

Also open from earlier: **#161** (Combat fidelity: firing arcs, hit chance, evasion and pirate types).

---

## Batch 1 — Quick bug fixes (#219, no design decisions)

Fast, self-contained correctness fixes. Safe to land together or as small PRs before visual/balance work.

- #224: push `'warp'` FX after `enterSystem`, and move `.warp-cut` out of `CarrierBar` so it plays with one carrier
- #225: skip `'carried'` drones in `pirateTargetScore`, `hazards`, `repairDrone`, and `upkeepRate`
- #226: add `128`-instance bounds check in `Explosions`
- #227: make `advanceHeading` frame-rate independent with `easeFactor(dt, ...)`
- #228: emit `s.systems[s.systemId].name` in `CarrierOnline` on deep-space starts

## Batch 2 — Design decisions & save hardening (#219, #223)

Short design calls first, then small high-value correctness & durability PRs.

- #229 _(design decision)_: decide whether shield hits drain energy (`SHIELD_ENERGY_PER_DMG`) or only regen does; clean up unused constants and docs
- #230 _(design decision)_: decide whether live Tier B carriers count toward `oreValueDelivered` (RP/challenges) and burn H2 for Fusion
- #249: tighten multi-carrier tab-close save durability and deep-validate imported saves

## Batch 3 — GPU & UI performance foundation (#221)

Clear GPU/React headroom before layering richer shaders and FX on top.

- #238: bake static per-tier nebula skybox instead of running 5-octave 3D fBm every frame
- #239: tune MSAA/DPR, skip paused asteroid matrix uploads, and throttle paused `frameloop`
- #240: scope `useGame()` selectors across panels to eliminate 5 Hz full-panel re-renders
- #241: clean up remaining sim hot-path allocations (`launch`, `reserveDefs`) and linear scans (`asteroidFarther`, `oreNear`, `repairDrone`)

## Batch 4 — Visuals, FX & game feel: biggest player-facing lift (#220)

Do #231–#234 for immediate 3D impact, then #236–#237 for sound and tactile feel.

- #231: replace 1px `LineSegments` beams with volumetric additive cylinders/quads
- #232: upgrade explosions and warp flashes with particles, shockwaves, and distinct warp FX (depends on #224)
- #233: preserve unlit blooming `glow` slots on baked Foundry ship models
- #234: Fresnel carrier shield with impact flash and upgraded hazard/storm visuals
- #236: procedural Web Audio synthesizer for combat, warp, alerts and UI (with Settings volume/mute)
- #237: UI micro-transitions, hull-hit/warp camera feedback, and eased tactical camera transitions
- #235: diegetic 3D cues (focused-ship reticle, mining sparks, scout survey pings, antialiased tactical icons, wave direction)

## Batch 5 — Gameplay balance & UX polish (#222, #223)

Fix the pre-Fusion plateau and onboarding friction so the improved visuals back a smooth 1st-hour and mid-game curve.

- #242: diagnose the 4h income collapse (`301/s -> 1.6/s` at 1000 E), smooth T1/T2 rush, and ease the pre-Fusion solar wall against `pnpm run balance`
- #243: fix default `safe` drone stance stalling when the carrier parks away from covered rocks
- #246: live active/firing status badges on Rule Cards
- #247: progressive disclosure for `ResearchPanel` and lighter first-run onboarding
- #248: click/tap and keyboard ship movement on Hangar boards (fixes mobile/touch and keyboard access)

## Batch 6 — Deeper systems & code health (#222, #223, #161)

Larger feature/refactor bets once the core loop feels crisp.

- #244: deepen hangar board synergies and add per-class/per-hangar module loadout templates
- #245 _(design decision)_: rework Research/Admiralty unlocks, add RP/hr & run stats, and extend mid/late goals
- #250: code health pass (deduplicate hangar board helpers, lint-enforce `sim/` purity, dispose GPU resources, co-locate research scalars, split monoliths)
- #161: combat fidelity (carrier heading, firing arcs, tracking/evasion, pirate types)

---

## Later

- Background (Tier B) carriers earn from `miningIncomeAvg` and do not deplete the shared field (#207). Making them deplete it would be a balance change.
