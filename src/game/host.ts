import type { InMsg, OutMsg } from './protocol';

export interface SimHost {
  kind: 'worker' | 'local';
  post(msg: InMsg): void;
}

/** Run the sim in a worker when the platform has one, else on this thread. */
export function createSimHost(onMessage: (msg: OutMsg) => void, preferWorker = true): SimHost {
  if (preferWorker && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      // Until the worker answers, keep what was sent so a failed load can replay it locally.
      let pending: InMsg[] | null = [];
      let local: SimHost | null = null;
      worker.addEventListener('message', (e: MessageEvent<OutMsg>) => {
        pending = null;
        onMessage(e.data);
      });
      worker.addEventListener('error', (e) => {
        if (!pending) return;
        e.preventDefault();
        console.warn('Sim worker failed to start; running the sim on the main thread.');
        worker.terminate();
        local = createLazyLocalHost(onMessage);
        host.kind = 'local';
        for (const m of pending) local.post(m);
        pending = null;
      });
      const host: SimHost = {
        kind: 'worker',
        post: (msg) => {
          if (local) return local.post(msg);
          pending?.push(msg);
          // A Worker has no target origin; the rule is for window.postMessage.
          // oxlint-disable-next-line unicorn/require-post-message-target-origin
          worker.postMessage(msg);
        },
      };
      return host;
    } catch {
      /* worker construction blocked (CSP, old browser); fall back below */
    }
  }
  return createLazyLocalHost(onMessage);
}

/**
 * The main-thread sim lives in its own chunk (./localHost), fetched only when the worker is
 * unavailable. Messages posted before the chunk arrives are queued and replayed in order.
 */
function createLazyLocalHost(onMessage: (msg: OutMsg) => void): SimHost {
  let inner: SimHost | null = null;
  let queue: InMsg[] | null = [];
  void import('./localHost').then(({ createLocalHost }) => {
    inner = createLocalHost(onMessage);
    for (const m of queue ?? []) inner.post(m);
    queue = null;
  });
  return { kind: 'local', post: (msg) => (inner ? inner.post(msg) : queue?.push(msg)) };
}
