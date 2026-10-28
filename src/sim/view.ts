import type { GameState, Operation, Sim } from './types';
import { SimView } from './viewAccessors';

/**
 * Every `Operation` field. The `satisfies` below fails to compile when one is missing.
 * `SimView` (viewAccessors.ts) is generated from this list and GAME_KEYS: run `pnpm run gen:view`.
 */
export const OP_KEYS = [
  'id',
  'rng',
  'carrier',
  'hangars',
  'ships',
  'pirates',
  'asteroids',
  'containers',
  'hazards',
  'recon',
  'systemId',
  'warp',
  'wave',
  'storm',
  'reserveTimers',
  'incomeAvg',
  'miningIncomeAvg',
  'fx',
  'noCoverAt',
] as const satisfies readonly (keyof Operation)[];

/** Every run-wide `GameState` field a `Sim` exposes (all but `ops` and `focusId`). */
export const GAME_KEYS = [
  'version',
  'seed',
  'time',
  'nextId',
  'credits',
  'research',
  'marks',
  'modifiers',
  'challenge',
  'challengesDone',
  'admiralty',
  'researchLevels',
  'unlocked',
  'hulls',
  'unlockedRules',
  'systems',
  'fields',
  'alerts',
  'doctrine',
  'cards',
  'automation',
  'stats',
  'lifetime',
  'powerMode',
  'log',
  'events',
  'routes',
  'savedAt',
] as const satisfies readonly (keyof GameState)[];

type Missing<K, Listed> = Exclude<K, Listed> extends never ? true : Exclude<K, Listed>;
const opKeysComplete: Missing<keyof Operation, (typeof OP_KEYS)[number]> = true;
const gameKeysComplete: Missing<
  Exclude<keyof GameState, 'ops' | 'focusId'>,
  (typeof GAME_KEYS)[number]
> = true;
void opKeysComplete;
void gameKeysComplete;

const views = new WeakMap<Operation, SimView>();

/** `g` and `op` as one `Sim`. Not serialisable: save `g` itself. */
export function bind(g: GameState, op: Operation): Sim {
  let v = views.get(op);
  if (!v || v.g !== g) {
    v = new SimView(g, op);
    views.set(op, v);
  }
  return v;
}

/** The run-wide state behind a bound `Sim`. */
export function stateOf(s: Sim): GameState {
  return (s as unknown as SimView).g;
}

/** The operation the player is looking at: `focusId`, or the first one. */
export function focusOp(g: GameState): Operation {
  if (g.focusId !== undefined) for (const op of g.ops) if (op.id === g.focusId) return op;
  return g.ops[0];
}

/** `bind` for the focused operation. */
export function focused(g: GameState): Sim {
  return bind(g, focusOp(g));
}
