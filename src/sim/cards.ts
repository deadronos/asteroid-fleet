// Condition/action rule cards (#82). Cards are compiled once per tick into
// per-action lists already in priority order (hangar > ship type > fleet, then
// card order), so a query walks only the few cards for its action. Conditions are
// read when the sim asks, never cached across a tick.

import {
  ACTION_DEFS,
  CARD_SLOTS,
  CONDITION_DEFS,
  MAX_CONDITIONS,
  PRESETS,
  STANCE_SWITCHES,
} from './config';
import { cargoCap } from './ctx';
import { dist, dist2 } from './math';
import { maxEnergy, maxHull } from './state';
import {
  type ActionKind,
  type CardScope,
  type Condition,
  type GameState,
  type RuleCard,
  type RuleId,
  type Ship,
} from './types';

/** Active cards per action, most specific scope first, then card order. */
export type CompiledCards = Record<ActionKind, RuleCard[]>;

export function cardActive(s: GameState, card: RuleCard): boolean {
  return card.enabled && s.unlockedRules.includes(ACTION_DEFS[card.then.kind].unlock);
}

const LEVELS: CardScope['kind'][] = ['hangar', 'class', 'fleet'];

/** Refill `out` from `s.cards`, reusing its arrays so a tick allocates nothing here. */
export function compileCards(s: GameState, out: Partial<CompiledCards>): CompiledCards {
  for (const a in ACTION_DEFS) (out[a as ActionKind] ??= []).length = 0;
  for (const level of LEVELS)
    for (const card of s.cards)
      if (card.scope.kind === level && cardActive(s, card)) out[card.then.kind]!.push(card);
  return out as CompiledCards;
}

function inScope(sc: CardScope, ship: Ship | null): boolean {
  if (!ship) return sc.kind === 'fleet';
  return (
    sc.kind === 'fleet' || (sc.kind === 'class' ? ship.cls === sc.cls : ship.hangarId === sc.id)
  );
}

function near<T extends { pos: { x: number; y: number; z: number } }>(
  list: readonly T[],
  p: Ship['pos'],
  r: number,
  ok: (x: T) => boolean = () => true,
): boolean {
  for (const x of list) if (dist2(x.pos, p) < r * r && ok(x)) return true;
  return false;
}

export function conditionHolds(s: GameState, c: Condition, ship: Ship | null): boolean {
  const v = c.value ?? 0;
  switch (c.kind) {
    case 'always':
      return true;
    case 'wave':
      return s.wave.warning || s.wave.active;
    case 'storm':
      return s.storm.active > 0;
    case 'energyBelow':
      return s.carrier.energy < maxEnergy(s) * v;
    case 'shieldBelow':
      return s.carrier.shield < v;
    case 'pirateWithin':
      // Without a distance: anywhere in the system. Without a unit: around the carrier.
      return v > 0 ? near(s.pirates, (ship ?? s.carrier).pos, v) : s.pirates.length > 0;
  }
  if (!ship) return false;
  switch (c.kind) {
    case 'cargoAbove':
      return (ship.cls === 'harvester' ? ship.h2 : ship.cargo) / cargoCap(s, ship.cls, ship) >= v;
    case 'hullBelow':
      return ship.hull < maxHull(s, ship.cls) * v;
    case 'carrierFarther':
      return dist(ship.pos, s.carrier.pos) > v;
    case 'asteroidFarther':
      return !near(s.asteroids, ship.pos, v, (a) => a.ore > 0);
  }
}

/** The first card in `list` that covers `ship` (the carrier when null) and whose conditions all hold. */
export function firing(
  s: GameState,
  list: readonly RuleCard[],
  ship: Ship | null,
): RuleCard | null {
  for (const card of list)
    if (inScope(card.scope, ship) && card.when.every((c) => conditionHolds(s, c, ship)))
      return card;
  return null;
}

// ---------- editing ----------

export function nextCardId(s: GameState): number {
  let id = 0;
  for (const c of s.cards) if (c.id > id) id = c.id;
  return id + 1;
}

export function cardSlots(_s: GameState): number {
  return CARD_SLOTS;
}

export function presetCard(id: RuleId, cardId: number, enabled: boolean, param?: number): RuleCard {
  const def = PRESETS[id];
  const card: RuleCard = { id: cardId, enabled, preset: id, ...structuredClone(def.card) };
  if (param !== undefined && def.param !== undefined) card.when[def.param].value = param;
  return card;
}

/** Add a preset's card if there is a free slot. */
export function addPreset(s: GameState, id: RuleId, enabled: boolean): RuleCard | null {
  if (s.cards.length >= cardSlots(s)) return null;
  const card = presetCard(id, nextCardId(s), enabled);
  s.cards.push(card);
  return card;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Check and normalise a card from the UI or a save. Returns an error message,
 * or null with `card` cleaned in place (values clamped, stray fields dropped).
 */
export function checkCard(s: GameState, card: Omit<RuleCard, 'id'>): string | null {
  const then = card.then;
  const action = ACTION_DEFS[then?.kind];
  if (!action) return 'Pick an action';
  if (!s.unlockedRules.includes(action.unlock)) return 'That action is locked';
  const sc = card.scope;
  // Carrier actions (no classes) are fleet-wide; ship actions fit a hangar or their own types.
  const fits =
    sc?.kind === 'fleet' ||
    (!!action.classes &&
      (sc?.kind === 'hangar'
        ? s.hangars.some((h) => h.id === sc.id)
        : sc?.kind === 'class' && action.classes.includes(sc.cls)));
  if (!fits) return 'That action does nothing for these units';
  const when = card.when;
  if (!Array.isArray(when) || !when.length || when.length > MAX_CONDITIONS)
    return `Use 1 to ${MAX_CONDITIONS} conditions`;
  for (const c of when) {
    const def = CONDITION_DEFS[c?.kind];
    if (!def || (def.ship && !action.classes)) return 'The carrier cannot read that condition';
    const vd = def.value;
    if (vd) c.value = clamp(Number.isFinite(c.value) ? c.value! : vd.def, vd.min, vd.max);
    else delete c.value;
  }
  if (then.kind === 'stance') {
    if (!STANCE_SWITCHES.includes(then.to!)) return 'Pick a stance';
    const sec = Math.round(then.seconds ?? 0);
    if (sec > 0) then.seconds = Math.min(600, sec);
    else delete then.seconds;
  } else {
    delete then.to;
    delete then.seconds;
  }
  // Saves and the UI may leave it out; a card is on unless switched off.
  if (typeof card.enabled !== 'boolean') card.enabled = true;
  if (card.preset && !Object.hasOwn(PRESETS, card.preset)) delete card.preset;
  return null;
}
