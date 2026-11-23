# Next up: v0.0.14 review follow-ups

The v0.0.14 review is grouped under five umbrellas:

- **#219** — Bugs and spec drift (#224–#230) — _done_
- **#220** — Visuals, FX and game feel (#231–#237)
- **#221** — Performance and render hygiene (#238–#241) — _done_
- **#222** — Gameplay, balance and progression (#242–#245)
- **#223** — UX, accessibility, saves and maintainability (#246–#250)

Also open from earlier: **#161** (Combat fidelity: firing arcs, hit chance, evasion and pirate types).

---

## Done

- #224, #225, #226, #227, #228: Batch 1 quick bug fixes (#251)
- #229, #230, #249: Batch 2 shield constants, Tier B RP/Fusion, save durability & deep validation (#252) — completes umbrella #219
- #238, #239, #240, #241: Batch 3 GPU, React UI, and sim hot-path performance (#253) — completes umbrella #221
- #231, #232, #233, #234: Batch 4a volumetric beams, particle explosions, ship glow, Fresnel shields & hazards (#254)

## Batch 4b — Audio, UI feel & diegetic cues (#220)

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
- #245 _(Option A decided)_: rework Research/Admiralty unlocks, add RP/hr & run stats, and extend mid/late goals
- #250: code health pass (deduplicate hangar board helpers, lint-enforce `sim/` purity, dispose GPU resources, co-locate research scalars, split monoliths)
- #161: combat fidelity (carrier heading, firing arcs, tracking/evasion, pirate types)

---

## Later

- Background (Tier B) carriers earn from `miningIncomeAvg` and do not deplete the shared field (#207). Making them deplete it would be a balance change.
