import { expect, test } from '@playwright/test';

test('app loads, renders the canvas, and opens settings without console errors', async ({
  page,
}) => {
  const errors: string[] = [];
  const requested: string[] = [];
  const failed: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });
  page.on('request', (req) => requested.push(req.url()));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');
  await expect(page.locator('canvas').first()).toBeVisible();

  // First visit opens the help modal, which blocks the rest of the UI.
  await page.getByRole('button', { name: 'Take command' }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // The sim runs in a worker under the Pages base path and keeps the mirror moving.
  const sim = () =>
    page.evaluate(() => {
      const f = (globalThis as unknown as { __fleet: { simKind: string; state: { time: number } } })
        .__fleet;
      return { kind: f.simKind, time: f.state.time };
    });
  const before = await sim();
  expect(before.kind).toBe('worker');
  await expect.poll(async () => (await sim()).time).toBeGreaterThan(before.time);

  // With a working worker the main-thread fallback sim is never downloaded.
  expect(requested.filter((u) => /localHost-/.test(u))).toEqual([]);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('saving goes through the worker and survives a reload', async ({ page }) => {
  // `__fleet` is the engine's debug handle; page.evaluate can't close over helpers.
  const state = () =>
    page.evaluate(async () => {
      const f = (
        globalThis as unknown as {
          __fleet: { fullState(): Promise<{ time: number; seed: number }> };
        }
      ).__fleet;
      return f.fullState();
    });
  await page.goto('./');
  await page.getByRole('button', { name: 'Take command' }).click();
  // CI renders in software and starts slowly; any sim progress is enough here.
  await expect.poll(async () => (await state()).time, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Save Management' }).click();
  // Read before saving: the written save is at least this far along.
  const saved = await state();
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  const loaded = await state();
  expect(loaded.seed).toBe(saved.seed);
  expect(loaded.time).toBeGreaterThanOrEqual(saved.time);
});

test('shows a fallback instead of a blank screen without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    // Pretend the GPU is unavailable: every WebGL context request fails.
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext(this: HTMLCanvasElement, id: string, ...rest: unknown[]): unknown;
    };
    const orig = Object.getOwnPropertyDescriptor(proto, 'getContext')!
      .value as typeof proto.getContext;
    proto.getContext = function (id, ...rest) {
      return id.startsWith('webgl') ? null : orig.call(this, id, ...rest);
    };
  });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('3D view unavailable');
  // The rest of the UI still works.
  await page.getByRole('button', { name: 'Take command' }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});
