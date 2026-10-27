// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';

const TABS = [
  ['a', 'A'],
  ['b', 'B'],
  ['c', 'C'],
] as const;

function Host() {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return <Tabs tabs={TABS} value={v} onSelect={setV} idPrefix="t" label="Test" />;
}

const press = (key: string) =>
  act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

describe('Tabs', () => {
  it('roves with arrows, wraps, and supports Home/End', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<Host />));
    const tab = (id: string) => el.querySelector<HTMLElement>(`#t-${id}`)!;
    tab('a').focus();
    expect(tab('b').tabIndex).toBe(-1);
    await press('ArrowRight');
    expect(document.activeElement).toBe(tab('b'));
    expect(tab('b').getAttribute('aria-selected')).toBe('true');
    expect(tab('b').tabIndex).toBe(0);
    await press('End');
    expect(document.activeElement).toBe(tab('c'));
    await press('ArrowRight');
    expect(document.activeElement).toBe(tab('a'));
    await press('ArrowLeft');
    expect(document.activeElement).toBe(tab('c'));
    await press('Home');
    expect(document.activeElement).toBe(tab('a'));
    await act(async () => root.unmount());
    el.remove();
  });
});
