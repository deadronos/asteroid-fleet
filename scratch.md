# Next up: #169 review follow-ups

The #169 review was split into #170–#190. This is the remaining work, in suggested order.

## Done

- #170, #171, #172: save integrity (#191)
- #190: save fixtures for v11, v12, v16 (#194)
- #173: `buyHangar` takes the next hangar id across every carrier (#196)

## 1. Quick fixes

Each is a small change with one test.

- [ ] #175 `dispatch` stamps the old carrier after a switch: use `focusedCarrierId` (`src/game/engine.ts:341`)
- [ ] #181 `'carried'` missing from frame codec `MODES` (`src/game/protocol.ts:19`), plus a test that every `ShipMode` round-trips
- [ ] #185 offline route loop runs `ceil(t)` seconds: use `Math.floor(t)` (`src/sim/actions.ts:493`)
- [ ] #188 held toggle hotkeys repeat: ignore `e.repeat` (`src/ui/hotkeys.ts:48`)
- [ ] #189 runner `replace` keeps `lastPump`: call `resetClock()` (`src/game/runner.ts:113`)

## 2. Multi-carrier correctness

- [ ] #174 one auto-rebuild queue for all carriers: add the carrier id to entries, or move the queue onto `Operation` (needs a save migration)
- [ ] #177 switching focus deletes an active wave: resolve it before `dematerialise`
- [ ] #183 shop keeps a stale hangar after a carrier switch: key `FleetPanel` by carrier
- [ ] #178 UI lists read `engine.state.ops` (focused only): use `engine.carriers`

## 3. Rendering

- [ ] #180 low-quality frame cap freezes the camera (R3F `advance` with `frameloop: 'never'`)
- [ ] #182 camera eases across a jump: treat a `systemId` change as a cut in `adopt`

## 4. Small sim fixes

- [ ] #184 cancel warp refunds only energy: store the payment split on `s.warp` (needs a save migration)
- [ ] #186 `createShip` with `start` skips the slot fit
- [ ] #187 `idleUntil` missing from the snapshot codec

## Needs a decision from Lars first

- [ ] #176 should carriers in one system share a live field? Today each carrier mines its own copy, and the depletion record is consumed by whichever carrier enters next.
- [ ] #179 offline: safe (as the README says) or risky (as #103 built)? Either way, `rollWave` must stop destroying docked ships.
