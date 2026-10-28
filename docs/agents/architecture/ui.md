# UI (`src/ui/`)

Source of truth: `App.tsx`, `../game/engine.ts` (`useGame`), `hotkeys.ts`, `Modal.tsx`, `Tabs.tsx`, `styles.css`, `palette.ts`.

## Reading state

- `useGame(selector, equals?)` (`game/engine.ts`) is how components subscribe. The mirror is **mutated in place**, so a selector must return primitives or freshly derived data, compared with a structural `equals` (`shallowEqual` / `deepEqual` in `equal.ts`). Returning a live sub-object with the default `Object.is` will never re-render.
- `useGame()` with no selector re-renders on every UI tick and returns `engine.view`. Use it only for components that genuinely change every tick.
- Write only through `engine.dispatch(order)` / `engine.dispatchFor(carrierId, order)`. `dispatch` names `focusedCarrierId`, which changes as soon as the player switches; the mirror's `focusId` waits for the next state message (#175). A refused order comes back as an `error` message and a toast.

## Structure

- `App.tsx` is the shell: HUD, side panels in `Tabs`, the log/inbox, modals and the lazily loaded scene. Heavy panels (`Scene`, `ResearchPanel`, `SettingsMenu`, `CarrierPanel`, `DoctrinePanel`...) are `lazy()` imports, which keeps the initial bundle inside budget ([../workflow.md](../workflow.md)). New large panels should be lazy too.
- One component per panel file (`FleetPanel`, `CarrierPanel`, `DoctrinePanel`, `RuleCards`, `ResearchPanel`, `StarMap`, `Shipyard`, `Goals`...). Pure helpers sit beside them as `.ts` files (`format.ts`, `inbox.ts`, `cardText.ts`, `mapLayout.ts`, `carriers.ts`) and are unit-tested on their own.
- Text for sim data lives in the UI: event text in `events.ts`, card labels in `cardText.ts`, numbers via `fmt` / `formatSimTime` in `format.ts`.
- Disabled buttons explain why. Refusal reasons come from shared sim helpers such as `warpBlocked` (`sim/warpReason.ts`) or the cost checks in `sim/costs.ts`, so the UI and the command interpreter agree.

## Hotkeys and modals

- All shortcuts go through the central registry in `hotkeys.ts` (`useHotkeys(list)`). It powers the `?` help overlay, so don't add raw `keydown` listeners.
- Modals use the shared accessible `Modal`, which pushes onto a modal stack (`pushModal`, `isTopModal`) so only the top one handles Escape and keys.
- Side tabs use `Tabs` (ARIA tablist).

## Styling

- One stylesheet, `styles.css`, with color and surface tokens as CSS custom properties on `:root` (#136). Use the tokens, not new literals.
- Canvas and tactical colors come from `PALETTE` / `ICON_SHAPE` in `palette.ts`.
