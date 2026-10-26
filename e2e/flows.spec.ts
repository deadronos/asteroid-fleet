import { expect, test, type Page } from '@playwright/test';
import { DOCK_RADIUS } from '../src/sim/config';
import type { GameState } from '../src/sim/types';
import { makeGame, openApp, run, seedSave, simState } from './helpers';

// Flows that rewrite saves or core state. They start from saves built with the real sim and
// assert on structure (what resets, what persists), not on balance numbers or log strings.

const shipIds = (s: GameState) => s.ships.map((x) => x.id).sort((a, b) => a - b);

const levels = (g: GameState) => Object.values(g.researchLevels).reduce((a, b) => a + b, 0);

async function openSettingsSaves(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Save Management' }).click();
}

test.describe('prestige and research', () => {
  test('prestige pays RP, a node can be bought, and credits/ships reset while research persists', async ({
    page,
  }) => {
    const s = makeGame(5);
    run(s, { type: 'buyShip', cls: 'drone', hangarId: 1 });
    run(s, { type: 'buyShip', cls: 'hauler', hangarId: 1 });
    s.research = 3;
    s.researchLevels.startCredits = 1;
    s.stats.oreValueDelivered = 4_000_000;
    s.stats.furthestTier = 1;
    const before = { credits: s.credits, ships: s.ships.length };
    expect(before.ships).toBeGreaterThanOrEqual(2);
    await seedSave(page, s);
    await openApp(page);

    await page.getByRole('button', { name: 'Research', exact: true }).click();
    await expect(page.getByText('Research points available')).toBeVisible();
    await page.getByRole('button', { name: 'Prestige…' }).click();
    await page.getByRole('button', { name: 'Yes, reset' }).click();

    await expect.poll(async () => (await simState(page)).lifetime.prestiges).toBe(1);
    const reset = await simState(page);
    // Reserves refill the starting drones, but the hauler bought this run is gone.
    expect(reset.ships.some((x) => x.cls === 'hauler')).toBe(false);
    expect(reset.credits).toBeLessThan(before.credits);
    expect(reset.stats.oreValueDelivered).toBe(0);
    expect(reset.research).toBeGreaterThan(3);
    expect(reset.lifetime.researchEarned).toBeGreaterThan(0);
    expect(reset.unlocked).toContain('hauler');
    expect(reset.researchLevels.startCredits).toBe(1);

    // Spend RP on whichever node is affordable.
    const node = page
      .locator('.node button:enabled')
      .filter({ hasText: /\d+ RP/ })
      .first();
    await node.click();
    await expect.poll(async () => levels(await simState(page))).toBe(levels(reset) + 1);
    const bought = await simState(page);
    expect(bought.research).toBeLessThan(reset.research);
    expect(bought.lifetime.prestiges).toBe(1);
    expect(bought.ships.some((x) => x.cls === 'hauler')).toBe(false);
    expect(bought.unlocked).toContain('hauler');

    // The split survives a save and reload.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Save Management' }).click();
    await page.getByRole('button', { name: 'Save now' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.waitForTimeout(300);
    await page.reload();
    await expect.poll(async () => (await simState(page)).lifetime.prestiges).toBe(1);
    const reloaded = await simState(page);
    expect(levels(reloaded)).toBe(levels(bought));
    expect(reloaded.unlocked).toContain('hauler');
  });
});

/** Warp fixture: a barge carrying a drone, a docked drone, and a warp charging to system 1. */
function warpGame(charge: number) {
  const s = makeGame(21);
  s.researchLevels.bargeBay = 1;
  run(s, { type: 'buyShip', cls: 'barge', hangarId: 2 });
  run(s, { type: 'buyShip', cls: 'drone', hangarId: 2 });
  run(s, { type: 'buyShip', cls: 'drone', hangarId: 1 });
  run(s, { type: 'buyShip', cls: 'drone', hangarId: 1 });
  const barge = s.ships.find((x) => x.cls === 'barge')!;
  const [bayDrone, docked, straggler] = s.ships.filter((x) => x.cls === 'drone');
  // The barge is back at the carrier but not yet docked, with its drone riding in the bay.
  const near = { ...s.carrier.pos, x: s.carrier.pos.x + DOCK_RADIUS * 0.5 };
  barge.mode = 'idle';
  barge.pos = { ...near };
  bayDrone.mode = 'carried';
  bayDrone.bargeId = barge.id;
  bayDrone.pos = { ...near };
  // Far out in space, beyond anything a recall could bring home in time.
  straggler.mode = 'idle';
  straggler.pos = { ...s.carrier.pos, x: s.carrier.pos.x + 5_000 };
  s.carrier.energy = 5_000;
  s.systems[1].discovered = true;
  run(s, { type: 'warp', systemId: 1 });
  s.warp!.charge = charge;
  return { s, barge, bayDrone, docked, straggler };
}

test.describe('warp', () => {
  test('jump now loses the ship left outside; docked ships and the barge stay aboard', async ({
    page,
  }) => {
    const { s, barge, bayDrone, docked, straggler } = warpGame(600);
    await seedSave(page, s);
    await openApp(page);

    await expect(page.locator('.alert.warp')).toContainText('1 outside');
    await page.getByRole('button', { name: 'Jump now' }).click();

    await expect.poll(async () => (await simState(page)).systemId).toBe(1);
    const after = await simState(page);
    expect(after.warp).toBeNull();
    expect(after.stats.shipsLost).toBe(s.stats.shipsLost + 1);
    const ids = shipIds(after);
    // Reserves may add other ships; the three that were home must all still be here.
    expect(ids).toEqual(expect.arrayContaining([barge.id, bayDrone.id, docked.id]));
    expect(ids).not.toContain(straggler.id);
  });

  test('a charge that runs out jumps on its own with the same split', async ({ page }) => {
    const { s, barge, bayDrone, docked, straggler } = warpGame(3);
    await seedSave(page, s);
    await openApp(page);

    await expect.poll(async () => (await simState(page)).systemId, { timeout: 30_000 }).toBe(1);
    const after = await simState(page);
    expect(after.warp).toBeNull();
    const ids = shipIds(after);
    // Reserves may add other ships; the three that were home must all still be here.
    expect(ids).toEqual(expect.arrayContaining([barge.id, bayDrone.id, docked.id]));
    expect(ids).not.toContain(straggler.id);
    await expect(page.locator('.alert.warp')).toHaveCount(0);
  });
});

test.describe('offline settlement and save export/import', () => {
  test('a save with an old timestamp shows the away report on load', async ({ page }) => {
    const s = makeGame(31);
    run(s, { type: 'buyShip', cls: 'drone', hangarId: 1 });
    s.miningIncomeAvg = 10;
    s.savedAt = Date.now() - 2 * 3600 * 1000;
    const credits = s.credits;
    await seedSave(page, s);
    await page.goto('./');

    const modal = page.getByRole('heading', { name: 'Welcome back, admiral' });
    await expect(modal).toBeVisible();
    await expect(page.locator('.modal', { has: modal })).toContainText('You were away for 2 h');
    const settled = await simState(page);
    expect(settled.credits).toBeGreaterThan(credits);
    expect(settled.ships.length).toBeGreaterThanOrEqual(1);

    // First visit stacks the help modal over the report.
    await page.getByRole('button', { name: 'Take command' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(modal).toHaveCount(0);
  });

  test('a fresh save shows no away report', async ({ page }) => {
    await seedSave(page, makeGame(32));
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Take command' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome back, admiral' })).toHaveCount(0);
  });

  test('exported text imports back to the same state', async ({ page }) => {
    const s = makeGame(41);
    run(s, { type: 'buyShip', cls: 'drone', hangarId: 1 });
    run(s, { type: 'buyShip', cls: 'hauler', hangarId: 2 });
    s.research = 7;
    s.researchLevels.startCredits = 1;
    await seedSave(page, s);
    await openApp(page);
    page.on('dialog', (d) => void d.accept());

    // Freeze the sim so the exported and re-imported states can be compared exactly.
    await page.getByTitle('Pause', { exact: true }).click();
    const original = await simState(page);
    await openSettingsSaves(page);
    await page.getByRole('button', { name: 'Export text' }).click();
    const text = await page.locator('textarea[readonly]').inputValue();
    expect(text.length).toBeGreaterThan(100);

    // Change the game, then bring the exported one back.
    await page.getByRole('button', { name: 'Close' }).click();
    await page.evaluate(() =>
      (globalThis as unknown as { __fleet: { dispatch(c: object): void } }).__fleet.dispatch({
        type: 'buyShip',
        cls: 'drone',
        hangarId: 1,
      }),
    );
    await expect
      .poll(async () => (await simState(page)).ships.length)
      .toBe(original.ships.length + 1);

    await openSettingsSaves(page);
    await page.getByRole('button', { name: 'Import text' }).click();
    await page.getByPlaceholder('Paste an exported save here.').fill(text);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('Save imported.')).toBeVisible();

    const imported = await simState(page);
    expect(imported.seed).toBe(original.seed);
    expect(imported.credits).toBe(original.credits);
    expect(imported.research).toBe(original.research);
    expect(imported.researchLevels).toEqual(original.researchLevels);
    expect(imported.unlocked).toEqual(original.unlocked);
    expect(shipIds(imported)).toEqual(shipIds(original));
    expect(imported.hangars.map((h) => h.items)).toEqual(original.hangars.map((h) => h.items));
  });

  test('importing garbage is rejected and leaves the game alone', async ({ page }) => {
    await seedSave(page, makeGame(42));
    await openApp(page);
    const before = await simState(page);
    await openSettingsSaves(page);
    await page.getByRole('button', { name: 'Import text' }).click();
    await page.getByPlaceholder('Paste an exported save here.').fill('not a save');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('could not be decoded')).toBeVisible();
    expect((await simState(page)).seed).toBe(before.seed);
  });
});
