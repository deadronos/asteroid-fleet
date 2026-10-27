import { shipCost } from './costs';
import { firstFit } from './hangar';
import { lvl } from './research';
import { shipBanned } from './modifiers';
import { createShip, emit } from './state';
import { SHIP_CLASSES, type Sim, type Ship, type ShipClass } from './types';

/** Seconds between automation passes; buying is not urgent and boards are scanned per pass. */
export const AUTOMATION_INTERVAL = 1;

export const autoBuyUnlocked = (s: Sim) => lvl(s, 'autoBuy') > 0;
export const autoRebuildUnlocked = (s: Sim) => lvl(s, 'autoRebuild') > 0;

/** Engagement stances unlock with fighters (the frontier) or with the tactics research. */
export const engagementUnlocked = (s: Sim) =>
  s.unlocked.includes('fighter') || lvl(s, 'tactics') > 0;

/** Remember a lost ship so paid auto-rebuild can replace it. */
export function queueRebuild(s: Sim, ship: Ship) {
  if (!s.automation.autoRebuild || !autoRebuildUnlocked(s)) return;
  const q = s.automation.rebuildQueue;
  q.push({ cls: ship.cls, hangarId: ship.hangarId });
  trimQueue(s);
}

/** The queue never holds more losses than the hangars have slots. */
export const rebuildQueueCap = (s: Sim) => s.hangars.reduce((n, h) => n + h.slots, 0);

function trimQueue(s: Sim) {
  const q = s.automation.rebuildQueue;
  const extra = q.length - rebuildQueueCap(s);
  if (extra > 0) q.splice(0, extra); // drop the oldest
}

/** Buy one ship into `hangarId` if it fits and the credit floor holds. */
function tryBuy(s: Sim, cls: ShipClass, hangarId: number): boolean {
  if (!s.unlocked.includes(cls)) return false;
  const cost = shipCost(s, cls);
  if (s.credits - cost < s.automation.creditFloor) return false;
  const h = s.hangars.find((x) => x.id === hangarId);
  if (!h || firstFit(s, h, cls) < 0) return false;
  if (!createShip(s, cls, hangarId)) return false;
  s.credits -= cost;
  return true;
}

export function automation(s: Sim, dt: number) {
  const a = s.automation;
  a.timer -= dt;
  if (a.timer > 0) return;
  a.timer = AUTOMATION_INTERVAL;

  // Also heals saves written before the queue was gated and capped.
  if (!a.autoRebuild) a.rebuildQueue.length = 0;
  else trimQueue(s);

  if (a.autoRebuild && autoRebuildUnlocked(s)) {
    // Oldest loss first; stop at the first one we cannot pay for, so order holds.
    while (a.rebuildQueue.length > 0) {
      const next = a.rebuildQueue[0];
      if (shipBanned(s, next.cls)) {
        a.rebuildQueue.shift(); // a modifier forbids it: it would block the queue forever
        continue;
      }
      const home = s.hangars.some((h) => h.id === next.hangarId) ? next.hangarId : s.hangars[0].id;
      const fits = s.hangars.some((h) => firstFit(s, h, next.cls) >= 0);
      if (!fits) {
        a.rebuildQueue.shift(); // no room anywhere: the player rearranged; drop it
        continue;
      }
      const cost = shipCost(s, next.cls);
      if (!s.unlocked.includes(next.cls) || s.credits - cost < a.creditFloor) break;
      if (!createShip(s, next.cls, home)) break;
      s.credits -= cost;
      a.rebuildQueue.shift();
      emit(s, 'ShipRebuilt', { cls: next.cls, cost });
    }
  }

  if (a.autoBuy && autoBuyUnlocked(s)) {
    // One ship per hangar per pass keeps spending spread across hangars.
    const owned = new Map<string, number>();
    for (const x of s.ships) {
      const k = `${x.hangarId}:${x.cls}`;
      owned.set(k, (owned.get(k) ?? 0) + 1);
    }
    for (const h of s.hangars) {
      for (const cls of SHIP_CLASSES) {
        const want = h.target[cls] ?? 0;
        if (want <= 0) continue;
        const key = `${h.id}:${cls}`;
        if ((owned.get(key) ?? 0) >= want) continue;
        if (tryBuy(s, cls, h.id)) {
          owned.set(key, (owned.get(key) ?? 0) + 1);
          break;
        }
      }
    }
  }
}
