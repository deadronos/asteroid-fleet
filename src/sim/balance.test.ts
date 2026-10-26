import { it } from 'vitest';
import { apply, shipCost } from './actions';
import { MODULES } from './config';
import { newGame } from './state';
import { step } from './tick';
import type { ModuleId } from './types';

// Same opening, every drone (and barge/hauler) fitted with one module type.
it.skipIf(!process.env.BALANCE)('module balance', () => {
  const builds: (ModuleId | 'none')[] = ['none', 'laser', 'drill', 'tractor', 'compressor'];
  for (const mod of builds) {
    const s = newGame(42);
    // Greedy drones: with 'safe' the opening stalls once the carrier parks
    // away from covered rocks, which would swamp the module differences.
    s.doctrine.byClass.drone = { mining: 'greedy' };
    for (let t = 0; t < 3600 * 10; t++) {
      step(s);
      if (process.env.TRACE && t % 3000 === 0)
        console.log(
          `  ${mod} t=${t / 600}m earned=${Math.round(s.stats.creditsEarned)} mining=${s.ships.filter((x) => x.mode === 'mining').length} rocks=${s.asteroids.filter((a) => a.ore > 0).length} carrier=${Math.round(s.carrier.pos.x)},${Math.round(s.carrier.pos.z)}`,
        );
      if (t % 50 !== 0) continue;
      const drones = s.ships.filter((x) => x.cls === 'drone').length;
      if (drones >= 6 && !s.ships.some((x) => x.cls === 'barge'))
        apply(s, { type: 'buyShip', cls: 'barge' });
      else if (s.credits > shipCost(s, 'drone') + 200 && drones < 14) {
        if (apply(s, { type: 'buyShip', cls: 'drone' }))
          apply(s, { type: 'buySlot', hangarId: s.hangars[0].id });
      }
      apply(s, { type: 'upgradeRefinery' });
      if (mod === 'none') continue;
      for (const sh of s.ships)
        if (sh.mode === 'docked' && sh.modules.length === 0 && MODULES[mod].fits.includes(sh.cls))
          apply(s, { type: 'fitModule', shipId: sh.id, slot: 0, module: mod });
    }
    console.log(
      `${mod.padEnd(10)} ore=${Math.round(s.stats.oreValueDelivered)} cr=${Math.round(s.credits)} earned=${Math.round(s.stats.creditsEarned)} ref=${s.carrier.refinery} cOre=${Math.round(s.carrier.ore)} E=${Math.round(s.carrier.energy)} sys=${s.systemId} drones=${s.ships.filter((x) => x.cls === 'drone').length}`,
    );
  }
});
