import { compileCards, firing } from './cards';
import type { GameState, RuleCard, Ship, Stance, StanceSwitch } from './types';

/** Fleet doctrine < ship type < hangar < active card. The most specific scope wins. */
function baseStance(s: GameState, ship: Ship): Stance {
  const hangar = s.hangars.find((h) => h.id === ship.hangarId);
  return { ...s.doctrine.fleet, ...s.doctrine.byClass[ship.cls], ...hangar?.stance };
}

function applySwitch(st: Stance, to: StanceSwitch) {
  const [axis, value] = to.split(':') as [keyof Stance, string];
  (st as unknown as Record<string, string>)[axis] = value;
}

/**
 * The stance a ship flies with. `card` is the stance card in force (the sim
 * resolves it, holds included); when omitted it is looked up without holds' side effects.
 */
export function effectiveStance(
  s: GameState,
  ship: Ship,
  card: RuleCard | null = stanceCard(s, ship),
): Stance {
  const st = baseStance(s, ship);
  if (card?.then.to) applySwitch(st, card.then.to);
  if (!s.unlocked.includes('fighter') && st.engagement !== 'passive') {
    // Engagement stances unlock in the frontier; until then everything is defensive.
    st.engagement = 'defensive';
  }
  return st;
}

/** The stance card in force for `ship`, read-only (for the UI). */
export function stanceCard(s: GameState, ship: Ship): RuleCard | null {
  const list = compileCards(s, {}).stance;
  const h = ship.hold;
  return (
    firing(s, list, ship) ??
    (h && h.until > s.time ? (list.find((c) => c.id === h.card) ?? null) : null)
  );
}

/** Which scope set the value shown for a stance axis (for the UI). */
export function stanceSource(
  s: GameState,
  ship: Ship,
  key: keyof Stance,
): 'fleet' | 'class' | 'hangar' | 'rule' {
  const card = stanceCard(s, ship);
  if (card?.then.to?.startsWith(`${key}:`)) return 'rule';
  const hangar = s.hangars.find((h) => h.id === ship.hangarId);
  if (hangar?.stance[key] !== undefined) return 'hangar';
  if (s.doctrine.byClass[ship.cls]?.[key] !== undefined) return 'class';
  return 'fleet';
}
