# Saves and migrations

Source of truth: `src/sim/state.ts` (`SAVE_VERSION`), `src/game/migrate.ts`, `src/game/save.ts`, `src/game/slots.ts`, `src/game/fixtures/`, `src/game/save.test.ts`; the start-over buttons in `src/ui/App.tsx` and `src/ui/Settings.tsx`.

## Format

Saves are JSON documents of the whole `GameState`, stamped with `SAVE_VERSION`. On load, and again on import, `migrate()` (`src/game/migrate.ts`) brings an older save up to that version. It runs one step per version, in order: `migrations[n]` rewrites a version `n` save into version `n + 1`, then the next step runs, until `SAVE_VERSION`. A missing step for a version the build claims to support makes the save "unknown", and it gets backed up rather than dropped.

Steps run on the raw JSON, before timers are restored. A wave or storm timer that means "never" is still `null` at that point, because that is how `Infinity` survives `JSON.stringify`. After the steps, `validateSave` checks the required fields and repairs the ones that can safely default (for example a non-finite `miningIncomeAvg`, or an empty `systems` list rebuilt from `seed`).

## Changing the save schema

Every schema change needs all three:

1. Bump `SAVE_VERSION` in `src/sim/state.ts`.
2. Add the `migrations[n]` step that upgrades the previous version, with a `// vN: what changed (#issue).` comment.
3. Check in a fixture of the previous version as `src/game/fixtures/save-v<n>.json`, plus a test that loads it and migrates it to the current version. Add it to the `it.each` list in `save.test.ts` that migrates every fixture and runs it through `step()`.

A new `Operation` or `GameState` field also needs the `OP_KEYS` / `GAME_KEYS` entry and `pnpm run gen:view` (see [architecture/sim.md](architecture/sim.md)).

## Version history

| Version | Change                                                                                                                                                                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2      | Automation settings and a per-hangar auto-buy target (#11).                                                                                                                                                                                                                                                                            |
| v3      | `fields`: per-system depletion records (#14). Leaving a system keeps `[index, oreFraction, respawn]` for each rock that is not full. On return the field is regenerated from the seed, the record applied, and refill added for the time away (`FIELD_REFILL_SECS`). All records stay under 16 KB, tested in `src/sim/fields.test.ts`. |
| v4      | `containers` (cargo dropped by destroyed barges, salvaged by haulers until it decays) and `Ship.bargeId` (`-1` for the carrier) (#13).                                                                                                                                                                                                 |
| v5      | `Ship.modules` (at most `MODULE_SLOTS[cls]`) and `recon` (surveyed clusters, rich veins, charted hazards; cleared on every jump) (#9).                                                                                                                                                                                                 |
| v6      | `miningIncomeAvg` is guaranteed finite. Older saves lacked it, so offline settlement paid nothing (#38).                                                                                                                                                                                                                               |
| v7      | Every asteroid draws its rare-ore roll whether or not rare ore is researched, so fields generate differently. Old `fields` records are dropped (#40).                                                                                                                                                                                  |
| v8      | Typed events replace plain-text log lines. Old lines keep their text (#72).                                                                                                                                                                                                                                                            |
| v9      | Condition/action cards replace the fixed rules, and each rule becomes its preset card (#82).                                                                                                                                                                                                                                           |
| v10     | Per-carrier state moves into `ops: Operation[]`, and the one carrier becomes operation `0` (#75).                                                                                                                                                                                                                                      |
| v11     | Hull classes: `GameState.hulls`, `Carrier.hullClass = 'standard'` (#65).                                                                                                                                                                                                                                                               |
| v12     | Per-carrier alert rules in Doctrine (#79).                                                                                                                                                                                                                                                                                             |
| v13     | Admiralty Marks and the second prestige layer (#68).                                                                                                                                                                                                                                                                                   |
| v14     | Admiralty upgrade shop (#69).                                                                                                                                                                                                                                                                                                          |
| v15     | Run modifiers and challenge runs: `modifiers`, `challenge`, `challengesDone` (#71).                                                                                                                                                                                                                                                    |
| v16     | Supply routes between carriers: `routes` (#80).                                                                                                                                                                                                                                                                                        |
| v17     | A jump in progress stores its full charge time, `warp.total`.                                                                                                                                                                                                                                                                          |

## Storage

- The primary save is under `asteroid-fleet-save` in IndexedDB (`idb-keyval`). The localStorage copy is written only when IndexedDB cannot hold it, and a stale copy is removed, so a large fleet does not fill the ~5 MB localStorage quota the slots use (#40). When IndexedDB rejects a write that localStorage keeps, the older IndexedDB copy is deleted, because loads read IndexedDB first and it would shadow the newer save. If both stores reject the write, the old copy stays, since it is then the only save (#171).
- Manual slots (`slots.ts`, `SLOT_COUNT = 3`) live in localStorage under `asteroid-fleet-slot-<n>`. Settings live under their own key (`game/settings.ts`), so a reset or import never touches them.
- Autosave runs every 15 s from the engine. A failed autosave or slot write shows a toast once, until a write succeeds again.

## Corrupt, newer or unknown saves

Such a save is never deleted or overwritten:

- The raw text is copied to `asteroid-fleet-save-backup` in both IndexedDB and localStorage. A later failure that is byte-for-byte the same does not rewrite it. A different failure goes to `asteroid-fleet-save-backup-<timestamp>`. Only the newest `MAX_BACKUPS = 5` are kept per store.
- The game shows `SAVE_BACKUP_NOTICE` and pauses autosave so the original stays put. If both stores reject the copy, it shows the "could not be backed up" notice instead, and a reset or import then warns that the save will be lost.
- A hard reset or successful import may reuse the primary key. Backup keys are left alone. A bad import is rejected and writes nothing.
- Every way to start over from the notice or Settings (hard reset, "Start new game (keeps backup)", import) clears the active slot first, so the new run is not copied into a slot (#172).
