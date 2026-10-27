import {
  HANGAR_SLOT_COST,
  hangarLocked,
  MAX_REFINERY,
  MODULE_SLOTS,
  MODULES,
  moduleLocked,
  REFINERY_COST,
  NEW_HANGAR_COST,
  OFFLINE_CAP_S,
  OFFLINE_EFFICIENCY,
  MARKS_DIVISOR,
  RP_DIVISOR,
  SHIP_STATS,
  WARP_CHARGE,
  warpPayment,
  HULLS,
} from './config';
import { cardSlots, checkCard, nextCardId } from './cards';
import { autoBuyUnlocked, autoRebuildUnlocked, engagementUnlocked } from './automation';
import { moveShip as moveOnBoard } from './hangar';
import { buyAdmiralty } from './admiralty';
import { buyResearch as buyNode, lvl, RESEARCH_BY_ID } from './research';
import { bind, createShip, emit, focused, jumpCost, maxEnergy, newGame } from './state';
import { executeJump } from './tick';
import { RETURN_GRACE_S, dematerialise, materialise, runBackground } from './background';
import type {
  AlertMode,
  GameState,
  SimEventKind,
  CarrierStance,
  Sim,
  HangarType,
  HullId,
  ModuleId,
  RuleCard,
  ShipClass,
  Stance,
} from './types';

/** A player order without its carrier; `Command` adds which carrier it is for. */
export type Order =
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
  | { type: 'fitModule'; shipId: number; slot: number; module: ModuleId | null };

/** Every command names the carrier (operation) it is for. */
export type Command = Order & { carrierId: number };

export const RETROFIT_COST = 800;

export function shipCost(s: Sim, cls: ShipClass): number {
  const n = s.ships.filter((x) => x.cls === cls).length;
  return Math.round(SHIP_STATS[cls].cost * Math.pow(1.07, n));
}

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
      const cost = HANGAR_SLOT_COST(h.slots);
      if (s.credits < cost) return 'Not enough credits';
      s.credits -= cost;
      h.slots++;
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
      const id = Math.max(...s.hangars.map((h) => h.id)) + 1;
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
      if (s.warp) return 'Already charging a jump';
      const from = s.systems[s.systemId];
      const to = s.systems[c.systemId];
      if (!to || !to.discovered || to.id === from.id) return 'Unknown system';
      const cost = jumpCost(s, from.distance, to.distance);
      const pay = warpPayment(cost, s.carrier.energy, s.carrier.h2);
      if (!pay) return `Needs ${cost} energy (or H2 to cover the gap)`;
      s.carrier.energy -= pay.energy;
      s.carrier.h2 -= pay.h2;
      s.warp = {
        targetSystem: to.id,
        charge:
          WARP_CHARGE * HULLS[s.carrier.hullClass].warpCharge * (1 - 0.15 * lvl(s, 'warpCharge')),
      };
      emit(s, 'WarpCharging', { system: to.name });
      return null;
    }
    case 'cancelWarp': {
      if (!s.warp) return null;
      const from = s.systems[s.systemId];
      const to = s.systems[s.warp.targetSystem];
      s.carrier.energy = Math.min(
        maxEnergy(s),
        s.carrier.energy + jumpCost(s, from.distance, to.distance) * 0.75,
      );
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
      const n = Math.max(0, Math.min(h.slots, Math.floor(c.count) || 0));
      if (n === 0) delete h.target[c.cls];
      else h.target[c.cls] = n;
      return null;
    }
  }
}

// ---------- prestige ----------

export function researchPayout(s: Pick<GameState, 'stats'>): number {
  return Math.floor(Math.sqrt(s.stats.oreValueDelivered / RP_DIVISOR)) * s.stats.furthestTier;
}

