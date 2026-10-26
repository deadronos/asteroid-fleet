import { describe, expect, it } from 'vitest';
import { PointGrid } from './spatial';
import { stressGame } from './stress';
import { step } from './tick';

// The sim runs at 10 Hz in a Web Worker (#7). 8 ms per tick keeps a
// 1000-ship fleet under 10% of one core and still allows a minute of
// catch-up (600 ticks) in about 5 s. It is several times the
// locally measured cost so slower CI runners stay green.
const BUDGET_MS = 8;

describe('scaling', () => {
  it('ticks 1000 ships and 600 asteroids within budget', () => {
    const s = stressGame(1000, 600, 40);
    for (let i = 0; i < 50; i++) step(s);
    const n = 200;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step(s);
    const ms = (performance.now() - t0) / n;
    console.log(
      `tick: ${ms.toFixed(2)} ms (${s.ships.length} ships, ${s.asteroids.length} asteroids)`,
    );
    expect(s.ships.length).toBeGreaterThan(800);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('ticks 1000 ships with auto-buy and auto-rebuild within budget', () => {
    const s = stressGame(1000, 600, 40);
    s.researchLevels.autoBuy = 1;
    s.researchLevels.autoRebuild = 1;
    s.automation.autoBuy = true;
    s.automation.autoRebuild = true;
    s.credits = 1e12;
    // Steady state: every hangar wants what it holds, so each pass scans every slot and class.
    for (const h of s.hangars)
      for (const it of h.items) {
        const cls = s.ships.find((x) => x.id === it.shipId)!.cls;
        h.target[cls] = (h.target[cls] ?? 0) + 1;
      }
    for (let i = 0; i < 50; i++) step(s);
    const n = 200;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step(s);
    const ms = (performance.now() - t0) / n;
    console.log(`tick with automation: ${ms.toFixed(2)} ms (${s.ships.length} ships)`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('stays deterministic at scale', () => {
    const a = stressGame(300, 300, 30, 5);
    const b = stressGame(300, 300, 30, 5);
    for (let i = 0; i < 300; i++) {
      step(a);
      step(b);
    }
    expect(JSON.stringify({ ...a, savedAt: 0 })).toEqual(JSON.stringify({ ...b, savedAt: 0 }));
  });

  it('grid rings visit every point once', () => {
    const pts = Array.from({ length: 500 }, (_, i) => ({
      pos: { x: Math.sin(i * 1.3) * 90, y: 0, z: Math.cos(i * 0.7) * 60 },
    }));
    const g = new PointGrid(16);
    g.build(pts);
    for (const p of [{ x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: -300 }, pts[17].pos]) {
      const seen: number[] = [];
      g.rings(
        p,
        () => true,
        (i) => seen.push(i),
      );
      expect(seen.sort((x, y) => x - y)).toEqual(pts.map((_, i) => i));
    }
  });

  it('grid stays small and still visits every point with NaN or huge positions', () => {
    const pts = [
      { pos: { x: 1, y: 0, z: 2 } },
      { pos: { x: NaN, y: 0, z: 5 } },
      { pos: { x: 1e12, y: 0, z: -1e12 } },
      { pos: { x: Infinity, y: 0, z: -Infinity } },
      { pos: { x: -40, y: 0, z: 30 } },
    ];
    const g = new PointGrid(16);
    g.build(pts);
    expect(g.nx * g.nz).toBeLessThan(100);
    const seen: number[] = [];
    g.rings(
      { x: 0, y: 0, z: 0 },
      () => true,
      (i) => seen.push(i),
    );
    expect(seen.sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });
});
