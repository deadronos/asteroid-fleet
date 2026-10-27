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
