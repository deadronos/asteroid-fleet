// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../game/engine';
import { focused, newGame } from '../sim/state';
import { CarrierPanel } from './CarrierPanel';
import { FleetPanel } from './FleetPanel';
import { Hud } from './Hud';
import { StarMap } from './StarMap';
import { click, mount } from './testUtils';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

const game = (seed = 3) => newGame(seed);

describe('Hud', () => {
  const props = { tactical: false, autoTactical: false, quality: 'high' as const };

  it('wires pause, speed, map, tactical and quality buttons', async () => {
    const pause = vi.spyOn(engine, 'togglePause').mockImplementation(() => {});
    const speed = vi.spyOn(engine, 'setSpeed').mockImplementation(() => {});
    const onTactical = vi.fn<() => void>();
    const onQuality = vi.fn<() => void>();
    const onMap = vi.fn<() => void>();
    const onMapIntent = vi.fn<() => void>();
    const m = await mount(
      <Hud
        {...props}
        onTactical={onTactical}
        onQuality={onQuality}
        onMap={onMap}
        onMapIntent={onMapIntent}
      />,
      game(),
    );
    cleanup = m.cleanup;
    await click(m.el.querySelector<HTMLElement>('[title="Pause (Space)"]')!);
    expect(pause.mock.calls).toHaveLength(1);
    const fast = m.el.querySelector<HTMLElement>('[title^="4× speed"]')!;
    await click(fast);
    expect(speed.mock.calls).toEqual([[4]]);
    await click(m.el.querySelector<HTMLElement>('[title^="Star map"]')!);
    expect(onMap).toHaveBeenCalledOnce();
    const mapBtn = m.el.querySelector<HTMLElement>('[title^="Star map"]')!;
    await act(async () => {
      mapBtn.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      mapBtn.focus();
    });
    expect(onMapIntent).toHaveBeenCalled();
    await click(m.el.querySelector<HTMLElement>('[title^="Tactical sensor"]')!);
    expect(onTactical).toHaveBeenCalledOnce();
    await click(m.el.querySelector<HTMLElement>('[title^="Low quality"]')!);
    expect(onQuality).toHaveBeenCalledOnce();
  });

  it('shows the credits on the state it is given', async () => {
    const s = game();
    focused(s).credits = 1234;
    const m = await mount(
      <Hud {...props} onTactical={() => {}} onQuality={() => {}} onMap={() => {}} />,
      s,
    );
    cleanup = m.cleanup;
    expect(m.el.querySelector('.hud')?.textContent).toContain('Credits');
    expect(m.el.querySelector('.hud .chip .v')?.textContent).toMatch(/^1[.,\s]?234$/);
  });
});

describe('FleetPanel', () => {
  it('hides Scrap for a drone carried in a barge (#181)', async () => {
    const s = game();
    for (const ship of focused(s).ships) ship.mode = 'carried';
    const m = await mount(<FleetPanel />, s);
    cleanup = m.cleanup;
    await click(m.el.querySelector<HTMLElement>('.ship-tile')!);
    expect(m.button(/Scrap/)).toBeUndefined();
  });

  it('disables +slot and hangar purchases when short of credits, and buys a slot when rich', async () => {
    const poor = game();
    focused(poor).credits = 0;
    let m = await mount(<FleetPanel />, poor);
    cleanup = m.cleanup;
    expect(m.button(/\+slot/)!.disabled).toBe(true);
    const buys = [...m.el.querySelectorAll<HTMLButtonElement>('.row button')].filter(
      (b) => b.title.length > 0 || b.disabled,
    );
    expect(buys.length).toBeGreaterThan(0);
    expect(buys.every((b) => b.disabled)).toBe(true);
    await m.cleanup();
    cleanup = null;

    const rich = game();
    focused(rich).credits = 1_000_000;
    const dispatch = vi.spyOn(engine, 'dispatch').mockImplementation(() => {});
    m = await mount(<FleetPanel />, rich);
    cleanup = m.cleanup;
    const slot = m.button(/\+slot/)!;
    expect(slot.disabled).toBe(false);
    await click(slot);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'buySlot',
      hangarId: focused(rich).hangars[0].id,
    });
  });

  // #152: a worker snapshot rebuilds `hangars` as fresh objects. Buying a slot or a ship leaves
  // FleetPanel's own selection unchanged, so the boards must not hold on to the old objects.
  it('redraws a hangar board when a snapshot brings new hangar objects', async () => {
    const s = game();
    const op = focused(s);
    const h0 = op.hangars[0];
    const m = await mount(<FleetPanel />, s);
    cleanup = m.cleanup;
    const board = () => m.el.querySelector(`[aria-label^="Hangar ${h0.id} board"]`)!;
    const usedBefore = board().querySelectorAll('.ship-tile').length;
    const slotsBefore = h0.slots;
    expect(m.el.textContent).toContain(`${usedBefore}/${slotsBefore}`);

    // Mirror a snapshot after a buySlot + buyShip(drone): new hangar objects, same ids.
    const drone = op.ships.find((x) => x.cls === 'drone')!;
    const extra = { ...drone, id: 9999 };
    const free = slotsBefore; // the bought slot
    const hangars = structuredClone(s.ops[0].hangars);
    hangars[0].slots++;
    hangars[0].items.push({ shipId: extra.id, start: free });
    s.ops[0] = { ...s.ops[0], ships: [...s.ops[0].ships, extra], hangars };
    await act(async () => engine.emit());

    expect(m.el.textContent).toContain(`${usedBefore + 1}/${slotsBefore + 1}`);
    expect(board().querySelectorAll('.ship-tile').length).toBe(usedBefore + 1);
  });
});

describe('CarrierPanel', () => {
  it('gives a reason on every disabled warp button', async () => {
    const s = game(7);
    const m = await mount(<CarrierPanel />, s);
    cleanup = m.cleanup;
    const warps = [...m.el.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      (b.textContent ?? '').startsWith('Warp ·'),
    );
    expect(warps.length).toBeGreaterThan(0);
    const blocked = warps.filter((b) => b.disabled);
    expect(blocked.length).toBeGreaterThan(0);
    for (const b of blocked) expect(b.title.length).toBeGreaterThan(0);
    expect(blocked.some((b) => b.title === 'Not discovered yet')).toBe(true);
  });

  it('dispatches a warp for an enabled button', async () => {
    const s = game(7);
    const v = focused(s);
    v.systems[1].discovered = true;
    v.carrier.energy = 1e6;
    const dispatch = vi.spyOn(engine, 'dispatch').mockImplementation(() => {});
    const m = await mount(<CarrierPanel />, s);
    cleanup = m.cleanup;
    const btn = [...m.el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').startsWith('Warp ·') && !b.disabled,
    );
    expect(btn).toBeDefined();
    await click(btn!);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'warp' });
  });
});

describe('StarMap', () => {
  it('opens as a dialog and closes on Escape', async () => {
    const onClose = vi.fn<() => void>();
    const m = await mount(<StarMap onClose={onClose} />, game());
    cleanup = m.cleanup;
    expect(m.el.ownerDocument.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Star map');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
