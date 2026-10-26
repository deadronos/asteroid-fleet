import {
  HANGAR_SLOT_COST,
  HANGAR_TYPES,
  hangarLocked,
  MAX_REFINERY,
  MODULE_SLOTS,
  MODULES,
  moduleLocked,
  REFINERY_COST,
  MAX_HANGAR_SLOTS,
  MAX_HANGARS,
  NEW_HANGAR_COST,
  OFFLINE_CAP_S,
  OFFLINE_EFFICIENCY,
  RP_DIVISOR,
  SHIP_STATS,
  WARP_CHARGE,
  warpCost,
  warpPayment,
} from './config';
import { autoBuyUnlocked, autoRebuildUnlocked, engagementUnlocked } from './automation';
import { moveShip as moveOnBoard } from './hangar';
import { buyResearch as buyNode, lvl, reserveDefs } from './research';
import { createShip, log, maxEnergy, newGame, solarRate, upkeepRate } from './state';
import { executeJump } from './tick';
import type {
  CarrierStance,
  GameState,
  HangarType,
  ModuleId,
  RuleId,
  ShipClass,
  Stance,
} from './types';

export type Command =
  | { type: 'buyShip'; cls: ShipClass; hangarId?: number; start?: number }
  | { type: 'scrapShip'; shipId: number }
  | { type: 'moveShip'; shipId: number; hangarId: number; start: number }
  | { type: 'buySlot'; hangarId: number }
  | { type: 'buyHangar'; hangarType: HangarType }
  | { type: 'retrofitHangar'; hangarId: number; hangarType: HangarType }
  | { type: 'setLaunchOrder'; hangarId: number; order: ShipClass[] }
  | {
      type: 'setStance';
      scope: 'fleet' | ShipClass | number;
      patch: Partial<Stance> | null;
      key?: keyof Stance;
    }
  | { type: 'setRule'; id: RuleId; enabled?: boolean; param?: number }
  | { type: 'warp'; systemId: number }
  | { type: 'cancelWarp' }
  | { type: 'jumpNow' }
  | { type: 'setPower'; mode: GameState['powerMode'] }
  | { type: 'setCarrierStance'; stance: CarrierStance }
  | { type: 'buyResearch'; id: string }
  | {
      type: 'setAutomation';
      patch: Partial<Pick<GameState['automation'], 'autoBuy' | 'autoRebuild' | 'creditFloor'>>;
    }
  | { type: 'setHangarTarget'; hangarId: number; cls: ShipClass; count: number }
  | { type: 'upgradeRefinery' }
  | { type: 'fitModule'; shipId: number; slot: number; module: ModuleId | null };

export const RETROFIT_COST = 800;

export function shipCost(s: GameState, cls: ShipClass): number {
  const n = s.ships.filter((x) => x.cls === cls).length;
  return Math.round(SHIP_STATS[cls].cost * Math.pow(1.07, n));
}

