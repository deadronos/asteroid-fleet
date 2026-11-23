// @vitest-environment happy-dom
import { Profiler, act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../game/engine';
import { apply, order } from '../sim/actions';
import { createShip } from '../sim/economy';
import { focused, newGame, unlockRule } from '../sim/state';
import { SaveNotice } from './App';
import { CarrierPanel } from './CarrierPanel';
import { DoctrinePanel } from './DoctrinePanel';
import { FleetPanel } from './FleetPanel';
import { Hud } from './Hud';
import { ResearchPanel } from './ResearchPanel';
import { RuleCards } from './RuleCards';
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
  it("counts the focused carrier's rebuild queue (#174)", async () => {
    const s = game();
    s.lifetime.admiralties = 3;
    s.credits = 1e7;
    s.researchLevels.autoRebuild = 1;
    expect(apply(s, { type: 'buyCarrier', carrierId: s.ops[0].id })).toBeNull();
    s.focusId = s.ops[0].id;
    s.ops[0].rebuildQueue.push({ cls: 'drone', hangarId: s.ops[0].hangars[0].id });
    for (let i = 0; i < 3; i++) {
      s.ops[1].rebuildQueue.push({ cls: 'drone', hangarId: s.ops[1].hangars[0].id });
    }
    const m = await mount(<FleetPanel />, s);
    cleanup = m.cleanup;
    expect(m.el.textContent).toContain('(1 queued)');
    expect(m.el.textContent).not.toContain('(3 queued)');
  });

  it("builds into the focused carrier's hangar after a carrier switch (#183)", async () => {
    const s = game();
    s.lifetime.admiralties = 3;
    s.credits = 1e7;
    expect(apply(s, { type: 'buyCarrier', carrierId: s.ops[0].id })).toBeNull();
    const dispatch = vi.spyOn(engine, 'dispatch').mockImplementation(() => {});
    const m = await mount(<FleetPanel />, s);
    cleanup = m.cleanup;
    const mine = s.ops[1].hangars.map((h) => h.id);
    expect(mine).not.toContain(s.ops[0].hangars[0].id);

    s.focusId = s.ops[1].id;
    await act(async () => engine.focusCarrier(s.ops[1].id));
    await click(m.el.querySelector<HTMLElement>('.shop button:not(:disabled)')!);
    const buy = dispatch.mock.calls.map((c) => c[0]).find((c) => c.type === 'buyShip');
    expect(buy).toBeDefined();
    expect(mine).toContain((buy as { hangarId: number }).hangarId);
  });

  it('shows the bargeBay drone repair bonus on the board (#250)', async () => {
    const s = game();
    const op = focused(s);
    op.researchLevels.bargeBay = 1;
    const h = op.hangars[1];
    createShip(op, 'barge', h.id, 0);
    const drone = createShip(op, 'drone', h.id, 4)!;
    const m = await mount(<FleetPanel />, s);
    cleanup = m.cleanup;
    const tile = [...m.el.querySelectorAll<HTMLElement>('.ship-tile')].find((el) =>
      el.getAttribute('aria-label')?.includes(`#${drone.id}`),
    )!;
    expect(tile.title).toContain('2×');
  });

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

async function setupFleetBoard() {
  const s = game(3);
  const dispatch = vi.spyOn(engine, 'dispatch').mockImplementation(() => {});
  const m = await mount(<FleetPanel />, s);
  cleanup = m.cleanup;
  const board = [...m.el.querySelectorAll<HTMLElement>('[aria-label*=" board"]')].find((b) =>
    b.querySelector('.ship-tile'),
  )!;
  const tile = board.querySelector<HTMLElement>('.ship-tile')!;
  const hangarId = Number(board.getAttribute('aria-label')!.match(/Hangar (\d+)/)![1]);
  const shipId = Number(tile.getAttribute('aria-label')!.match(/#(\d+)/)![1]);
  return { board, tile, hangarId, shipId, dispatch };
}

const pressKey = (el: HTMLElement, k: string) =>
  act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

describe('touch and keyboard ship movement (#248)', () => {
  it('selects a ship by tap and moves it to a highlighted empty slot', async () => {
    const { board, tile, hangarId, shipId, dispatch } = await setupFleetBoard();
    await click(tile);
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    const slot = board.querySelector<HTMLElement>('.slot.valid')!;
    expect(slot).not.toBeNull();
    const start = Number(slot.getAttribute('aria-label')!.match(/slot (\d+)/)![1]) - 1;
    await click(slot);
    expect(dispatch).toHaveBeenCalledWith({ type: 'moveShip', shipId, hangarId, start });
  });

  it('supports Enter/Space to move and Escape to cancel', async () => {
    const { board, tile, hangarId, shipId, dispatch } = await setupFleetBoard();
    await pressKey(tile, 'Enter');
    expect(board.querySelectorAll('.slot.valid').length).toBeGreaterThan(0);
    const slot = board.querySelector<HTMLElement>('.slot.valid')!;
    const start = Number(slot.getAttribute('aria-label')!.match(/slot (\d+)/)![1]) - 1;
    await pressKey(slot, ' ');
    expect(dispatch).toHaveBeenCalledWith({ type: 'moveShip', shipId, hangarId, start });

    dispatch.mockClear();
    await click(tile);
    await pressKey(tile, 'Escape');
    expect(board.querySelectorAll('.slot.valid').length).toBe(0);
    expect(dispatch.mock.calls.some(([c]) => c.type === 'moveShip')).toBe(false);
  });
  it('allows a multi-slot ship to shift into an adjacent slot overlapping itself', async () => {
    const s = game(3);
    const v = focused(s);
    v.credits = 50_000;
    v.hangars[0].slots = 6;
    v.hangars[0].items = [];
    v.ships = [];
    expect(order(v, { type: 'buyShip', cls: 'barge', hangarId: v.hangars[0].id })).toBeNull();
    const bargeId = v.ships[0].id;
    // Place the 4-slot barge at slots 1..4 so slot 0 is the only empty slot to its left.
    v.hangars[0].items[0].start = 1;
    const dispatch = vi.spyOn(engine, 'dispatch').mockImplementation(() => {});
    const m = await mount(<FleetPanel />, s);
    cleanup = m.cleanup;
    const tile = m.el.querySelector<HTMLElement>('.ship-tile')!;
    await click(tile);
    const slot = m.el.querySelector<HTMLElement>('.slot.valid')!;
    expect(slot).not.toBeNull();
    expect(slot.getAttribute('aria-label')).toContain('slot 1');
    await click(slot);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'moveShip',
      shipId: bargeId,
      hangarId: v.hangars[0].id,
      start: 0,
    });
  });
});

describe('live rule card status (#246)', () => {
  it('shows a ship count on a firing ship-scoped card and filters by action classes', async () => {
    const s = game(3);
    const v = focused(s);
    v.credits = 10_000;
    expect(order(v, { type: 'buyShip', cls: 'hauler', hangarId: 1 })).toBeNull();
    // Fleet-scoped barge-only action (`callHauler`) must not count drones or haulers when no barge exists.
    v.cards.push({
      id: 99,
      enabled: true,
      scope: { kind: 'fleet' },
      when: [{ kind: 'always' }],
      then: { kind: 'callHauler' },
    });
    const m = await mount(<RuleCards />, s);
    cleanup = m.cleanup;
    const live = [...m.el.querySelectorAll('.card-live')].map((e) => e.textContent ?? '');
    expect(live.some((text) => /1 ship\b/.test(text))).toBe(true);
    expect(m.el.querySelector('[data-card="99"] .card-live')).toBeNull();
  });

  it('shows a plain active badge on a firing carrier-scoped card', async () => {
    const s = game(3);
    const v = focused(s);
    unlockRule(v, 'reserveWarpEnergy');
    v.cards.find((c) => c.preset === 'reserveWarpEnergy')!.enabled = true;
    const m = await mount(<RuleCards />, s);
    cleanup = m.cleanup;
    const live = [...m.el.querySelectorAll('.card-live')].map((e) => e.textContent ?? '');
    expect(live.some((text) => text.includes('active') && !text.includes('ship'))).toBe(true);
  });
});

describe('progressive research disclosure (#247)', () => {
  it('hides late layers and locked class branches on a fresh run', async () => {
    const m = await mount(<ResearchPanel />, game(3));
    cleanup = m.cleanup;
    expect(m.el.textContent).toContain('Research points available');
    for (const label of ['Admiralty Marks', 'Challenge runs', 'Admiralty shop', 'Buy carrier'])
      expect(m.el.textContent).not.toContain(label);
    const branches = [...m.el.querySelectorAll('.branch h3')].map((h) => h.textContent ?? '');
    expect(branches.some((b) => b.startsWith('Fighter'))).toBe(false);
    expect(branches.some((b) => b.startsWith('Repair drone'))).toBe(false);
  });

  it('reveals late layers after a prestige and class branches once unlocked', async () => {
    const s = game(3);
    s.lifetime.prestiges = 1;
    focused(s).unlocked.push('fighter');
    const m = await mount(<ResearchPanel />, s);
    cleanup = m.cleanup;
    for (const label of ['Admiralty Marks', 'Challenge runs', 'Admiralty shop', 'Buy carrier'])
      expect(m.el.textContent).toContain(label);
    const branches = [...m.el.querySelectorAll('.branch h3')].map((h) => h.textContent ?? '');
    expect(branches.some((b) => b.startsWith('Fighter'))).toBe(true);
  });

  it('reveals carrier buying for an imported multi-carrier save', async () => {
    const s = game(3);
    s.lifetime.admiralties = 3;
    const m = await mount(<ResearchPanel />, s);
    cleanup = m.cleanup;
    expect(m.el.textContent).toContain('Buy carrier');
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

describe('scoped panel selectors (#240)', () => {
  const cases: {
    name: string;
    ui: () => React.ReactElement;
    relevant: (s: ReturnType<typeof game>) => void;
  }[] = [
    {
      name: 'FleetPanel',
      ui: () => <FleetPanel />,
      relevant: (s) => {
        focused(s).ships[0].mode = 'mining';
      },
    },
    {
      name: 'CarrierPanel',
      ui: () => <CarrierPanel />,
      relevant: (s) => {
        focused(s).powerMode = 'defense';
      },
    },
    {
      name: 'DoctrinePanel',
      ui: () => <DoctrinePanel />,
      relevant: (s) => {
        focused(s).doctrine.fleet.mining = 'greedy';
      },
    },
    {
      name: 'RuleCards',
      ui: () => <RuleCards />,
      relevant: (s) => {
        unlockRule(focused(s), 'fightersEscortOnWave');
      },
    },
    {
      name: 'ResearchPanel',
      ui: () => <ResearchPanel />,
      relevant: (s) => {
        s.research += 5;
      },
    },
    {
      name: 'StarMap',
      ui: () => <StarMap onClose={() => {}} />,
      relevant: (s) => {
        focused(s).systems.find((x) => !x.discovered)!.discovered = true;
      },
    },
    {
      name: 'SaveNotice',
      ui: () => <SaveNotice />,
      relevant: () => {
        engine.saveNotice = 'Corrupt save';
      },
    },
  ];

  it.each(cases)('$name skips unrelated ticks and updates on relevant changes', async (c) => {
    const s = game(5);
    engine.saveNotice = null;
    let renders = 0;
    const m = await mount(
      <Profiler
        id={c.name}
        onRender={() => {
          renders++;
        }}
      >
        {c.ui()}
      </Profiler>,
      s,
    );
    cleanup = async () => {
      engine.saveNotice = null;
      await m.cleanup();
    };
    const baseline = renders;
    // Unrelated 5 Hz tick: time/energy/asteroid/small credit ticks must not re-render panels.
    await act(async () => {
      const f = focused(s);
      f.time += 0.2;
      f.carrier.energy += 1;
      f.ships[0].pos.x += 5;
      engine.emit();
    });
    expect(renders).toBe(baseline);

    await act(async () => {
      c.relevant(s);
      engine.emit();
    });
    expect(renders).toBeGreaterThan(baseline);
  });
});
