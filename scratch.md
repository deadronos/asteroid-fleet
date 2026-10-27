# Next steps: open issues triage (2026-10-27)

There are 20 open issues (#117–#136), all filed 27 Oct from a review pass, and one open PR.

## 1. Review and merge PR #137

- [ ] **#137** fixes **#123** (log timestamps wrap every 24 h). It's an outside contribution (bfs2021) touching 3 files: a new `formatSimTime` in `src/ui/format.ts` with 7 tests.
- Only GitGuardian ran in CI, so run the tests and the build locally before merging.

## 2. Small bugs (effort S, well specified)

- [ ] **#117 Tactical view stays on after toggling it off.** Auto-tactical latches on.
  - Fix: pull the toggle/auto logic into a pure function next to `focus.ts`, add hysteresis (on above 200, off below 160), and write a unit test.
  - Code: `src/render/CameraRig.tsx:81-92`
- [ ] **#118 Settings dialog jumps when you switch tabs.**
  - Fix (CSS only): give the modal a fixed height, e.g. `.modal.settings { height: min(560px, 90vh) }`, and let only the body scroll. Check the Star map modal for the same problem.
- [ ] **#126 Carrier render fixes** in `src/render/Scene.tsx`:
  - The carrier spins the long way round when its heading wraps: wrap the delta to [-π, π] and use `easeFactor`.
  - The warp ring assumes a 15 s charge, which is wrong for other hulls and after research: store `warp.total`, or reuse the helper the action uses.
  - The tactical marker and rings use the raw tick position: switch to the interpolated carrier position.
  - Hoist the inline `THREE.Color` calls to module constants.
- [ ] **#127 Other carriers in the same system are invisible** (effort M).
  - Fix: the snapshot should carry the other carriers' positions and ships, and render should draw them. Add an e2e test in `e2e/carriers.spec.ts`.
  - This is a gap left by the "Buy a second carrier" work (#78).

## 3. After that, grouped by theme

### UX and onboarding

- [ ] #121 First-run goals checklist and a glossary (the biggest win for new players)
- [ ] #120 Explain why buttons are disabled; loading feedback for Map and HQ
- [ ] #122 Panel clarity: cargo heat in safe systems, Doctrine density, empty Audio tab
- [ ] #131 Hotkey registry and a shortcut help overlay

### Performance

- [ ] #130 `useGame` selector so panels stop re-rendering at 5 Hz (cheapest, most widely felt)
- [ ] #128 Render: one interpolation pass per frame, bucket ships by class, drop per-frame allocations
- [ ] #129 Postprocessing: unmount bloom when off, restore HQ anti-aliasing

### Accessibility

- [ ] #119 Shared accessible Modal; ARIA tabs and keyboard access for the side panel. Do this first, since it also makes #118 easier.
- [ ] #136 Move raw colours into design tokens
- [ ] #125 Colour-blind-safe palette and shape coding for the tactical view

### Maintainability

These are easier to do when fewer feature PRs are open:

- [ ] #132 Split `src/sim/state.ts` and generate the SimView accessors
- [ ] #133 Move magic numbers into `config.ts` and remove small duplications

Smaller cleanup:

- [ ] #134 Build hygiene: bundle headroom, stale budget comment, favicon 404, Vite warnings
- [ ] #135 Test coverage reporting and component tests for the main panels

### Visuals

- [ ] #124 Carrier model, closer default camera and readable drones (more open-ended, so leave it for later)

## Suggested order

1. Merge #137.
2. Do #117, #118 and #126, as one bug-fix PR or three quick ones.
3. Do #127.
4. Do #119 and #130.
5. Do #121, then the rest.