export function apply(s: GameState, c: Command): string | null {
  switch (c.type) {
    case 'buyShip': {
      if (!s.unlocked.includes(c.cls)) return 'Not unlocked yet';
      const cost = shipCost(s, c.cls);
      if (s.credits < cost) return 'Not enough credits';
      const ship = createShip(s, c.cls, c.hangarId, c.start);
      if (!ship) return 'No free hangar slots';
      s.credits -= cost;
      return null;
    }
    case 'scrapShip': {
      const ship = s.ships.find((x) => x.id === c.shipId);
      if (!ship) return 'No such ship';
      if (ship.mode !== 'docked') return 'Ship must be docked';
      s.credits += Math.round(SHIP_STATS[ship.cls].cost * 0.5);
      s.ships = s.ships.filter((x) => x.id !== ship.id);
      for (const h of s.hangars) h.items = h.items.filter((it) => it.shipId !== ship.id);
      return null;
    }
    case 'fitModule': {
      const ship = s.ships.find((x) => x.id === c.shipId);
      if (!ship) return 'No such ship';
      if (ship.mode !== 'docked') return 'Ship must be docked';
      if (c.slot < 0 || c.slot >= MODULE_SLOTS[ship.cls]) return 'No such module slot';
      if (c.module === null) {
        // Unfitting refunds nothing; the slot just frees up.
        if (c.slot < ship.modules.length) ship.modules.splice(c.slot, 1);
        return null;
      }
      if (ship.modules[c.slot] === c.module) return null;
      const locked = moduleLocked(c.module, ship.cls, s.stats.furthestTier);
      if (locked) return locked;
      const cost = MODULES[c.module].cost;
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      if (c.slot < ship.modules.length) ship.modules[c.slot] = c.module;
      else ship.modules.push(c.module);
      return null;
    }
    case 'moveShip':
      return moveOnBoard(s, c.shipId, c.hangarId, c.start) ? null : 'Does not fit there';
    case 'buySlot': {
      const h = s.hangars.find((x) => x.id === c.hangarId);
      if (!h) return 'No such hangar';
      if (h.slots >= MAX_HANGAR_SLOTS) return 'Hangar is at maximum size';
      const cost = HANGAR_SLOT_COST(h.slots);
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      h.slots++;
      return null;
    }
    case 'buyHangar': {
      const cost = NEW_HANGAR_COST(s.hangars.length);
      if (s.hangars.length >= MAX_HANGARS) return 'The carrier has no room for more hangars';
      {
        const locked = hangarLocked(c.hangarType, s.stats.furthestTier);
        if (locked) return locked;
      }
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      const id = Math.max(...s.hangars.map((h) => h.id)) + 1;
      s.hangars.push({
        id,
        type: c.hangarType,
        slots: 4 + lvl(s, 'slots'),
        items: [],
        stance: {},
        launchOrder: ['fighter', 'scout', 'drone', 'repair', 'hauler', 'barge', 'harvester'],
        launchTimer: 0,
        target: {},
      });
      log(s, `New ${HANGAR_TYPES[c.hangarType].name.toLowerCase()} installed.`, 'good');
      return null;
    }
    case 'retrofitHangar': {
      const h = s.hangars.find((x) => x.id === c.hangarId);
      if (!h || h.type === c.hangarType) return null;
      {
        const locked = hangarLocked(c.hangarType, s.stats.furthestTier);
        if (locked) return locked;
      }
      if (s.credits < RETROFIT_COST) return 'Not enough credits';
      s.credits -= RETROFIT_COST;
      h.type = c.hangarType;
      return null;
    }
    case 'setLaunchOrder': {
      const h = s.hangars.find((x) => x.id === c.hangarId);
      if (h) h.launchOrder = c.order;
      return null;
    }
    case 'setStance': {
      const target =
        c.scope === 'fleet'
          ? s.doctrine.fleet
          : typeof c.scope === 'number'
            ? s.hangars.find((h) => h.id === c.scope)?.stance
            : (s.doctrine.byClass[c.scope] ??= {});
      if (!target) return 'No such scope';
      if (c.patch?.engagement !== undefined && !engagementUnlocked(s))
        return 'Engagement stances need fighters or tactical doctrine';
      if (c.patch === null) {
        // clear one key (back to inherited); never clear the fleet default
        if (c.scope !== 'fleet' && c.key) delete target[c.key];
        return null;
      }
      Object.assign(target, c.patch);
      return null;
    }
    case 'setRule': {
      const r = s.rules.find((x) => x.id === c.id);
      if (!r || !s.unlockedRules.includes(c.id)) return 'Rule locked';
      if (c.enabled !== undefined) r.enabled = c.enabled;
      if (c.param !== undefined) r.param = c.param;
      return null;
    }
    case 'warp': {
      if (s.warp) return 'Already charging a jump';
      const from = s.systems[s.systemId];
      const to = s.systems[c.systemId];
      if (!to || !to.discovered || to.id === from.id) return 'Unknown system';
      const cost = warpCost(from.distance, to.distance);
      const pay = warpPayment(cost, s.carrier.energy, s.carrier.h2);
      if (!pay) return `Needs ${cost} energy (or H2 to cover the gap)`;
      s.carrier.energy -= pay.energy;
      s.carrier.h2 -= pay.h2;
      s.warp = { targetSystem: to.id, charge: WARP_CHARGE * (1 - 0.15 * lvl(s, 'warpCharge')) };
      log(s, `Warp drive charging for ${to.name}. Recalling the fleet.`, 'warn');
      return null;
    }
    case 'cancelWarp': {
      if (!s.warp) return null;
      const from = s.systems[s.systemId];
      const to = s.systems[s.warp.targetSystem];
      s.carrier.energy = Math.min(
        maxEnergy(s),
        s.carrier.energy + warpCost(from.distance, to.distance) * 0.75,
      );
      s.warp = null;
      log(s, 'Jump cancelled.', 'info');
      return null;
    }
    case 'jumpNow':
      if (s.warp) executeJump(s);
      return null;
    case 'setPower':
      s.powerMode = c.mode;
      return null;
    case 'setCarrierStance':
      s.carrier.stance = c.stance;
      return null;
    case 'upgradeRefinery': {
      if (s.carrier.refinery >= MAX_REFINERY) return 'Refinery fully upgraded';
      const cost = REFINERY_COST(s.carrier.refinery);
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      s.carrier.refinery++;
      return null;
    }
    case 'buyResearch':
      return buyNode(s, c.id) ? null : 'Cannot research that yet';
    case 'setAutomation': {
      const a = s.automation;
      const p = c.patch;
      if (p.autoBuy !== undefined) {
        if (p.autoBuy && !autoBuyUnlocked(s)) return 'Research fleet requisition first';
        a.autoBuy = p.autoBuy;
      }
      if (p.autoRebuild !== undefined) {
        if (p.autoRebuild && !autoRebuildUnlocked(s)) return 'Research replacement orders first';
        a.autoRebuild = p.autoRebuild;
        if (!p.autoRebuild) a.rebuildQueue.length = 0;
      }
      if (p.creditFloor !== undefined) {
        if (!Number.isFinite(p.creditFloor)) return 'Invalid credit floor';
        a.creditFloor = Math.max(0, Math.round(p.creditFloor));
      }
      return null;
    }
    case 'setHangarTarget': {
      const h = s.hangars.find((x) => x.id === c.hangarId);
      if (!h) return 'No such hangar';
      if (!SHIP_STATS[c.cls]) return 'No such class';
      const n = Math.max(0, Math.min(MAX_HANGAR_SLOTS, Math.floor(c.count) || 0));
      if (n === 0) delete h.target[c.cls];
      else h.target[c.cls] = n;
      return null;
    }
  }
}

