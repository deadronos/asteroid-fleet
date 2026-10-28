import { describe, expect, it } from 'vitest';
import { MERGE_WINDOW_S } from '../game/events';
import { SEVERITY } from '../sim/state';
import type { EventData, SimEvent, SimEventKind } from '../sim/types';
import { formatEvent } from './events';
import { activeCarrier, carrierChoices, filterEvents, inboxKey, mergeForInbox } from './inbox';

function ev<K extends SimEventKind>(
  kind: K,
  t: number,
  data: EventData[K],
  extra: { carrierId?: number; severity?: SimEvent['severity']; count?: number } = {},
): SimEvent {
  return {
    kind,
    carrierId: extra.carrierId ?? 0,
    systemId: 0,
    severity: extra.severity ?? SEVERITY[kind],
    t,
    count: extra.count ?? 1,
    data,
  } as SimEvent;
}

describe('inbox merge', () => {
  it('collapses the same kind and carrier inside the bus window and shows the count', () => {
    const log = [
      ev('ShipLost', 12, { cls: 'fighter', cause: 'destroyed' }),
      ev('ShipLost', 11, { cls: 'drone', cause: 'destroyed' }),
      ev('ShipLost', 10, { cls: 'drone', cause: 'destroyed' }),
    ];
    const [row] = mergeForInbox(log);
    expect(mergeForInbox(log)).toHaveLength(1);
    expect(row.count).toBe(3);
    expect(row.t).toBe(12);
    expect(formatEvent(row)).toMatch(/^3 ships lost/);
  });

  it('does not merge across carriers, the window, or a backwards clock', () => {
    const same = ev('ReserveRebuilt', 10, { cls: 'drone' });
    const other = ev('ReserveRebuilt', 11, { cls: 'drone' }, { carrierId: 1 });
    const late = ev('ReserveRebuilt', 10 + MERGE_WINDOW_S, { cls: 'scout' });
    const rewound = ev('ReserveRebuilt', 1, { cls: 'hauler' });
    const rows = mergeForInbox([rewound, late, other, same]);
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1, 1]);
  });

  it('orders a group by its latest event, ahead of one that started later', () => {
    const log = [
      ev('VeinFound', 4, { veins: 2 }),
      ev('ShipLost', 3, { cls: 'drone', cause: 'destroyed' }),
      ev('VeinFound', 1, { veins: 1 }),
    ];
    const rows = mergeForInbox(log);
    expect(rows.map((r) => [r.kind, r.t, r.count])).toEqual([
      ['VeinFound', 4, 2],
      ['ShipLost', 3, 1],
    ]);
  });

  it('keeps Legacy keys stable when the oldest log line rolls off', () => {
    const full: SimEvent[] = [];
    for (let i = 0; i < 41; i++) {
      full.unshift(ev('Legacy', i, { text: `line ${i}` }, { severity: 'info' }));
    }
    const before = mergeForInbox(full);
    const after = mergeForInbox(full.slice(0, 40));
    const keys = new Map(before.map((row) => [formatEvent(row), inboxKey(row)]));
    expect(after).toHaveLength(40);
    for (const row of after) expect(inboxKey(row)).toBe(keys.get(formatEvent(row)));
  });

  it('keeps typed-event keys stable when the oldest log line rolls off', () => {
    const full: SimEvent[] = [];
    for (let i = 0; i < 41; i++) {
      full.unshift(ev('VeinFound', i * (MERGE_WINDOW_S + 1), { veins: 1 }));
    }
    const before = mergeForInbox(full);
    const after = mergeForInbox(full.slice(0, 40));
    const keys = new Map(before.map((row) => [row.t, inboxKey(row)]));
    expect(after).toHaveLength(40);
    for (const row of after) expect(inboxKey(row)).toBe(keys.get(row.t));
  });

  it('gives two Legacy lines at t=0 distinct keys', () => {
    const log = [
      ev('Legacy', 0, { text: 'Docked.' }, { severity: 'info' }),
      ev('Legacy', 0, { text: 'Storm passed.' }, { severity: 'good' }),
    ];
    const rows = mergeForInbox(log);
    expect(rows.map((r) => formatEvent(r))).toEqual(['Docked.', 'Storm passed.']);
    expect(inboxKey(rows[0])).not.toBe(inboxKey(rows[1]));
  });

  it('keeps Legacy lines intact so old saves still render', () => {
    const log = [
      ev('Legacy', 30, { text: 'Storm passed.' }, { severity: 'info' }),
      ev('Legacy', 28, { text: 'Docked.' }, { severity: 'good' }),
      ev('VeinFound', 27, { veins: 2 }),
      ev('VeinFound', 26, { veins: 1 }),
    ];
    const rows = mergeForInbox(log);
    expect(rows.filter((r) => r.kind === 'Legacy').map((r) => formatEvent(r))).toEqual([
      'Storm passed.',
      'Docked.',
    ]);
    expect(rows.find((r) => r.kind === 'VeinFound')?.count).toBe(2);
  });
});

describe('inbox filters', () => {
  const rows = [
    ev('PiratesArrived', 5, { size: 2 }, { carrierId: 0 }),
    ev('ShipLost', 4, { cls: 'drone', cause: 'destroyed' }, { carrierId: 1 }),
    ev('VeinFound', 3, { veins: 1 }, { carrierId: 0 }),
    ev('Legacy', 2, { text: 'Docked.' }, { carrierId: 0, severity: 'info' }),
    ev('WelcomeBack', 1, { credits: 10, seconds: 60, hidden: false }, { carrierId: 1 }),
  ];

  it('filters by carrier, keeping All as the whole list', () => {
    expect(filterEvents(rows, 'all', 'all')).toHaveLength(rows.length);
    expect(filterEvents(rows, 1, 'all').map((r) => r.kind)).toEqual(['ShipLost', 'WelcomeBack']);
    expect(filterEvents(rows, 0, 'all').map((r) => r.kind)).toEqual([
      'PiratesArrived',
      'VeinFound',
      'Legacy',
    ]);
  });

  it('filters warn and up, or critical only', () => {
    expect(filterEvents(rows, 'all', 'warn+').map((r) => r.kind)).toEqual([
      'PiratesArrived',
      'ShipLost',
    ]);
    expect(filterEvents(rows, 'all', 'critical').map((r) => r.kind)).toEqual(['PiratesArrived']);
    expect(filterEvents(rows, 1, 'critical')).toEqual([]);
  });

  it('drops a carrier filter once that carrier is gone', () => {
    expect(activeCarrier('all', [0])).toBe('all');
    expect(activeCarrier(1, [0, 1])).toBe(1);
    expect(activeCarrier(4, [0, 1])).toBe('all');
  });

  it('labels a carrier by its system, and by id when the name is shared or missing', () => {
    const systems = [{ name: 'Kestrel I' }, { name: 'Lumen II' }];
    expect(
      carrierChoices(
        [
          { id: 0, systemId: 0 },
          { id: 1, systemId: 1 },
        ],
        systems,
      ),
    ).toEqual([
      { id: 0, label: 'Kestrel I' },
      { id: 1, label: 'Lumen II' },
    ]);
    expect(
      carrierChoices(
        [
          { id: 2, systemId: 0 },
          { id: 3, systemId: 0 },
          { id: 4, systemId: 9 },
        ],
        systems,
      ),
    ).toEqual([
      { id: 2, label: 'Kestrel I (2)' },
      { id: 3, label: 'Kestrel I (3)' },
      { id: 4, label: 'Carrier 4' },
    ]);
  });
});
