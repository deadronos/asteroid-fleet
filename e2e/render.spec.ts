import { expect, test, type Page } from '@playwright/test';

// Draw calls per frame with 400 ships out, summed over all passes (bloom included).
// Ships, trails and asteroids are instanced, so this does not grow with fleet size.
const DRAW_CALL_BUDGET = 60;

type Win = {
  __fleet: {
    fullState(): Promise<{ nextId: number; ops: { ships: Record<string, unknown>[] }[] }>;
    replace(s: unknown): void;
  };
  __render?: { calls: number; triangles: number };
};

/** Replaces the fleet with `count` ships spread around the carrier, cycling classes. */
async function spawnFleet(page: Page, count: number) {
  await page.evaluate(async (count) => {
    const f = (globalThis as unknown as Win).__fleet;
    const s = await f.fullState();
    const classes = ['drone', 'barge', 'hauler', 'fighter', 'scout', 'repair', 'harvester'];
    const op = s.ops[0];
    const base = op.ships[0];
    op.ships = Array.from({ length: count }, (_, i) => {
      const r = 20 + (i % 40) * 3;
      const a = i * 2.399;
      return {
        ...structuredClone(base),
        id: s.nextId + i,
        cls: classes[i % classes.length],
        mode: 'toAsteroid',
        pos: { x: Math.cos(a) * r, y: ((i % 9) - 4) * 2, z: Math.sin(a) * r },
      };
    });
    s.nextId += count;
    f.replace(s);
  }, count);
}

/** Frames rendered per second, counted from the stats object RenderStats replaces each frame. */
function renderRate(page: Page, ms = 2000) {
  return page.evaluate(
    (ms) =>
      new Promise<number>((done) => {
        const w = globalThis as unknown as Win;
        let last = w.__render;
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          if (w.__render !== last) {
            last = w.__render;
            n++;
          }
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else done((n * 1000) / ms);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

test('400 ships stay within the draw-call budget; low quality caps the frame rate', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const models: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/asteroid-fleet/models/')) models.push(r.status());
  });

  await page.goto('./');
  await page.getByRole('button', { name: 'Take command' }).click();
  await expect.poll(() => models.length, { timeout: 20_000 }).toBe(9);
  expect(models.every((s) => s === 200)).toBe(true);

  await spawnFleet(page, 400);
  await page.waitForTimeout(1500);
  const high = await page.evaluate(() => (globalThis as unknown as Win).__render!);
  console.log(`high quality, 400 ships: ${high.calls} draw calls, ${high.triangles} triangles`);
  expect(high.calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

  await page.getByRole('button', { name: 'HQ' }).click();
  await page.waitForTimeout(500);
  const low = await page.evaluate(() => (globalThis as unknown as Win).__render!);
  console.log(`low quality, 400 ships: ${low.calls} draw calls, ${low.triangles} triangles`);
  expect(low.calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  // Default cap is 30 fps; allow slack for timer jitter.
  const fps = await renderRate(page);
  console.log(`low quality render rate: ${fps.toFixed(1)} fps`);
  expect(fps).toBeLessThanOrEqual(33);

  expect(errors).toEqual([]);
});