// ---------- prestige ----------

export function researchPayout(s: GameState): number {
  return Math.floor(Math.sqrt(s.stats.oreValueDelivered / RP_DIVISOR)) * s.stats.furthestTier;
}

export function prestige(s: GameState): GameState {
  const rp = researchPayout(s);
  const next = newGame(s.seed + s.lifetime.prestiges + 1, {
    research: s.research + rp,
    researchLevels: { ...s.researchLevels },
    unlocked: [...s.unlocked],
    unlockedRules: [...s.unlockedRules],
    discovered: s.systems.filter((x) => x.discovered).map((x) => x.id),
    lifetime: {
      prestiges: s.lifetime.prestiges + 1,
      researchEarned: s.lifetime.researchEarned + rp,
    },
    doctrine: structuredClone(s.doctrine),
    rules: structuredClone(s.rules),
    automation: structuredClone(s.automation),
  });
  log(next, `Operation reset. +${rp} research points.`, 'good');
  return next;
}

// ---------- offline ----------

export interface OfflineReport {
  seconds: number;
  credits: number;
  rebuilt: number;
}

/**
 * Offline is mostly safe: no pirate waves. The fleet earns only what safe mining yielded
 * recently (salvage excluded), at reduced efficiency. Offline credits do not count toward
 * prestige research. Energy recharges from solar minus fleet upkeep over the elapsed time (never
 * below zero; mining income is already net of upkeep). Reserves keep rebuilding.
 */
export function settleOffline(s: GameState, elapsedS: number): OfflineReport | null {
  const t = Math.min(OFFLINE_CAP_S, Math.max(0, elapsedS));
  if (t < 30) return null;
  // `|| 0` covers saves written before miningIncomeAvg existed.
  const credits = Math.max(0, s.miningIncomeAvg || 0) * t * OFFLINE_EFFICIENCY;
  s.credits += credits;
  s.stats.creditsEarned += credits;
  const net = solarRate(s) - upkeepRate(s);
  s.carrier.energy = Math.min(maxEnergy(s), Math.max(0, s.carrier.energy + net * t));
  s.carrier.shield = 1;
  s.pirates = [];
  s.wave.active = false;
  s.wave.warning = false;
  if (s.systems[s.systemId].tier > 1) s.wave.timer = 60;
  let rebuilt = 0;
  const defs = reserveDefs(s);
  for (const [cls, min, cooldown] of defs) {
    const have = s.ships.filter((x) => x.cls === cls).length;
    const n = Math.min(Math.max(0, min - have), Math.floor(t / cooldown));
    for (let i = 0; i < n; i++) if (createShip(s, cls)) rebuilt++;
  }
  log(
    s,
    `Welcome back. The fleet earned ${Math.round(credits)} credits while you were away.`,
    'good',
  );
  return { seconds: t, credits, rebuilt };
}
