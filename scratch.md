# Next up: #169 review follow-ups

The #169 review was split into #170–#190. All of #170–#190 is done (released in v0.0.11).

## Done

- #170, #171, #172: save integrity (#191)
- #190: save fixtures for v11, v12, v16 (#194)
- #173: `buyHangar` takes the next hangar id across every carrier (#196)
- #175: `dispatch` stamps `focusedCarrierId` after a switch (#197)
- #181: `'carried'` round-trips in the frame codec, and carried drones stay hidden (#198)
- #185: offline routes run `floor(t)` seconds (#198)
- #188: held toggle hotkeys do not repeat (#198)
- #189: a new run restarts the runner clock (#198)
- #174: each carrier keeps its own rebuild queue and automation timer (#200)
- #177: switching focus resolves an active wave before `dematerialise` (#199)
- #183: the shop falls back to the focused carrier's hangar after a switch (#204)
- #179: offline rolls no new pirate waves (the departure wave still resolves), and waves never take docked or carried ships (#206)
- #178: carrier lists and rule-card hangar scopes cover every carrier (#205)
- #176: carriers in one system share one live asteroid field (#207)
- #187: `idleUntil` round-trips in the snapshot ship rows (#208)
- #186: `createShip` refuses an explicit slot that is out of range or taken (#209)
- #184: cancelling a warp refunds 75% of the energy and H2 paid; save v19 (#211)
- #180: the low-quality frame cap no longer freezes the camera clock (#212)
- #182: a jump is a camera cut and swaps the field in the jump tick (#210)

## Later

- Background (Tier B) carriers earn from `miningIncomeAvg` and do not deplete the shared field (#207). Making them deplete it would be a balance change.
