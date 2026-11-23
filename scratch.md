# Next up: v0.0.14 review follow-ups

The v0.0.14 review is grouped under five umbrellas:

- **#219** — Bugs and spec drift (#224–#230) — _done_
- **#220** — Visuals, FX and game feel (#231–#237) — _done_
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
- #235, #236, #237: Batch 4b procedural Web Audio synth, UI/camera feel, and diegetic 3D cues (#255) — completes umbrella #220
- #242, #243, #246, #247, #248: Batch 5 pre-Fusion pacing & hazard-safe respawn, safe drone stance, live rule-card badges, progressive disclosure, touch/keyboard hangar moves (#256)

## Batch 6a — Code health (#223)

Clean up structural debt before the larger gameplay additions (completes umbrella #223).

- #250: code health pass (deduplicate hangar board helpers, lint-enforce `sim/` purity, dispose GPU resources, co-locate research scalars, split monoliths)

## Batch 6b — Progression & hangar depth (#222)

- #244: deepen hangar board synergies and add per-class/per-hangar module loadout templates
- #245 _(Option A decided)_: rework Research/Admiralty unlocks, add RP/hr & run stats, and extend mid/late goals

## Batch 6c — Combat fidelity (#161)

- #161: combat fidelity (carrier heading, firing arcs, tracking/evasion, pirate types)

---

## Later

- Background (Tier B) carriers earn from `miningIncomeAvg` and do not deplete the shared field (#207). Making them deplete it would be a balance change.
