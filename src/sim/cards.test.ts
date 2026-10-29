import { describe, expect, it } from 'vitest';
import { apply, order, prestige } from './actions';
import { conditionHolds, firing } from './cards';
import { CARD_SLOTS, PRESETS } from './config';
import { buildCtx, stanceOf } from './ctx';
import { effectiveStance, stanceSource } from './doctrine';
import { bind, createShip, enterSystem, newGame, unlockRule, stateOf } from './state';
import { stepSim } from './tick';
import type { Sim, RuleCard, RuleId, Ship } from './types';
import { game as freshGame } from './testing';

type NewCard = Omit<RuleCard, 'id'>;

/** A frontier game with every preset unlocked and no cards dealt. */
function game(): Sim {
  const s = freshGame(21);
  for (const id of Object.keys(PRESETS) as RuleId[]) unlockRule(s, id);
  if (!s.unlocked.includes('fighter')) s.unlocked.push('fighter');
  s.cards = [];
  s.credits = 1e6;
  return s;
}

function launched(s: Sim, cls: Ship['cls'], hangarId = 1): Ship {
  if (!s.unlocked.includes(cls)) s.unlocked.push(cls);
  const sh = createShip(s, cls, hangarId)!;
  sh.mode = 'idle';
  sh.pos = { x: 10, y: 0, z: 0 };
  return sh;
}

const stanceCard = (scope: RuleCard['scope'], to: string, seconds?: number): NewCard => ({
  enabled: true,
  scope,
  when: [{ kind: 'always' }],
  then: { kind: 'stance', to: to as never, seconds },
});

