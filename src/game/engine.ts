import { useSyncExternalStore } from 'react';
import type { OfflineReport, Order } from '../sim/actions';
import { focused, focusOp, newGame } from '../sim/state';
import type { GameState, Pirate, Ship, Sim, Vec3 } from '../sim/types';
import type { BusEvent } from './events';
import { createSimHost, type SimHost } from './host';
import { MODES, PUMP_MS, type Frame, type OutMsg } from './protocol';
import { applySnapshot } from './snapshot';
import { allowSaveOverwrite, loadGame, saveGame, saveOverwriteBlocked } from './save';
import { getActiveSlot, writeSlot } from './slots';
import { offerToasts, ToastQueue } from './toasts';

const AUTOSAVE_MS = 15000;

/**
 * Main-thread side of the game. The sim runs in a worker (see `runner.ts`); this class
 * keeps a mirror of its state for React and the renderer. A packed snapshot of the whole state
 * arrives a few times per second (see `UiSnapshot`); positions, modes and effects arrive after
 * every sim pump as typed arrays.
 * The renderer interpolates between the last two pumps.
 */
class Engine {
  state: GameState = newGame();
  prev = new Map<number, Vec3>();
  prevCarrier: Vec3 = { x: 0, y: 0, z: 0 };
  speed = 1;
  paused = false;
  offline: OfflineReport | null = null;
  /**
   * Toast queue (newest on top, a few visible). Expiry is time-based; the queue keeps
   * a single timer and clears it when the next deadline changes.
   * The clock is the wall clock, not sim time, so toasts expire while the game is paused.
   */
  readonly toasts = new ToastQueue(
    () => Date.now(),
    () => this.emit(),
  );
  /**
   * Run generation. `replace` (reset or import) bumps it. Event batches from the
   * worker carry the epoch they were sent in; an older one is ignored, so a message
   * already in flight cannot toast the previous run.
   */
  epoch = 0;
  /**
   * Carrier the player asked to look at (toast Go to). The mirror still follows
   * `focusOp` until carrier switching (#77) posts this id to the worker.
   */
  focusedCarrierId = 0;
  /** Recent events from the sim, newest first; a merged event replaces its earlier copy. */
  events: BusEvent[] = [];
  /** Shown when the stored save could not be loaded. Autosave stays off. */
  saveNotice: string | null = null;
  /** The notice is up because the backup write itself failed. */
  saveBackupFailed = false;
  loaded = false;

  private host: SimHost | null = null;
  /** Pending while `init` loads the save; the sim host does not exist yet. */
  private starting: Promise<void> | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private ships = new Map<number, Ship>();
  private pirates = new Map<number, Pirate>();
  private lastFrameAt = performance.now();
  private frameGap = PUMP_MS;
  private nextReq = 1;
  private requests = new Map<number, (s: GameState) => void>();
  private ready: (() => void) | null = null;
  private writeFailures = new Set<string>();

