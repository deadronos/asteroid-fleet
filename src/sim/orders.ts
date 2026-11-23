// Every player command, interpreted against a bound operation. Resets and
// offline settlement live in reset.ts and offline.ts; actions.ts re-exports all
// three so callers keep one import path (#250).

import {
  CARRIER_COST,
  HANGAR_SLOT_COST,
  HULLS,
  MAX_REFINERY,
  MODULE_SLOTS,
  MODULES,
  NEW_HANGAR_COST,
  REFINERY_COST,
  SCRAP_REFUND,
  SHIP_STATS,
  WARP_CHARGE,
  hangarLocked,
  moduleLocked,
  warpPayment,
} from './config';
import { autoBuyUnlocked, autoRebuildUnlocked, engagementUnlocked } from './automation';
import { cardSlots, checkCard, nextCardId } from './cards';
import { shipBanned } from './modifiers';
import { moveShip as moveOnBoard, removeFromHangars } from './hangar';
import { carrierSlots } from './milestones';
import { buyAdmiralty } from './admiralty';
import { buyResearch as buyNode, lvl, SCALE_ENERGY_WARPCHARGE } from './research';
import { addCarrier, bind, createShip, emit, jumpCost, maxEnergy, stateOf } from './state';
import { RETROFIT_COST, shipCost } from './costs';
import { warpBlocked } from './warpReason';
import { executeJump } from './tick';
import { addRoute, removeRoute } from './routes';
import { refit } from './shipyard';
import type {
  AlertMode,
  CarrierStance,
  GameState,
  HangarType,
  HullId,
  ModuleId,
  RouteResource,
  RuleCard,
  ShipClass,
  Sim,
  SimEventKind,
  Stance,
} from './types';

/** A player order without its carrier; `Command` adds which carrier it is for. */
export type Order =
  | { type: 'buyShip'; cls: ShipClass; hangarId?: number; start?: number }
  | { type: 'scrapShip'; shipId: number }
  | { type: 'moveShip'; shipId: number; hangarId: number; start: number }
  | { type: 'buySlot'; hangarId: number }
  | { type: 'buyHangar'; hangarType: HangarType }
  /** Buy another carrier (#78); credits are shared, so any carrier can place it. */
  | { type: 'buyCarrier' }
  /** Start a supply route (#80) from the carrier the command names to `to`. */
  | { type: 'addRoute'; to: number; resource: RouteResource; rate: number }
  | { type: 'removeRoute'; routeId: number }
  | { type: 'retrofitHangar'; hangarId: number; hangarType: HangarType }
  | { type: 'setLaunchOrder'; hangarId: number; order: ShipClass[] }
  | {
      type: 'setStance';
      scope: 'fleet' | ShipClass | number;
      patch: Partial<Stance> | null;
      key?: keyof Stance;
    }
  | { type: 'setAlert'; scope: 'fleet' | number; kind: SimEventKind; mode: AlertMode | null }
  | { type: 'addCard'; card: Omit<RuleCard, 'id'> }
  | { type: 'updateCard'; id: number; card: Omit<RuleCard, 'id'> }
  | { type: 'moveCard'; id: number; to: number }
  | { type: 'deleteCard'; id: number }
  | { type: 'warp'; systemId: number }
  | { type: 'cancelWarp' }
  | { type: 'jumpNow' }
  | { type: 'setPower'; mode: Sim['powerMode'] }
  | { type: 'setCarrierStance'; stance: CarrierStance }
  | { type: 'buyResearch'; id: string }
  | { type: 'buyAdmiralty'; id: string }
  | {
      type: 'setAutomation';
      patch: Partial<Pick<Sim['automation'], 'autoBuy' | 'autoRebuild' | 'creditFloor'>>;
    }
  | { type: 'setHangarTarget'; hangarId: number; cls: ShipClass; count: number }
  | { type: 'upgradeRefinery' }
  | { type: 'refit'; hull: HullId }
  | { type: 'fitModule'; shipId: number; slot: number; module: ModuleId | null };

/** Every command names the carrier (operation) it is for. */
export type Command = Order & { carrierId: number };

export function apply(g: GameState, c: Command): string | null {
  const op = g.ops.find((o) => o.id === c.carrierId);
  if (!op) return 'No such carrier';
  return order(bind(g, op), c);
}

