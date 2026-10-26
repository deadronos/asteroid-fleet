import { expect, test } from '@playwright/test';
import { PRESETS } from '../src/sim/config';
import { unlockRule } from '../src/sim/state';
import type { RuleId } from '../src/sim/types';
import { makeGame, openApp, seedSave, simState } from './helpers';

// The Doctrine panel's rule-card editor (#82): add, edit, reorder, toggle, delete,
// re-add a preset, and the cards survive a save and reload.

test('rule cards can be added, edited, reordered and deleted', async ({ page }) => {
  const s = makeGame(9);
  for (const id of Object.keys(PRESETS) as RuleId[]) unlockRule(s, id);
  const presets = s.cards.length;
  expect(presets).toBe(Object.keys(PRESETS).length);
  await seedSave(page, s);
  await openApp(page);
  await page.getByRole('button', { name: 'Doctrine', exact: true }).click();
  await expect(page.getByText(`${presets} / 12`)).toBeVisible();

  // Add: drones fall back when their hull is low.
  await page.getByRole('button', { name: '+ New card' }).click();
  await page.getByLabel('Who').selectOption({ label: 'Drones' });
  await page.getByLabel('Condition 1').selectOption({ label: 'Hull below' });
  await page.getByLabel('Action').selectOption({ label: 'Fall back to the carrier' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await simState(page)).cards.length).toBe(presets + 1);
  const added = (await simState(page)).cards.at(-1)!;
  expect(added).toMatchObject({
    enabled: true,
    scope: { kind: 'class', cls: 'drone' },
    when: [{ kind: 'hullBelow', value: 0.3 }],
    then: { kind: 'fallBack' },
  });
  const row = page.locator(`[data-card="${added.id}"]`);
  await expect(row).toContainText('when hull below 30 %');

  // Edit: add a second condition.
  await row.getByTitle('Edit').click();
  await page.getByRole('button', { name: '+ and…' }).click();
  await page.getByLabel('Condition 2').selectOption({ label: 'Storm active' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await simState(page)).cards.find((c) => c.id === added.id)?.when)
    .toEqual([{ kind: 'hullBelow', value: 0.3 }, { kind: 'storm' }]);
  await expect(row).toContainText('and storm active');

  // Reorder: move it up one place.
  await row.getByTitle('Move up').click();
  await expect
    .poll(async () => (await simState(page)).cards.findIndex((c) => c.id === added.id))
    .toBe(presets - 1);

  // Toggle it off.
  await row.getByLabel('Card enabled').click();
  await expect
    .poll(async () => (await simState(page)).cards.find((c) => c.id === added.id)?.enabled)
    .toBe(false);

  // Delete a preset, then deal it again from the picker.
  const park = (await simState(page)).cards.find((c) => c.preset === 'haulerPark')!;
  await page.locator(`[data-card="${park.id}"]`).getByTitle('Delete').click();
  await expect
    .poll(async () => (await simState(page)).cards.some((c) => c.preset === 'haulerPark'))
    .toBe(false);
  await page
    .getByLabel('Add a preset card')
    .selectOption({ label: 'Haulers: park at the carrier when idle' });
  await expect.poll(async () => (await simState(page)).cards.at(-1)?.preset).toBe('haulerPark');

  // Delete the new card.
  await row.getByTitle('Delete').click();
  await expect
    .poll(async () => (await simState(page)).cards.some((c) => c.id === added.id))
    .toBe(false);

  // Cards persist through a save and reload.
  const before = (await simState(page)).cards;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Save Management' }).click();
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.waitForTimeout(300);
  await page.reload();
  await expect.poll(async () => (await simState(page)).cards).toEqual(before);
});
