import type { GameState, Operation, Sim } from './types';

/** Every `Operation` field. The `satisfies` below fails to compile when one is missing. */
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

/**
 * A `Sim` over one GameState and one Operation. The accessors are defined once on the
 * prototype from the key lists above, so every read stays monomorphic in the hot loop.
 */
class SimView {
  constructor(
    readonly g: GameState,
    readonly op: Operation,
  ) {}
}

function forward(from: 'g' | 'op', keys: readonly string[]) {
  for (const k of keys) {
    Object.defineProperty(SimView.prototype, k, {
      get(this: SimView) {
        return (this[from] as unknown as Record<string, unknown>)[k];
      },
      set(this: SimView, v: unknown) {
        (this[from] as unknown as Record<string, unknown>)[k] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
}
forward('g', GAME_KEYS);
forward('op', OP_KEYS);

const views = new WeakMap<Operation, SimView>();

/** `g` and `op` as one `Sim`. Not serialisable: save `g` itself. */
export function bind(g: GameState, op: Operation): Sim {
  let v = views.get(op);
  if (!v || v.g !== g) {
    v = new SimView(g, op);
    views.set(op, v);
  }
  return v as unknown as Sim;
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
