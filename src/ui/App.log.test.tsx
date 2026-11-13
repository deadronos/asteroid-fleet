// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { engine } from '../game/engine';
import { newGame } from '../sim/state';
import { LogPanel } from './LogPanel';
import type { CarrierFilter, SeverityFilter } from './inbox';

function Host({
  carrier,
  severity = 'all',
}: {
  carrier: CarrierFilter;
  severity?: SeverityFilter;
}) {
  const [current, setCurrent] = useState(carrier);
  const [sev, setSev] = useState<SeverityFilter>(severity);
  return <LogPanel carrier={current} onCarrier={setCurrent} severity={sev} onSeverity={setSev} />;
}

describe('LogPanel carrier filter', () => {
  it('logs no React warning when the selected carrier is gone', async () => {
    const previous = engine.state;
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    engine.state = newGame(1);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    try {
      await act(async () => {
        root.render(<Host carrier={4} />);
      });
      const select = el.querySelector('select[aria-label="Carrier"]');
      expect(select).toBeInstanceOf(HTMLSelectElement);
      expect((select as HTMLSelectElement).value).toBe('all');
      expect(errors.join('\n')).not.toMatch(/Cannot update a component/);
    } finally {
      await act(async () => {
        root.unmount();
      });
      el.remove();
      engine.state = previous;
      spy.mockRestore();
    }
  });
});
