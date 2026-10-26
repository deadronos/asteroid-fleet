import type { Page } from '@playwright/test';
import { apply, type Command } from '../src/sim/actions';
import { SAVE_KEY } from '../src/game/save';
import { newGame } from '../src/sim/state';
import { SHIP_CLASSES, type GameState } from '../src/sim/types';

/** A fresh game built with the real sim, with every ship class unlocked and plenty of credits. */
export function makeGame(seed = 11): GameState {
  const s = newGame(seed);
  s.unlocked = [...SHIP_CLASSES];
  s.credits = 100_000;
  s.savedAt = Date.now();
  return s;
}

/** Run a sim command on a state built outside the page; throws if the sim refuses it. */
export function run(s: GameState, cmd: Command): void {
  const err = apply(s, cmd);
  if (err) throw new Error(`${cmd.type}: ${err}`);
}

/**
 * Make the next page load find `state` as the stored save, so the app starts from it
 * through the normal load and migrate path. Seeds once per tab, so a later reload keeps
 * whatever the game saved since. Call before `page.goto`.
 */
export async function seedSave(page: Page, state: GameState): Promise<void> {
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
    { key: SAVE_KEY, json: JSON.stringify(state) },
  );
}

/** Open the app and get past the first-visit help modal. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take command' }).click();
}

/** The worker's exact state, through the engine's debug handle. */
export function simState(page: Page): Promise<GameState> {
  return page.evaluate(() =>
    (globalThis as unknown as { __fleet: { fullState(): Promise<GameState> } }).__fleet.fullState(),
  );
}
