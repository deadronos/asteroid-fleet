import { describe, expect, it } from 'vitest';
import { GAME_KEYS, OP_KEYS, bind, newGame, stateOf } from './state';
import { SimView } from './viewAccessors';

describe('SimView', () => {
  it('forwards every key to its owner, reads and writes', () => {
    const g = newGame(7);
    const op = g.ops[0];
    const s = bind(g, op);
    for (const k of GAME_KEYS) expect(s[k]).toBe(g[k]);
    for (const k of OP_KEYS) expect(s[k]).toBe(op[k]);
    s.credits = 99;
    s.systemId = 3;
    expect(g.credits).toBe(99);
    expect(op.systemId).toBe(3);
    expect(stateOf(s)).toBe(g);
  });

  it('has exactly one generated accessor pair per key (run `pnpm run gen:view` if this fails)', () => {
    const own = Object.getOwnPropertyNames(SimView.prototype).filter((k) => k !== 'constructor');
    expect(own.sort()).toEqual([...GAME_KEYS, ...OP_KEYS].sort());
    for (const k of own) {
      const d = Object.getOwnPropertyDescriptor(SimView.prototype, k)!;
      expect(typeof d.get).toBe('function');
      expect(typeof d.set).toBe('function');
    }
  });
});
