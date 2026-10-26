import { describe, expect, it } from 'vitest';
import type { EventData, SimEvent, SimEventKind } from '../sim/types';
import { EventAggregator, MERGE_WINDOW_S, rankEvents } from './events';
import { SEVERITY } from '../sim/state';

function ev<K extends SimEventKind>(
  kind: K,
  t: number,
  data: EventData[K],
  carrierId = 0,
): SimEvent {
  return { kind, carrierId, systemId: 0, severity: SEVERITY[kind], t, count: 1, data } as SimEvent;
}

describe('event aggregation', () => {
  it('merges the same kind and carrier within the window into one counted event', () => {
    const agg = new EventAggregator();
    const out = agg.push([
      ev('ShipLost', 10, { cls: 'drone', cause: 'destroyed' }),
      ev('ShipLost', 11, { cls: 'drone', cause: 'destroyed' }),
      ev('ShipLost', 12, { cls: 'fighter', cause: 'destroyed' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'ShipLost', count: 3, t: 12, data: { cls: 'fighter' } });
  });

  it('keeps merging across pumps under the same id', () => {
    const agg = new EventAggregator();
    const [a] = agg.push([ev('ReserveRebuilt', 10, { cls: 'drone' })]);
    const [b] = agg.push([ev('ReserveRebuilt', 10 + MERGE_WINDOW_S - 0.1, { cls: 'drone' })]);
    expect(b.id).toBe(a.id);
    expect(b.count).toBe(2);
    expect(a.count).toBe(1); // earlier copies are not mutated
  });

  it('opens a new event after the window, on another carrier, or for another kind', () => {
    const agg = new EventAggregator();
    const [a] = agg.push([ev('ReserveRebuilt', 10, { cls: 'drone' })]);
    const [late] = agg.push([ev('ReserveRebuilt', 10 + MERGE_WINDOW_S, { cls: 'drone' })]);
    expect(late.id).not.toBe(a.id);
    expect(late.count).toBe(1);
    const other = agg.push([
      ev('ReserveRebuilt', 16, { cls: 'drone' }, 1),
      ev('ShipRebuilt', 16, { cls: 'drone', cost: 50 }),
    ]);
    expect(other.map((e) => e.count)).toEqual([1, 1]);
    expect(new Set([a.id, late.id, ...other.map((e) => e.id)]).size).toBe(4);
  });

  it('does not merge into an event from a later time (new run) and forgets on reset', () => {
    const agg = new EventAggregator();
    const [a] = agg.push([ev('WaveRepelled', 100, {})]);
    const [b] = agg.push([ev('WaveRepelled', 1, {})]);
    expect(b.id).not.toBe(a.id);
    agg.reset();
    const [c] = agg.push([ev('WaveRepelled', 2, {})]);
    expect(c.count).toBe(1);
    expect(c.id).not.toBe(b.id);
  });

  it('ranks by severity, oldest first within one', () => {
    const ranked = rankEvents([
      ev('StormPassed', 1, { h2: false }),
      ev('VeinFound', 2, { veins: 1 }),
      ev('ShipLost', 4, { cls: 'drone', cause: 'destroyed' }),
      ev('PiratesArrived', 5, { size: 2 }),
      ev('PirateWaveIncoming', 3, { size: 2, eta: 10 }),
    ]);
    expect(ranked.map((e) => e.kind)).toEqual([
      'PiratesArrived',
      'PirateWaveIncoming',
      'ShipLost',
      'VeinFound',
      'StormPassed',
    ]);
  });
});
