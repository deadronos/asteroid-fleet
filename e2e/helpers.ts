import { expect, type Page } from '@playwright/test';
import { order, type Order } from '../src/sim/actions';
import { SAVE_KEY } from '../src/game/save';
import { focused, newGame, stateOf } from '../src/sim/state';
import { SHIP_CLASSES, type GameState, type Sim } from '../src/sim/types';

/** A fresh game built with the real sim, with every ship class unlocked and plenty of credits. */
export function makeGame(seed = 11): Sim {
  const s = focused(newGame(seed));
  s.unlocked = [...SHIP_CLASSES];
  s.credits = 100_000;
  s.savedAt = Date.now();
  return s;
}

/** Run a sim command on a state built outside the page; throws if the sim refuses it. */
export function run(s: Sim, cmd: Order): void {
  const err = order(s, cmd);
  if (err) throw new Error(`${cmd.type}: ${err}`);
}

/**
 * Make the next page load find `state` as the stored save, so the app starts from it
 * through the normal load and migrate path. Seeds once per tab, so a later reload keeps
 * whatever the game saved since. Call before `page.goto`.
 */
export async function seedSave(page: Page, state: Sim): Promise<void> {
  await page.addInitScript(
    ({ key, json }) => {
      try {
        if (sessionStorage.getItem('e2e-seeded')) return;
        sessionStorage.setItem('e2e-seeded', '1');
        localStorage.setItem(key, json);
      } catch {
        /* storage blocked: the test will fail on its own assertions */
      }
    },
    { key: SAVE_KEY, json: JSON.stringify(stateOf(state)) },
  );
}

/** Open the app and get past the first-visit help modal. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take command' }).click();
  // Slow starts otherwise eat the default 5 s of the first assertion after this.
  await engineReady(page);
}

type Fleet = { loaded: boolean; fullState(): Promise<GameState> };

/**
 * Wait until the engine has loaded the save and the sim worker has answered. `fullState()` itself
 * waits on the same startup, so calling it earlier blocks `page.evaluate` for as long as a slow
 * machine takes to boot, then times out the whole test. This polls a cheap synchronous flag
 * instead, and it survives the page navigating underneath it (a reload, for one).
 */
export async function engineReady(page: Page, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      () =>
        page
          .evaluate(() => (globalThis as unknown as { __fleet?: Fleet }).__fleet?.loaded === true)
          .catch(() => false),
      { timeout, message: 'engine did not finish loading' },
    )
    .toBe(true);
}

/** The worker's exact state, through the engine's debug handle, flattened to its one operation. */
export async function simState(page: Page): Promise<Sim> {
  await engineReady(page);
  const g = await page.evaluate(() =>
    (globalThis as unknown as { __fleet: Fleet }).__fleet.fullState(),
  );
  return { ...g, ...g.ops[0] };
}
