import type { OutMsg } from './protocol';
import { SimRunner } from './runner';
import type { SimHost } from './host';

/**
 * Same protocol as the worker, on this thread. Messages are structured-cloned both ways
 * so neither side can hold a live reference into the other's state.
 */
export function createLocalHost(onMessage: (msg: OutMsg) => void): SimHost & { runner: SimRunner } {
  const runner = new SimRunner((msg, transfer) =>
    onMessage(structuredClone(msg, { transfer: transfer ?? [] })),
  );
  return { kind: 'local', runner, post: (msg) => runner.handle(structuredClone(msg)) };
}
