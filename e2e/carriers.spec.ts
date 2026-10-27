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
  await page.getByRole('tab', { name: 'Research', exact: true }).click();
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

// The HUD wraps onto two rows in a 1024px window; the controls, the carrier bar and the
// side panel must still stack without covering each other.
test('HUD controls and carrier bar stay clickable when the HUD wraps', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const s = makeGame(3);
  const g = stateOf(s);
  const other = structuredClone(g.ops[0]);
  other.id = 77;
  other.systemId = 1;
  g.ops.push(other);
  await seedSave(page, s);
  await openApp(page);

  const covered = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.controls button, .carrier-bar button')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !hit || !b.contains(hit);
      })
      .map((b) => b.textContent?.trim()),
  );
  expect(covered).toEqual([]);
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('heading', { name: 'Star map' })).toBeVisible();
});

// Two carriers in one system: the second is drawn too (#127).
test('another carrier in the viewed system is drawn', async ({ page }) => {
  const s = makeGame(3);
  const g = stateOf(s);
  const other = structuredClone(g.ops[0]);
  other.id = 77;
  g.ops.push(other);
  await seedSave(page, s);
  await openApp(page);

  await expect
    .poll(() => page.evaluate(() => (globalThis as any).__render?.otherCarriers), {
      timeout: 30_000,
    })
    .toBe(1);
});
