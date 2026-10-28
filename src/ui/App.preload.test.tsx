// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('secondary chunk preload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('schedules the idle preload with a timeout so a busy main thread cannot starve it', async () => {
    const ric = vi.fn<(cb: () => void, opts?: { timeout: number }) => number>(() => 0);
    vi.stubGlobal('requestIdleCallback', ric);
    vi.resetModules();
    await import('./App');
    expect(ric).toHaveBeenCalledOnce();
    expect(ric.mock.calls[0][1]).toEqual({ timeout: 2000 });
  });
});
