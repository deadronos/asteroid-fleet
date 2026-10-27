import { describe, expect, it } from 'vitest';
import { SEVERITY } from '../sim/state';
import type { AlertRules, SimEvent, SimEventKind } from '../sim/types';
import { ToastQueue, alertActions, offerToasts, resolveAlert, wantsToast } from './toasts';

function ev(kind: SimEventKind, carrierId = 0): SimEvent {
  return {
    kind,
    carrierId,
    systemId: 0,
    severity: SEVERITY[kind],
    t: 0,
    count: 1,
    data: kind === 'Warped' ? { system: 'X' } : {},
  } as SimEvent;
}

const rules = (r: Partial<AlertRules>): AlertRules => ({ fleet: {}, byCarrier: {}, ...r });

describe('alert rules (#79)', () => {
  it('prefers the carrier override over the fleet rule', () => {
    const r = rules({ fleet: { Warped: 'off' }, byCarrier: { 1: { Warped: 'toast' } } });
    expect(resolveAlert(r, 'Warped', 1)).toBe('toast');
    expect(resolveAlert(r, 'Warped', 0)).toBe('off');
    expect(resolveAlert(r, 'StormPassed', 0)).toBeNull();
  });

  it('lets a rule override the built-in policy, critical included', () => {
    expect(wantsToast(ev('Warped'), 0)).toBe(true);
    expect(wantsToast(ev('Warped'), 0, rules({ fleet: { Warped: 'inbox' } }))).toBe(false);
    expect(wantsToast(ev('EmergencyJump'), 0)).toBe(true);
    expect(wantsToast(ev('EmergencyJump'), 0, rules({ fleet: { EmergencyJump: 'off' } }))).toBe(
      false,
    );
    expect(wantsToast(ev('WaveRepelled'), 0, rules({ fleet: { WaveRepelled: 'toast' } }))).toBe(
      true,
    );
  });

  it('applies a carrier rule only to that carrier', () => {
    const r = rules({ byCarrier: { 1: { WaveRepelled: 'toast' } } });
    expect(wantsToast(ev('WaveRepelled', 1), 0, r)).toBe(true);
    expect(wantsToast(ev('WaveRepelled', 0), 0, r)).toBe(false);
  });

  it('offers toasts through the rules', () => {
    const q = new ToastQueue(() => 0);
    const r = rules({ fleet: { WaveRepelled: 'pause' } });
    expect(offerToasts(q, [{ ...ev('WaveRepelled'), id: 1 }], 0, r)).toBe(true);
    expect(q.shown()).toHaveLength(1);
  });

  it('pauses and focuses once per event id', () => {
    const r = rules({ fleet: { Warped: 'focus', WaveRepelled: 'pause' } });
    const seen = new Set<number>();
    const batch = [
      { ...ev('Warped', 2), id: 1 },
      { ...ev('WaveRepelled'), id: 2 },
    ];
    expect(alertActions(batch, r, seen)).toEqual({ pause: true, focus: 2 });
    expect(alertActions(batch, r, seen)).toEqual({ pause: false, focus: null });
    expect(alertActions([{ ...ev('StormPassed'), id: 3 }], r, seen).pause).toBe(false);
  });
});
