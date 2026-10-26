import { describe, expect, it, vi } from 'vitest';
import type { firing as realFiring } from './cards';
import { PRESETS } from './config';
import { cargoCap, nearestPirate } from './ctx';
import { dist } from './math';
import { createShip, enterSystem, h2Storm, unlockRule, stateOf } from './state';
import { stressGame } from './stress';
import { stepSim } from './tick';
import { SHIP_CLASSES, type Sim, type RuleId, type ShipClass } from './types';
import { game } from './testing';

// Golden equivalence for #82. Each scenario runs twice in this process from the
// same seed: once through the card engine with the preset cards, once with the
// card evaluator swapped for the fixed rules' checks, copied from the code before
// cards (commit dbac7d6). Both runs must land on exactly the same state.
//
// The comparison is in-process because stored hashes of a 2000-tick run differ
// between platforms (libm), so they cannot be checked in CI.

/** While set, `firing` answers with the old rule checks for these params. */
const legacy = vi.hoisted(() => ({ spec: null as Partial<Record<string, number | false>> | null }));

vi.mock('./cards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./cards')>();
  const firing: typeof realFiring = (s, list, ship) =>
    legacy.spec ? oldRule(s, list, ship) : mod.firing(s, list, ship);
  return { ...mod, firing };
});

/**
 * The fixed rules' checks, keyed by the action of the preset they became. The
 * card engine still decides whether the rule is on (enabled and unlocked), as
 * `rule()` did; this only replaces the condition.
 */
const oldRule: typeof realFiring = (s, list, ship) => {
  const card = list[0];
  // No active card: the rule was off (or locked), so `rule()` returned null.
  if (!card) return null;
  const spec = legacy.spec!;
  const param = (id: RuleId) => spec[id] as number;
  let on: boolean;
  switch (card.then.kind) {
    case 'stance':
      on = ship?.cls === 'fighter' && (s.wave.warning || s.wave.active);
      break;
    case 'callHauler':
      on = !!ship && ship.cargo / cargoCap(s, 'barge', ship) >= param('bargeCallHauler');
      break;
    case 'fallBack':
      on = ship?.cls === 'barge' && !!nearestPirate(s, ship.pos, 28);
      break;
    case 'unloadAtBarge':
      on = !!ship && dist(ship.pos, s.carrier.pos) > param('droneUnloadAtBarge');
      break;
    case 'park':
      on = ship?.cls === 'hauler';
      break;
    case 'recall':
      on = s.carrier.shield < param('recallOnLowShields') && s.pirates.length > 0;
      break;
    case 'reserveWarp':
      on = !ship;
      break;
    case 'shelter':
      on = ship?.cls === 'harvester' && h2Storm(s);
      break;
  }
  return on ? card : null;
};

const IDS = Object.keys(PRESETS) as RuleId[];
/** The old rules' default params. */
const DEFAULT_PARAM: Record<RuleId, number> = {
  fightersEscortOnWave: 0,
  bargeCallHauler: 0.8,
  bargeFallBack: 0,
  droneUnloadAtBarge: 15,
  haulerPark: 0,
  recallOnLowShields: 0.2,
  reserveWarpEnergy: 0,
  harvesterStormShelter: 0,
};
const TICKS = 2000;

/** Rule id -> the old rule's param, or false for disabled. Missing ids are disabled. */
type Spec = Partial<Record<RuleId, number | false>>;

/** Set each preset card the way the old `Rule { enabled, param }` was set. */
function configure(s: Sim, spec: Spec) {
  expect(new Set(s.cards.map((c) => c.preset))).toEqual(new Set(IDS));
  expect(s.cards).toHaveLength(IDS.length);
  for (const card of s.cards) {
    const v = spec[card.preset!];
    card.enabled = v !== undefined && v !== false;
    const at = PRESETS[card.preset!].param;
    if (typeof v === 'number' && at !== undefined) card.when[at].value = v;
  }
}