  async init(preferWorker = true) {
    let started: (() => void) | undefined;
    this.starting = new Promise((r) => (started = r));
    const saved = await loadGame();
    let state = newGame();
    let settle = false;
    if (saved.ok) {
      state = saved.state;
      settle = true;
    } else if (saved.reason !== 'empty') {
      this.saveNotice = saved.notice;
      this.saveBackupFailed = !saved.backedUp;
    }
    this.host = createSimHost((msg) => this.onSimMessage(msg), preferWorker);
    started?.();
    const first = new Promise<void>((r) => (this.ready = r));
    this.host.post({ t: 'init', state, now: Date.now(), settle, epoch: this.epoch });
    await first;
    this.loaded = true;
    setInterval(() => void this.save(), AUTOSAVE_MS);
    // The page may be frozen or gone before the worker could answer, so these write the mirror.
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveMirror();
    });
    window.addEventListener('beforeunload', () => this.saveMirror());
    this.emit();
  }

  /** The focused operation bound to the run-wide state; what the UI reads. */
  get view(): Sim {
    return focused(this.state);
  }

  get simKind(): SimHost['kind'] | null {
    return this.host?.kind ?? null;
  }

  /** Sim-host callback. An events batch from another epoch is ignored in `receive`. */
  onSimMessage(msg: OutMsg) {
    this.receive(msg);
  }

  /**
   * Where the critical-overflow toast sends the player, or null for any other key.
   * The Log tab should show every carrier, filtered to critical.
   */
  openToastInbox(key: string | null): { carrier: 'all'; severity: 'critical' } | null {
    const action = this.toasts.inboxAction(key);
    if (action?.type !== 'open-inbox') return null;
    return { carrier: 'all', severity: action.severity };
  }

  private receive(msg: OutMsg) {
    switch (msg.t) {
      case 'state':
        this.adopt(applySnapshot(this.state, msg.snap));
        if (msg.offline) this.offline = msg.offline;
        if (this.ready) {
          this.ready();
          this.ready = null;
        }
        this.emit();
        return;
      case 'frame':
        this.applyFrame(msg);
        return;
      case 'events': {
        // `onSimMessage` forwards every batch; a different run epoch stops here.
        if (msg.epoch !== this.epoch) return;
        const ids = new Set(msg.events.map((e) => e.id));
        this.events = [...msg.events, ...this.events.filter((e) => !ids.has(e.id))].slice(0, 50);
        if (offerToasts(this.toasts, msg.events, this.focusedCarrierId)) this.emit();
        return;
      }
      case 'error':
        this.toasts.push({ text: msg.text, severity: 'warn', carrierId: null });
        this.emit();
        return;
      case 'snapshot': {
        const done = this.requests.get(msg.id);
        this.requests.delete(msg.id);
        done?.(msg.state);
        return;
      }
    }
  }

  /** A new state replaces the mirror. Positions keep coming from frames in between. */
  private adopt(state: GameState) {
    const first = this.ships.size === 0 && this.pirates.size === 0;
    this.state = state;
    if (!state.ops.some((op) => op.id === this.focusedCarrierId))
      this.focusedCarrierId = focusOp(state).id;
    this.ships.clear();
    this.pirates.clear();
    const op = focusOp(state);
    for (const sh of op.ships) this.ships.set(sh.id, sh);
    for (const p of op.pirates) this.pirates.set(p.id, p);
    if (first) this.snapshot();
  }

  private snapshot() {
    this.prev.clear();
    const op = focusOp(this.state);
    for (const s of op.ships) this.prev.set(s.id, { ...s.pos });
    for (const p of op.pirates) this.prev.set(p.id, { ...p.pos });
    this.prevCarrier = { ...op.carrier.pos };
  }

  private keepPrev(id: number, pos: Vec3) {
    const p = this.prev.get(id);
    if (p) {
      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;
    } else this.prev.set(id, { ...pos });
  }

  private applyFrame(f: Frame) {
    const s = focusOp(this.state);
    const ships: Ship[] = [];
    const pirates: Pirate[] = [];
    const n = f.ids.length;
    for (let i = 0; i < n; i++) {
      const id = f.ids[i];
      const e = i < f.nShips ? this.ships.get(id) : this.pirates.get(id);
      // Not in the mirror yet: it shows up with the next full state.
      if (!e) continue;
      this.keepPrev(id, e.pos);
      e.pos.x = f.pos[i * 3];
      e.pos.y = f.pos[i * 3 + 1];
      e.pos.z = f.pos[i * 3 + 2];
      e.targetId = f.targets[i];
      if (i < f.nShips) {
        const sh = e as Ship;
        sh.mode = MODES[f.modes[i]];
        ships.push(sh);
      } else pirates.push(e as Pirate);
    }
    if (this.prev.size > 4 * n + 64) {
      const live = new Set(f.ids);
      for (const id of this.prev.keys()) if (!live.has(id)) this.prev.delete(id);
    }
    s.ships = ships;
    s.pirates = pirates;
    this.prevCarrier = { ...s.carrier.pos };
    s.carrier = f.carrier;
    s.warp = f.warp;
    s.fx = f.fx;
    const now = performance.now();
    const gap = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (gap < 200) this.frameGap += (gap - this.frameGap) * 0.2;
  }

  /** 0..1 progress between the previous and current frame, for interpolation. */
  alpha(): number {
    if (this.paused) return 1;
    const a = (performance.now() - this.lastFrameAt) / Math.max(1, this.frameGap);
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /**
   * Point the UI at a carrier. With one carrier this only records the id; #77 will
   * send it to the worker and switch the mirror. Unknown ids are ignored.
   */
  focusCarrier(carrierId: number) {
    if (!this.state.ops.some((op) => op.id === carrierId)) return;
    this.focusedCarrierId = carrierId;
  }

  /** Drop a toast. The next one waiting takes the free slot. */
  dismissToast(key: string | null) {
    this.toasts.dismiss(key);
    this.emit();
  }

  /** Focus the toast's carrier through `focusCarrier` and close it. */
  goToToast(key: string | null) {
    const carrierId = this.toasts.goTo(key);
    if (carrierId !== null) this.focusCarrier(carrierId);
    this.emit();
  }

  /** An order for the focused carrier. Errors come back from the sim as a toast. */
  dispatch(order: Order) {
    this.host?.post({ t: 'cmd', cmd: { ...order, carrierId: focusOp(this.state).id } });
  }

  /** The sim's current state, exact (unlike the mirror, which is up to one UI tick behind). */
  async fullState(): Promise<GameState> {
    // Before the save is loaded, `state` is a placeholder new game, not the sim's state.
    await this.starting;
    const host = this.host;
    if (!host) return this.state;
    const id = this.nextReq++;
    return new Promise((resolve) => {
      this.requests.set(id, resolve);
      host.post({ t: 'snapshot', id });
    });
  }

  doPrestige() {
    this.host?.post({ t: 'prestige' });
    void this.save();
  }

  replace(state: GameState) {
    this.epoch += 1;
    this.toasts.clear();
    this.events = [];
    this.saveNotice = null;
    this.saveBackupFailed = false;
    allowSaveOverwrite();
    this.state = state;
    this.adopt(state);
    this.snapshot();
    this.host?.post({ t: 'replace', state, epoch: this.epoch });
    void this.write(state);
    this.emit();
  }

  reset() {
    this.replace(newGame(Math.floor(Math.random() * 1e9)));
  }

  setSpeed(v: number) {
    this.speed = v;
    this.host?.post({ t: 'speed', v });
    this.emit();
  }

  togglePause() {
    this.paused = !this.paused;
    this.host?.post({ t: 'pause', v: this.paused });
    this.emit();
  }

  dismissOffline() {
    this.offline = null;
    this.emit();
  }

  /** Saves the sim's exact state. False when autosave is blocked by an unreadable save. */
  /**
   * Saves the sim's exact state. Resolves once the write has landed, true if storage kept it;
   * false when it did not, or when autosave is blocked by an unreadable save.
   */
  async save(): Promise<boolean> {
    if (saveOverwriteBlocked()) return false;
    return this.write(await this.fullState());
  }

  private saveMirror() {
    if (!saveOverwriteBlocked()) void this.write(this.state);
  }

  private async write(state: GameState): Promise<boolean> {
    if (saveOverwriteBlocked()) return false;
    state.savedAt = Date.now();
    const slot = getActiveSlot();
    if (slot !== null)
      this.reportWrite(
        writeSlot(slot, state),
        `Could not write save slot ${slot}: browser storage may be full. Export your save.`,
      );
    const ok = await saveGame(state);
    this.reportWrite(ok, 'Autosave failed: storage is unavailable.');
    return ok;
  }

  /** Toast a failed write once, not on every autosave, until a write succeeds again. */
  private reportWrite(ok: boolean, text: string) {
    if (ok) {
      this.writeFailures.delete(text);
      return;
    }
    if (this.writeFailures.has(text)) return;
    this.writeFailures.add(text);
    this.toasts.push({ text, severity: 'warn', carrierId: null });
    this.emit();
  }

  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;
}

export const engine = new Engine();
// Handy for debugging and balancing from the browser console.
(globalThis as unknown as { __fleet: Engine }).__fleet = engine;

/** Re-render on UI ticks; read `engine.view` directly inside the component. */
export function useGame(): Sim {
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  return engine.view;
}

export function lerpPos(id: number, cur: Vec3, a: number, out: Vec3): Vec3 {
  const p = engine.prev.get(id) ?? cur;
  out.x = p.x + (cur.x - p.x) * a;
  out.y = p.y + (cur.y - p.y) * a;
  out.z = p.z + (cur.z - p.z) * a;
  return out;
}
