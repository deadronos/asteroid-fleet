import { expect, test } from '@playwright/test';
import { makeGame, openApp, seedSave } from './helpers';
import { stateOf } from '../src/sim/state';

// A second carrier in another system, injected into the save (buying one comes with #78).
test('switching carriers with the bar and the 1–9 hotkeys', async ({ page }) => {
  const s = makeGame(3);
  const g = stateOf(s);
  const other = structuredClone(g.ops[0]);
  other.id = 77;
  other.systemId = 1;
  g.ops.push(other);
  await seedSave(page, s);
  await openApp(page);

  const bar = page.getByRole('navigation', { name: 'Carriers' });
  await expect(bar.getByRole('button')).toHaveCount(2);
  await expect(bar.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');

  await bar.getByRole('button').nth(1).click();
  await expect(bar.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (globalThis as any).__fleet.view.id)).toBe(77);

  await page.keyboard.press('1');
  await expect(bar.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => page.evaluate(() => (globalThis as any).__fleet.view.id))
    .toBe(g.ops[0].id);
});

test('buying a second carrier from the Research panel', async ({ page }) => {
  test.setTimeout(90_000);
  const s = makeGame(3);
  const g = stateOf(s);
  g.lifetime.admiralties = 3;
  g.credits = 1_000_000;
  await seedSave(page, s);
  await openApp(page);

  const bar = page.getByRole('navigation', { name: 'Carriers' });
  await expect(bar).toHaveCount(0);
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('button', { name: /Buy carrier/ }).click();
  await expect(bar.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Buy carrier/ })).toBeDisabled();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Save Management' }).click();
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(bar.getByRole('button')).toHaveCount(2, { timeout: 30_000 });
});