export function prestige(s: GameState, hull?: HullId): GameState {
  const rp = researchPayout(s);
  const next = newGame(s.seed + s.lifetime.prestiges + 1, {
    research: s.research + rp,
    researchLevels: { ...s.researchLevels },
    unlocked: [...s.unlocked],
    unlockedRules: [...s.unlockedRules],
    hulls: [...s.hulls],
    hullClass: hull ?? focused(s).carrier.hullClass,
    discovered: s.systems.filter((x) => x.discovered).map((x) => x.id),
    lifetime: {
      ...s.lifetime,
      prestiges: s.lifetime.prestiges + 1,
      researchEarned: s.lifetime.researchEarned + rp,
    },
    marks: s.marks,
    admiralty: { ...s.admiralty },
    doctrine: structuredClone(s.doctrine),
    alerts: structuredClone(s.alerts),
    cards: structuredClone(s.cards),
    automation: structuredClone(s.automation),
  });
  emit(focused(next), 'Prestiged', { research: rp });
  return next;
}

// ---------- admiralty ----------

/** Lifetime RP counting the run in progress, as an Admiralty reset would bank it. */
function lifetimeResearch(s: Pick<GameState, 'stats' | 'lifetime'>): number {
  return s.lifetime.researchEarned + researchPayout(s);
}

/** Marks the next Admiralty reset pays: floor(sqrt(lifetime RP / divisor)) less what was paid. */
export function marksPayout(s: Pick<GameState, 'stats' | 'lifetime'>): number {
  const total = Math.floor(Math.sqrt(lifetimeResearch(s) / MARKS_DIVISOR));
  return Math.max(0, total - s.lifetime.marksEarned);
}

/**
 * Second prestige layer (#68, Q6 in #49). Resets the research tree, RP and discovered systems
 * along with the run. Keeps automation nodes, unlocked hulls and rules, carriers (`ops` are
 * rebuilt as one fresh carrier until #78), Marks, doctrine and cards.
 */
export function admiralty(s: GameState): GameState {
  const marks = marksPayout(s);
  const kept = Object.fromEntries(
    Object.entries(s.researchLevels).filter(([id]) => RESEARCH_BY_ID[id]?.branch === 'Automation'),
  );
  const next = newGame(s.seed + s.lifetime.prestiges + s.lifetime.admiralties + 1, {
    research: 0,
    researchLevels: kept,
    unlocked: [...s.unlocked],
    unlockedRules: [...s.unlockedRules],
    discovered: [],
    lifetime: {
      prestiges: s.lifetime.prestiges,
      researchEarned: lifetimeResearch(s),
      admiralties: s.lifetime.admiralties + 1,
      marksEarned: s.lifetime.marksEarned + marks,
    },
    hulls: [...s.hulls],
    hullClass: focused(s).carrier.hullClass,
    alerts: structuredClone(s.alerts),
    marks: s.marks + marks,
    admiralty: { ...s.admiralty },
    doctrine: structuredClone(s.doctrine),
    cards: structuredClone(s.cards),
    automation: structuredClone(s.automation),
  });
  emit(focused(next), 'Admiralty', { marks });
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
export function settleOffline(g: GameState, elapsedS: number): OfflineReport | null {
  const t = Math.min(OFFLINE_CAP_S, Math.max(0, elapsedS));
  if (t < 30) return null;
  const report: OfflineReport = { seconds: t, credits: 0, rebuilt: 0 };
  for (const op of g.ops) {
    const r = settleOp(bind(g, op), t);
    report.credits += r.credits;
    report.rebuilt += r.rebuilt;
  }
  return report;
}

function settleOp(s: Sim, t: number): { credits: number; rebuilt: number } {
  // Tier C: the background model over the time away, at offline efficiency, quietly.
  dematerialise(s);
  const r = runBackground(s, t, { efficiency: OFFLINE_EFFICIENCY, events: false });
  s.carrier.shield = 1;
  // Never come back to an imminent wave.
  if (s.systems[s.systemId].tier > 1 && s.wave.timer < RETURN_GRACE_S) {
    s.wave.timer = RETURN_GRACE_S;
    s.wave.warning = false;
  }
  materialise(s);
  emit(s, 'WelcomeBack', { credits: Math.round(r.credits) });
  return { credits: r.credits, rebuilt: r.rebuilt };
}