/** `apply` for an already bound operation: headless runs and tests. */
export function order(s: Sim, c: Order): string | null {
  switch (c.type) {
    case 'buyShip': {
      if (!s.unlocked.includes(c.cls)) return 'Not unlocked yet';
      const banned = shipBanned(s, c.cls);
      if (banned) return banned;
      const cost = shipCost(s, c.cls);
      if (s.credits < cost) return 'Not enough credits';
      const ship = createShip(s, c.cls, c.hangarId, c.start);
      if (!ship) return 'No free hangar slots';
      s.credits -= cost;
      return null;
    }
    case 'addRoute':
      return addRoute(stateOf(s), s.id, c.to, c.resource, c.rate);
    case 'removeRoute':
      return removeRoute(stateOf(s), c.routeId);
    case 'scrapShip': {
      const ship = s.ships.find((x) => x.id === c.shipId);
      if (!ship) return 'No such ship';
      if (ship.mode !== 'docked') return 'Ship must be docked';
      s.credits += Math.round(SHIP_STATS[ship.cls].cost * SCRAP_REFUND);
      s.ships = s.ships.filter((x) => x.id !== ship.id);
      removeFromHangars(s, ship.id);
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
      const cost = HANGAR_SLOT_COST(h.slots);
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      h.slots++;
      return null;
    }
    case 'buyCarrier': {
      const g = stateOf(s);
      const n = g.ops.length;
      if (n >= carrierSlots(g)) return 'No free carrier slot';
      const cost = CARRIER_COST(n);
      if (g.credits < cost) return 'Not enough credits';
      g.credits -= cost;
      addCarrier(g);
      return null;
    }
    case 'buyHangar': {
      const cost = NEW_HANGAR_COST(s.hangars.length);
      {
        const locked = hangarLocked(c.hangarType, s.stats.furthestTier);
        if (locked) return locked;
      }
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      // Ids are unique across every carrier: cards and stances name hangars globally (#173).
      const id = Math.max(...stateOf(s).ops.flatMap((o) => o.hangars.map((h) => h.id))) + 1;
      s.hangars.push({
        id,
        type: c.hangarType,
        slots: HULLS[s.carrier.hullClass].newSlots + lvl(s, 'slots'),
        items: [],
        stance: {},
        launchOrder: ['fighter', 'scout', 'drone', 'repair', 'hauler', 'barge', 'harvester'],
        launchTimer: 0,
        target: {},
      });
      emit(s, 'HangarInstalled', { hangarType: c.hangarType });
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
    case 'setAlert': {
      if (c.kind === 'Legacy') return 'No such event';
      if (c.scope === 'fleet') {
        if (c.mode === null) delete s.alerts.fleet[c.kind];
        else s.alerts.fleet[c.kind] = c.mode;
        return null;
      }
      const over = (s.alerts.byCarrier[c.scope] ??= {});
      if (c.mode === null) delete over[c.kind];
      else over[c.kind] = c.mode;
      if (Object.keys(over).length === 0) delete s.alerts.byCarrier[c.scope];
      return null;
    }
    case 'addCard': {
      if (s.cards.length >= cardSlots(s)) return 'All card slots are in use';
      const card = structuredClone(c.card);
      const err = checkCard(s, card);
      if (err) return err;
      s.cards.push({ ...card, id: nextCardId(s) });
      return null;
    }
    case 'updateCard': {
      const i = s.cards.findIndex((x) => x.id === c.id);
      if (i < 0) return 'No such card';
      const card = structuredClone(c.card);
      const err = checkCard(s, card);
      if (err) return err;
      s.cards[i] = { ...card, id: c.id };
      return null;
    }
    case 'moveCard': {
      const i = s.cards.findIndex((x) => x.id === c.id);
      if (i < 0) return 'No such card';
      const to = Math.max(0, Math.min(s.cards.length - 1, Math.floor(c.to) || 0));
      const [card] = s.cards.splice(i, 1);
      s.cards.splice(to, 0, card);
      return null;
    }
    case 'deleteCard': {
      const i = s.cards.findIndex((x) => x.id === c.id);
      if (i < 0) return 'No such card';
      s.cards.splice(i, 1);
      return null;
    }
    case 'warp': {
      const blocked = warpBlocked(s, c.systemId);
      if (blocked) return blocked;
      const from = s.systems[s.systemId];
      const to = s.systems[c.systemId];
      const cost = jumpCost(s, from.distance, to.distance);
      const pay = warpPayment(cost, s.carrier.energy, s.carrier.h2)!;
      s.carrier.energy -= pay.energy;
      s.carrier.h2 -= pay.h2;
      const total =
        WARP_CHARGE *
        HULLS[s.carrier.hullClass].warpCharge *
        (1 - SCALE_ENERGY_WARPCHARGE * lvl(s, 'warpCharge'));
      s.warp = { targetSystem: to.id, charge: total, total, paid: pay };
      emit(s, 'WarpCharging', { system: to.name });
      return null;
    }
    case 'cancelWarp': {
      if (!s.warp) return null;
      s.carrier.energy = Math.min(maxEnergy(s), s.carrier.energy + s.warp.paid.energy * 0.75);
      s.carrier.h2 += s.warp.paid.h2 * 0.75;
      s.warp = null;
      emit(s, 'WarpCancelled', {});
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
    case 'refit':
      return refit(s, c.hull);
    case 'upgradeRefinery': {
      if (s.carrier.refinery >= MAX_REFINERY) return 'Refinery fully upgraded';
      const cost = REFINERY_COST(s.carrier.refinery);
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      s.carrier.refinery++;
      return null;
    }
    case 'buyAdmiralty':
      return buyAdmiralty(s, c.id) ? null : 'Not enough Marks';
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
        if (!p.autoRebuild) {
          // The toggle is run-wide, so every carrier drops its queue (#174).
          for (const op of stateOf(s).ops) op.rebuildQueue.length = 0;
        }
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
      const n = Math.max(0, Math.min(h.slots, Math.floor(c.count) || 0));
      if (n === 0) delete h.target[c.cls];
      else h.target[c.cls] = n;
      return null;
    }
  }
}
