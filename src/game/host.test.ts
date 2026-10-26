import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/state';
import { createSimHost } from './host';
import type { OutMsg } from './protocol';

describe('createSimHost', () => {
  it('falls back to a lazily loaded main-thread sim when the worker is off', async () => {
    const out: OutMsg[] = [];
    const host = createSimHost((m) => out.push(m), false);
    expect(host.kind).toBe('local');
    // Posted before the local chunk has loaded; must be queued, then answered.
    host.post({ t: 'init', state: newGame(), now: 0, settle: false, epoch: 1 });
    await new Promise((r) => setTimeout(r, 200));
    expect(out.length).toBeGreaterThan(0);
  });
});
