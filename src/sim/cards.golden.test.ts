import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PRESETS } from './config';
import { createShip, enterSystem, newGame, unlockRule } from './state';
import { stressGame } from './stress';
import { step } from './tick';
import { SHIP_CLASSES, type GameState, type RuleId, type ShipClass } from './types';

// Golden equivalence for #82. The digests below were recorded with the fixed
// `Rule` system (before condition/action cards). Each scenario now runs with the
// equivalent preset cards and must land on exactly the same state.

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
function configure(s: GameState, spec: Spec) {
  expect(new Set(s.cards.map((c) => c.preset))).toEqual(new Set(IDS));
  expect(s.cards).toHaveLength(IDS.length);
  for (const card of s.cards) {
    const v = spec[card.preset!];
    card.enabled = v !== undefined && v !== false;
    const at = PRESETS[card.preset!].param;
    if (typeof v === 'number' && at !== undefined) card.when[at].value = v;
  }
}

function digest(s: GameState): string {
  const {
    cards: _c,
    unlockedRules: _u,
    version: _v,
    savedAt: _s,
    ...rest
  } = s as GameState & Record<string, unknown>;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}

/** Tier-3 gas giant at scale, under attack with shields down: every rule fires. */
function stress(seed: number): GameState {
  const s = stressGame(200, 200, 25, seed);
  s.wave.timer = 40;
  s.carrier.shield = 0.1;
  return s;
}

/** A mid-game frontier fleet launching from its hangars. */
function campaign(seed: number): GameState {
  const s = newGame(seed);
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

function run(make: (seed: number) => GameState, seed: number, spec: Spec): string {
  const s = make(seed);
  configure(s, spec);
  for (let i = 0; i < TICKS; i++) step(s);
  return digest(s);
}

const ALL: Spec = { ...DEFAULT_PARAM };
const VARIANT: Spec = {
  ...ALL,
  bargeCallHauler: 0.4,
  recallOnLowShields: 0.9,
  droneUnloadAtBarge: 40,
};

const CASES: [name: string, make: (seed: number) => GameState, seed: number, spec: Spec][] = [
  ['stress, all rules', stress, 5, ALL],
  ['stress, tuned params', stress, 5, VARIANT],
  ['stress, no rules', stress, 5, {}],
  ...IDS.map(
    (id) =>
      [`stress, all but ${id}`, stress, 5, { ...ALL, [id]: false }] as [
        string,
        (seed: number) => GameState,
        number,
        Spec,
      ],
  ),
  ['campaign, all rules', campaign, 7, ALL],
  ['campaign, tuned params', campaign, 7, VARIANT],
];

const GOLDEN: Record<string, string> = {
  'stress, all rules': 'c537dbd047105bae',
  'stress, tuned params': 'ae35e31c398bbf2a',
  'stress, no rules': '72c5907330c4b5b9',
  'stress, all but fightersEscortOnWave': 'b97174a935d136d6',
  'stress, all but bargeCallHauler': '8fea1adfff7b9b53',
  'stress, all but bargeFallBack': '6bf8288673cad2ab',
  'stress, all but droneUnloadAtBarge': '632e085f228de596',
  'stress, all but haulerPark': 'd8679767bd4dda99',
  'stress, all but recallOnLowShields': '5021227d1fb57a61',
  'stress, all but reserveWarpEnergy': '3e153385ad6e2a61',
  'stress, all but harvesterStormShelter': 'aed994e1a0ef56c1',
  'campaign, all rules': '66d70b7c16dbe425',
  'campaign, tuned params': '056f469f8e865ec8',
};

describe('preset cards match the fixed rules (#82)', () => {
  it.each(CASES)(
    '%s',
    (name, make, seed, spec) => {
      expect(run(make, seed, spec)).toBe(GOLDEN[name]);
    },
    30_000,
  );
});
