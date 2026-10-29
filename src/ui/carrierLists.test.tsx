// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { engine } from '../game/engine';
import { encodeSnapshot } from '../game/snapshot';
import { apply } from '../sim/actions';
import { newGame } from '../sim/state';
import type { GameState } from '../sim/types';
import { LogPanel } from './App';
import { DoctrinePanel } from './DoctrinePanel';
import type { CarrierFilter, SeverityFilter } from './inbox';
import { RuleCards } from './RuleCards';
import { click, mount } from './testUtils';

let cleanup: (() => Promise<void>) | null = null;
let carriers = engine.carriers;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  engine.carriers = carriers;
});

/** Two carriers on the worker side; the mirror, as after a snapshot, holds only the focused one. */
function mirrorOfTwo(): { mirror: GameState; other: number; otherHangar: number } {
  const s = newGame(3);
  s.lifetime.admiralties = 3;
  s.credits = 1e7;
  expect(apply(s, { type: 'buyCarrier', carrierId: s.ops[0].id })).toBeNull();
  const other = s.ops[1];
  engine.carriers = encodeSnapshot(s, false).snap.carriers;
  const mirror = { ...s, ops: [s.ops[0]], focusId: s.ops[0].id } as GameState;
  return { mirror, other: other.id, otherHangar: other.hangars[0].id };
}

function Log() {
  const [carrier, setCarrier] = useState<CarrierFilter>('all');
  const [sev, setSev] = useState<SeverityFilter>('all');
  return <LogPanel carrier={carrier} onCarrier={setCarrier} severity={sev} onSeverity={setSev} />;
}

const optionValues = (sel: Element | null) =>
  [...(sel?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));

describe('carrier lists in a mirror holding only the focused operation (#178)', () => {
  it('offers every carrier in the log filter', async () => {
    const { mirror, other } = mirrorOfTwo();
    const m = await mount(<Log />, mirror);
    cleanup = m.cleanup;
    expect(optionValues(m.el.querySelector('select[aria-label="Carrier"]'))).toContain(
      String(other),
    );
  });

  it('offers every carrier in the alert scope picker', async () => {
    const { mirror, other } = mirrorOfTwo();
    const m = await mount(<DoctrinePanel />, mirror);
    cleanup = m.cleanup;
    expect(optionValues(m.el.querySelector('select[aria-label="Alert scope"]'))).toContain(
      String(other),
    );
  });

  it("lists another carrier's hangars in the rule-card scope", async () => {
    const { mirror, otherHangar } = mirrorOfTwo();
    const m = await mount(<RuleCards />, mirror);
    cleanup = m.cleanup;
    await click(m.button(/New card/)!);
    const scope = m.el.querySelector('.card-edit select');
    expect(optionValues(scope)).toContain(JSON.stringify({ kind: 'hangar', id: otherHangar }));
  });
});