describe('rule cards (#82)', () => {
  it('a new game deals the starter presets, enabled', () => {
    const s = freshGame(1);
    expect(s.cards.map((c) => [c.preset, c.enabled])).toEqual([
      ['droneUnloadAtBarge', true],
      ['bargeCallHauler', true],
      ['haulerPark', true],
    ]);
    expect(s.cards.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('frontier presets are dealt disabled, once', () => {
    const s = freshGame(1);
    enterSystem(
      s,
      s.systems.findIndex((x) => x.tier === 2),
    );
    const escort = s.cards.find((c) => c.preset === 'fightersEscortOnWave')!;
    expect(escort.enabled).toBe(false);
    // A deleted preset stays deleted when the zone is entered again.
    expect(order(s, { type: 'deleteCard', id: escort.id })).toBeNull();
    enterSystem(
      s,
      s.systems.findIndex((x) => x.tier === 2),
    );
    expect(s.cards.some((c) => c.preset === 'fightersEscortOnWave')).toBe(false);
    expect(s.unlockedRules).toContain('fightersEscortOnWave');
  });

  it('prestige carries cards and unlocks without dealing presets again', () => {
    const s = freshGame(1);
    order(s, { type: 'deleteCard', id: s.cards[0].id });
    order(s, { type: 'moveCard', id: s.cards[1].id, to: 0 });
    const next = prestige(stateOf(s));
    expect(next.cards).toEqual(s.cards);
    expect(next.unlockedRules).toEqual(s.unlockedRules);
  });

  it('the most specific scope wins, then card order', () => {
    const s = game();
    const f = launched(s, 'fighter', 1);
    const other = launched(s, 'fighter', 2);
    order(s, { type: 'addCard', card: stanceCard({ kind: 'fleet' }, 'engagement:passive') });
    order(s, {
      type: 'addCard',
      card: stanceCard({ kind: 'class', cls: 'fighter' }, 'engagement:aggressive'),
    });
    order(s, { type: 'addCard', card: stanceCard({ kind: 'hangar', id: 1 }, 'engagement:escort') });
    order(s, {
      type: 'addCard',
      card: stanceCard({ kind: 'hangar', id: 1 }, 'engagement:defensive'),
    });
    const ctx = buildCtx(s);
    expect(stanceOf(s, ctx, f).engagement).toBe('escort');
    expect(stanceOf(s, ctx, other).engagement).toBe('aggressive');
    expect(effectiveStance(s, f).engagement).toBe('escort');
    expect(stanceSource(s, f, 'engagement')).toBe('rule');
    expect(stanceSource(s, f, 'mining')).not.toBe('rule');
    // Reordering within a level changes the winner.
    order(s, { type: 'moveCard', id: s.cards[3].id, to: 0 });
    expect(stanceOf(s, buildCtx(s), f).engagement).toBe('defensive');
    // A disabled card is skipped; the next level down takes over.
    for (const c of s.cards) if (c.scope.kind === 'hangar') c.enabled = false;
    expect(stanceOf(s, buildCtx(s), f).engagement).toBe('aggressive');
  });

  it('a card whose conditions fail falls through to a broader one', () => {
    const s = game();
    const f = launched(s, 'fighter');
    order(s, {
      type: 'addCard',
      card: {
        enabled: true,
        scope: { kind: 'class', cls: 'fighter' },
        when: [{ kind: 'hullBelow', value: 0.5 }],
        then: { kind: 'stance', to: 'underFire:retreatHull' },
      },
    });
    order(s, { type: 'addCard', card: stanceCard({ kind: 'fleet' }, 'underFire:stand') });
    expect(stanceOf(s, buildCtx(s), f).underFire).toBe('stand');
    f.hull = 1;
    expect(stanceOf(s, buildCtx(s), f).underFire).toBe('retreatHull');
  });

  it('a timed stance card holds for its seconds after the conditions stop', () => {
    const s = game();
    const f = launched(s, 'fighter');
    s.wave.warning = true;
    order(s, {
      type: 'addCard',
      card: {
        enabled: true,
        scope: { kind: 'class', cls: 'fighter' },
        when: [{ kind: 'wave' }],
        then: { kind: 'stance', to: 'engagement:aggressive', seconds: 5 },
      },
    });
    expect(stanceOf(s, buildCtx(s), f).engagement).toBe('aggressive');
    expect(f.hold).toEqual({ card: s.cards[0].id, until: s.time + 5 });
    s.wave.warning = false;
    s.time += 4;
    expect(stanceOf(s, buildCtx(s), f).engagement).toBe('aggressive');
    s.time += 2;
    expect(stanceOf(s, buildCtx(s), f).engagement).toBe('defensive');
    expect(f.hold).toBeUndefined();
  });

  it('a narrower recall card docks only the ships it covers', () => {
    const s = game();
    const d = launched(s, 'drone');
    const f = launched(s, 'fighter');
    order(s, {
      type: 'addCard',
      card: {
        enabled: true,
        scope: { kind: 'class', cls: 'drone' },
        when: [{ kind: 'energyBelow', value: 0.5 }],
        then: { kind: 'recall' },
      },
    });
    s.carrier.energy = 0;
    stepSim(s);
    expect(d.mode).toBe('recall');
    expect(f.mode).not.toBe('recall');
  });

  it('fall back works for any ship type', () => {
    const s = game();
    const sc = launched(s, 'scout');
    order(s, {
      type: 'addCard',
      card: {
        enabled: true,
        scope: { kind: 'class', cls: 'scout' },
        when: [{ kind: 'hullBelow', value: 0.9 }],
        then: { kind: 'fallBack' },
      },
    });
    sc.hull = 1;
    stepSim(s);
    expect(sc.mode).toBe('retreat');
    expect(s.events.some((e) => e.kind === 'ShipRetreating')).toBe(true);
  });

  it('reads each condition', () => {
    const s = game();
    const d = launched(s, 'drone');
    const holds = (kind: RuleCard['when'][number]['kind'], value?: number, ship: Ship | null = d) =>
      conditionHolds(s, { kind, value }, ship);
    s.asteroids = [
      { id: 900, pos: { x: 10, y: 0, z: 40 }, ore: 5, maxOre: 5, value: 1, radius: 1, respawn: 0 },
    ];
    expect(holds('asteroidFarther', 30)).toBe(true);
    expect(holds('asteroidFarther', 50)).toBe(false);
    s.asteroids[0].ore = 0;
    expect(holds('asteroidFarther', 50)).toBe(true);
    expect(holds('carrierFarther', 5)).toBe(true);
    expect(holds('carrierFarther', 15)).toBe(false);
    d.cargo = 0;
    expect(holds('cargoAbove', 0.5)).toBe(false);
    d.cargo = 1e6;
    expect(holds('cargoAbove', 0.5)).toBe(true);
    expect(holds('hullBelow', 0.5)).toBe(false);
    s.pirates = [];
    expect(holds('pirateWithin')).toBe(false);
    s.pirates.push({
      id: 999,
      pos: { x: 40, y: 0, z: 0 },
      hull: 1,
      maxHull: 1,
      damage: 1,
      speed: 1,
      targetId: -1,
      fireCooldown: 0,
    });
    expect(holds('pirateWithin')).toBe(true);
    expect(holds('pirateWithin', 20)).toBe(false);
    expect(holds('pirateWithin', 35)).toBe(true);
    // Without a unit, distances are measured from the carrier (at the origin).
    expect(holds('pirateWithin', 35, null)).toBe(false);
    expect(holds('cargoAbove', 0, null)).toBe(false);
    s.storm.active = 0;
    expect(holds('storm')).toBe(false);
    s.storm.active = 3;
    expect(holds('storm')).toBe(true);
    s.carrier.shield = 0.1;
    expect(holds('shieldBelow', 0.2)).toBe(true);
    expect(holds('always')).toBe(true);
  });

  it('checks cards from the UI', () => {
    const s = game();
    const ok: NewCard = {
      enabled: true,
      scope: { kind: 'class', cls: 'barge' },
      when: [{ kind: 'cargoAbove', value: 7 }],
      then: { kind: 'callHauler', to: 'mining:greedy' },
    };
    expect(order(s, { type: 'addCard', card: ok })).toBeNull();
    // Values are clamped and stray fields dropped.
    expect(s.cards[0].when[0].value).toBe(1);
    expect(s.cards[0].then).toEqual({ kind: 'callHauler' });
    const bad = (card: NewCard) => order(s, { type: 'addCard', card });
    expect(bad({ ...ok, scope: { kind: 'class', cls: 'drone' } })).toMatch(/nothing/);
    expect(bad({ ...ok, when: [] })).toMatch(/conditions/);
    expect(
      bad({ ...ok, when: Array.from({ length: 4 }, () => ({ kind: 'always' as const })) }),
    ).toMatch(/conditions/);
    expect(bad({ ...ok, scope: { kind: 'hangar', id: 99 } })).toMatch(/nothing/);
    expect(
      bad({
        ...ok,
        scope: { kind: 'fleet' },
        then: { kind: 'reserveWarp' },
        when: [{ kind: 'hullBelow' }],
      }),
    ).toMatch(/carrier/);
    expect(bad({ ...ok, then: { kind: 'stance', to: 'engagement:berserk' as never } })).toMatch(
      /stance/,
    );
    s.unlockedRules = s.unlockedRules.filter((x) => x !== 'bargeCallHauler');
    expect(bad(ok)).toMatch(/locked/);
    // A locked action's existing card stops firing but stays on the board.
    expect(s.cards).toHaveLength(1);
  });

  it('caps cards at the slot count and edits in place', () => {
    const s = game();
    const card = stanceCard({ kind: 'fleet' }, 'mining:greedy');
    for (let i = 0; i < CARD_SLOTS; i++) expect(order(s, { type: 'addCard', card })).toBeNull();
    expect(order(s, { type: 'addCard', card })).toMatch(/slots/);
    const id = s.cards[2].id;
    expect(
      order(s, { type: 'updateCard', id, card: { ...card, enabled: false, preset: 'haulerPark' } }),
    ).toBeNull();
    expect(s.cards[2]).toMatchObject({ id, enabled: false });
    expect(order(s, { type: 'updateCard', id: 12345, card })).toMatch(/No such/);
    expect(order(s, { type: 'moveCard', id, to: 99 })).toBeNull();
    expect(s.cards.at(-1)!.id).toBe(id);
    expect(order(s, { type: 'deleteCard', id })).toBeNull();
    expect(s.cards).toHaveLength(CARD_SLOTS - 1);
  });
});

describe('hangar-scoped cards across carriers (#178)', () => {
  it("adds and edits a card scoped to another carrier's hangar through apply", () => {
    const g = newGame(3);
    g.lifetime.admiralties = 3;
    g.credits = 1e7;
    expect(apply(g, { type: 'buyCarrier', carrierId: g.ops[0].id })).toBeNull();
    g.focusId = g.ops[0].id;
    for (const id of Object.keys(PRESETS) as RuleId[]) unlockRule(bind(g, g.ops[0]), id);
    const theirs = g.ops[1].hangars[0].id;
    expect(g.ops[0].hangars.map((h) => h.id)).not.toContain(theirs);
    const card = stanceCard({ kind: 'hangar', id: theirs }, 'engagement:escort');
    expect(apply(g, { type: 'addCard', card, carrierId: g.ops[0].id })).toBeNull();
    const added = g.cards.at(-1)!;
    expect(added.scope).toEqual({ kind: 'hangar', id: theirs });
    const edited = stanceCard({ kind: 'hangar', id: theirs }, 'engagement:defensive');
    expect(
      apply(g, { type: 'updateCard', id: added.id, card: edited, carrierId: g.ops[0].id }),
    ).toBeNull();
    expect(
      apply(g, {
        type: 'addCard',
        card: stanceCard({ kind: 'hangar', id: 9999 }, 'engagement:escort'),
        carrierId: g.ops[0].id,
      }),
    ).toMatch(/nothing/);
  });

  it("applies to the owning carrier's ships only", () => {
    const g = newGame(3);
    g.lifetime.admiralties = 3;
    g.credits = 1e7;
    expect(apply(g, { type: 'buyCarrier', carrierId: g.ops[0].id })).toBeNull();
    const theirs = g.ops[1].hangars[0].id;
    const card: RuleCard = {
      id: 1,
      ...stanceCard({ kind: 'hangar', id: theirs }, 'engagement:escort'),
    };
    const s0 = bind(g, g.ops[0]);
    const s1 = bind(g, g.ops[1]);
    const mine = s0.ships[0];
    expect(firing(s0, [card], mine)).toBeNull();
    s1.ships.push({ ...mine, hangarId: theirs });
    expect(firing(s1, [card], s1.ships.at(-1)!)).toBe(card);
  });
});
