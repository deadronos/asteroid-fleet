import { describe, expect, it } from 'vitest';
import { SEVERITY } from '../sim/state';
import type { SimEvent } from '../sim/types';
import { formatEvent, toneClass } from './events';

const base = { carrierId: 0, systemId: 0, t: 0, count: 1 };

describe('event text', () => {
  it('reads like the old log lines', () => {
    const lost = {
      ...base,
      kind: 'ShipLost',
      severity: SEVERITY.ShipLost,
      data: { cls: 'drone', cause: 'leftBehind' },
    } as SimEvent;
    expect(formatEvent(lost)).toBe('Mining drone lost (outside at jump time).');
    expect(formatEvent({ ...lost, count: 3 })).toMatch(/^3 ships lost/);
    const veins = { ...base, kind: 'VeinFound', severity: 'good', data: { veins: 2 } } as SimEvent;
    expect(formatEvent(veins)).toBe('Scout found 2 rich veins.');
    const legacy = {
      ...base,
      kind: 'Legacy',
      severity: 'info',
      data: { text: 'Docked.' },
    } as SimEvent;
    expect(formatEvent(legacy)).toBe('Docked.');
  });

  it('maps critical to the red tone', () => {
    expect(toneClass('critical')).toBe('tone-bad');
    expect(toneClass('warn')).toBe('tone-warn');
  });
});
