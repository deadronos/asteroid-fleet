// Test helpers: most sim tests play the one operation of a fresh game.

import { focused, newGame } from './state';
import type { Sim } from './types';

/** `newGame`, bound to its only operation. */
export function game(...args: Parameters<typeof newGame>): Sim {
  return focused(newGame(...args));
}
