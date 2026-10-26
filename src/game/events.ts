import type { Severity, SimEvent } from '../sim/types';

/** Events of the same kind and carrier this close in sim time merge into one. */
export const MERGE_WINDOW_S = 5;

const RANK: Record<Severity, number> = { critical: 0, warn: 1, good: 2, info: 3 };

/**
 * An event as the runner sends it. `id` is stable while the event keeps merging,
 * so a receiver replaces the earlier copy instead of adding another.
 */
export type BusEvent = SimEvent & { id: number };

/** Most severe first; oldest first within a severity. */
export function rankEvents<T extends SimEvent>(events: T[]): T[] {
  return events.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.t - b.t);
}

/**
 * Merges drained sim events. Each kind + carrier keeps one open event for
 * MERGE_WINDOW_S of sim time from its first occurrence; later ones bump its `count`
 * and take over its `data`, `systemId` and `t`.
 */
export class EventAggregator {
  private open = new Map<string, { start: number; ev: BusEvent }>();
  private nextId = 1;

  /** Feed one pump's drained events (oldest first); returns the events that changed, ranked. */
  push(events: SimEvent[]): BusEvent[] {
    const changed = new Map<number, BusEvent>();
    for (const ev of events) {
      const key = `${ev.kind}:${ev.carrierId}`;
      const cur = this.open.get(key);
      const age = cur ? ev.t - cur.start : -1;
      let merged: BusEvent;
      if (cur && age >= 0 && age < MERGE_WINDOW_S) {
        merged = { ...ev, id: cur.ev.id, count: cur.ev.count + ev.count };
        cur.ev = merged;
      } else {
        merged = { ...ev, id: this.nextId++ };
        this.open.set(key, { start: ev.t, ev: merged });
      }
      changed.set(merged.id, merged);
    }
    return rankEvents([...changed.values()]);
  }

  /** Forget open events, e.g. when a new run restarts sim time. */
  reset() {
    this.open.clear();
  }
}
