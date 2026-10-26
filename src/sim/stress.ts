// Large deterministic fleets for the tick benchmark and the scaling tests.

import { PRESETS, SHIP_STATS } from './config';
import { onSphere, seeded } from './math';
import {
  clusterCenters,
  createShip,
  enterSystem,
  focused,
  newGame,
  spawnAsteroid,
  unlockRule,
} from './state';
import { SHIP_CLASSES, type Sim, type HangarType, type RuleId, type ShipClass } from './types';

const MIX: [ShipClass, number][] = [
  ['drone', 0.5],
  ['barge', 0.08],
  ['hauler', 0.08],
  ['fighter', 0.2],
  ['scout', 0.04],
  ['repair', 0.05],
  ['harvester', 0.05],
];
const HANGAR_SLOTS = 120;
const HANGAR_KINDS: HangarType[] = ['launch', 'cargo', 'drydock'];

/** A tier-3 game with `ships` ships (90% already out in the field), `asteroids` asteroids and `pirates` raiders. */
export function stressGame(ships = 1000, asteroids = 600, pirates = 40, seed = 99): Sim {
  const s = focused(newGame(seed));
  const r = seeded(seed ^ 0x5eed);
  for (const c of SHIP_CLASSES) if (!s.unlocked.includes(c)) s.unlocked.push(c);
  for (const id of Object.keys(PRESETS) as RuleId[]) unlockRule(s, id);
  for (const card of s.cards) card.enabled = true;
  s.researchLevels = { fighterAce: 1, droneSwarm: 1, bargeBay: 1, repairNano: 1, fusion: 1 };
  s.ships = [];
  s.hangars = [];
  enterSystem(
    s,
    s.systems.findIndex((x) => x.tier === 3 && x.gasGiant),
  );
  s.wave.timer = 1e9;

  const sys = s.systems[s.systemId];
  const centers = clusterCenters(sys);
  while (s.asteroids.length < asteroids)
    s.asteroids.push(spawnAsteroid(s, r, centers[s.asteroids.length % centers.length], sys));
  s.asteroids.length = asteroids;

  let start = HANGAR_SLOTS;
  for (const [cls, share] of MIX) {
    const n = Math.round(ships * share);
    for (let i = 0; i < n && s.ships.length < ships; i++) {
      const size = SHIP_STATS[cls].slots;
      if (start + size > HANGAR_SLOTS) {
        s.hangars.push({
          id: s.hangars.length + 1,
          type: HANGAR_KINDS[s.hangars.length % HANGAR_KINDS.length],
          slots: HANGAR_SLOTS,
          items: [],
          stance: {},
          launchOrder: [...SHIP_CLASSES],
          launchTimer: 0,
          target: {},
        });
        start = 0;
      }
      const ship = createShip(s, cls, s.hangars[s.hangars.length - 1].id, start)!;
      start += size;
      if (r() < 0.9) {
        ship.mode = 'idle';
        ship.pos = onSphere(r, 80, 0.3);
      }
    }
  }

  for (let i = 0; i < pirates; i++) {
    const pos = onSphere(r, 100, 0.2);
    s.pirates.push({
      id: s.nextId++,
      pos,
      hull: 400,
      maxHull: 400,
      damage: 6,
      speed: 4,
      targetId: -1,
      fireCooldown: 0,
    });
  }
  s.wave.active = pirates > 0;
  return s;
}
