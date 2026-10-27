import { expect, test } from '@playwright/test';
import { makeGame, openApp, seedSave } from './helpers';
import { stateOf } from '../src/sim/state';

test('star map: switch carriers and set up a supply route', async ({ page }) => {
  const s = makeGame(3);
  const g = stateOf(s);
  const other = structuredClone(g.ops[0]);
  other.id = 77;
  other.systemId = 1;
  g.ops.push(other);
  await seedSave(page, s);
  await openApp(page);

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByRole('dialog', { name: 'Star map' });
  await expect(map).toBeVisible();
  await expect(map.getByRole('button', { name: /^Carrier / })).toHaveCount(2);

  await map
    .getByRole('button', { name: /^Carrier / })
    .nth(1)
    .click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__fleet.view.id)).toBe(77);

  await map.getByRole('combobox', { name: 'Route resource' }).selectOption('h2');
  await map.getByRole('button', { name: 'Add route' }).click();
  await expect(map.getByRole('button', { name: /^Remove route/ })).toHaveCount(1);
  await expect(map.getByText(/% intercept/)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
});