function digest(s: Sim): string {
  return JSON.stringify({ ...stateOf(s), savedAt: 0 });
}

/** Tier-3 gas giant at scale, under attack with shields down: every rule fires. */
function stress(seed: number): Sim {
  const s = stressGame(200, 200, 25, seed);
  s.wave.timer = 40;
  s.carrier.shield = 0.1;
  return s;
}

/** A mid-game frontier fleet launching from its hangars. */
function campaign(seed: number): Sim {
  const s = game(seed);
  for (const c of SHIP_CLASSES) if (!s.unlocked.includes(c)) s.unlocked.push(c);
  for (const id of IDS) unlockRule(s, id);
  s.researchLevels = { fusion: 1, bargeBay: 1 };
  enterSystem(
    s,
    s.systems.findIndex((x) => x.tier === 2 && x.gasGiant),
  );
  for (const h of s.hangars) h.slots = 40;
  const mix: [ShipClass, number][] = [
    ['drone', 14],
    ['barge', 3],
    ['hauler', 2],
    ['fighter', 6],
    ['harvester', 2],
    ['repair', 1],
    ['scout', 1],
  ];
  let i = 0;
  for (const [cls, n] of mix) for (let k = 0; k < n; k++) createShip(s, cls, (i++ % 2) + 1);
  s.wave.timer = 90;
  return s;
}

function run(make: (seed: number) => Sim, seed: number, spec: Spec, old: boolean): string {
  const s = make(seed);
  configure(s, spec);
  legacy.spec = old ? spec : null;
  try {
    for (let i = 0; i < TICKS; i++) stepSim(s);
  } finally {
    legacy.spec = null;
  }
  return digest(s);
}

const ALL: Spec = { ...DEFAULT_PARAM };
const VARIANT: Spec = {
  ...ALL,
  bargeCallHauler: 0.4,
  recallOnLowShields: 0.9,
  droneUnloadAtBarge: 40,
};

const CASES: [name: string, make: (seed: number) => Sim, seed: number, spec: Spec][] = [
  ['stress, all rules', stress, 5, ALL],
  ['stress, tuned params', stress, 5, VARIANT],
  ['stress, no rules', stress, 5, {}],
  ...IDS.map(
    (id) =>
      [`stress, all but ${id}`, stress, 5, { ...ALL, [id]: false }] as [
        string,
        (seed: number) => Sim,
        number,
        Spec,
      ],
  ),
  ['campaign, all rules', campaign, 7, ALL],
  ['campaign, tuned params', campaign, 7, VARIANT],
];

/** Old-rule runs by case name, for checking that every rule matters. */
const OLD = new Map<string, string>();

describe('preset cards match the fixed rules (#82)', () => {
  it.each(CASES)(
    '%s',
    (name, make, seed, spec) => {
      const old = run(make, seed, spec, true);
      OLD.set(name, old);
      expect(run(make, seed, spec, false) === old).toBe(true);
    },
    30_000,
  );

  it("presets default to the old rules' params", () => {
    const defaults = IDS.filter((id) => PRESETS[id].param !== undefined).map((id) => [
      id,
      PRESETS[id].card.when[PRESETS[id].param!].value,
    ]);
    expect(defaults).toEqual([
      ['bargeCallHauler', DEFAULT_PARAM.bargeCallHauler],
      ['droneUnloadAtBarge', DEFAULT_PARAM.droneUnloadAtBarge],
      ['recallOnLowShields', DEFAULT_PARAM.recallOnLowShields],
    ]);
  });

  it('every rule changes the outcome of the stress scenario', () => {
    const all = OLD.get('stress, all rules');
    expect(all).toBeDefined();
    const runs = [
      all,
      OLD.get('stress, no rules'),
      ...IDS.map((id) => OLD.get(`stress, all but ${id}`)),
    ];
    expect(runs.every((r) => r !== undefined)).toBe(true);
    expect(new Set(runs).size).toBe(runs.length);
  });
});
