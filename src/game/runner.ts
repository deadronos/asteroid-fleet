import { admiralty, apply, prestige, settleOffline, type OfflineReport } from '../sim/actions';
import { DT } from '../sim/config';
import { BG_DT, dematerialise, materialise, stepBackground } from '../sim/background';
import { bind, focusOp } from '../sim/state';
import { step, stepOp } from '../sim/tick';
import type { GameState } from '../sim/types';
import { EventAggregator } from './events';
import { PUMP_MS, encodeFrame, type InMsg, type OutMsg } from './protocol';
import { encodeSnapshot } from './snapshot';

const TICK_MS = DT * 1000;
const MAX_CATCHUP_TICKS = 600; // a minute of sim; longer gaps go through offline settlement
const UI_HZ = 5;

export type Post = (msg: OutMsg, transfer?: Transferable[]) => void;

/**
 * Owns the authoritative game state and the fixed-tick loop. No DOM: it runs in the
 * sim worker, or on the main thread as a fallback. All traffic goes through `handle` and `post`.
 */
export class SimRunner {
  state: GameState | null = null;
  private speed = 1;
  private paused = false;
  private acc = 0;
  private lastPump = 0;
  private lastUi = 0;
  private dirty = false;
  private offline: OfflineReport | null = null;
  /** System whose `fields` the UI last got; they only change on a jump. */
  private fieldsAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private events = new EventAggregator();
  /** Carriers in Tier A (on the map). Every other one runs `stepBackground` (Tier B). */
  private live = new Set<number>();
  private bgAcc = 0;
  /** Run generation from the last init or replace. Stamped on every events batch. */
  private epoch = 0;

  constructor(
    private post: Post,
    private now: () => number = () => performance.now(),
  ) {}

  handle(msg: InMsg) {
    switch (msg.t) {
      case 'init': {
        this.epoch = msg.epoch ?? 0;
        this.adopt(msg.state);
        if (msg.settle)
          this.offline = settleOffline(msg.state, (msg.now - msg.state.savedAt) / 1000);
        // Settlement leaves every carrier materialised.
        this.resync();
        this.sendEvents();
        this.sendState();
        this.start();
        return;
      }
      case 'cmd': {
        if (!this.state) return;
        const err = apply(this.state, msg.cmd);
        if (err) this.post({ t: 'error', text: err });
        this.sendEvents();
        this.sendState();
        return;
      }
      case 'focus':
        if (!this.state || !this.state.ops.some((op) => op.id === msg.carrierId)) return;
        this.state.focusId = msg.carrierId;
        this.retier();
        this.sendState();
        this.sendFrame();
        return;
      case 'speed':
        this.speed = msg.v;
        return;
      case 'pause':
        this.paused = msg.v;
        return;
      case 'prestige':
        if (!this.state) return;
        this.adopt(prestige(this.state, msg.hull));
        this.sendEvents();
        this.sendState();
        this.sendFrame();
        return;
      case 'admiralty':
        if (!this.state) return;
        this.adopt(admiralty(this.state));
        this.sendEvents();
        this.sendState();
        this.sendFrame();
        return;
      case 'replace':
        this.epoch = msg.epoch;
        this.adopt(msg.state);
        this.acc = 0;
        this.sendState();
        this.sendFrame();
        return;
      case 'snapshot':
        if (this.state) this.post({ t: 'snapshot', id: msg.id, state: this.state });
        return;
    }
  }

  start() {
    if (this.timer) return;
    this.lastPump = this.now();
    this.timer = setInterval(() => this.pump(), PUMP_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Restart the wall clock at `now` with no pending sim time. */
  resetClock(now = this.now()) {
    this.lastPump = now;
    this.acc = 0;
  }

  /** Advance by wall time since the last pump; public so tests can drive it. */
  pump(now = this.now()) {
    const s = this.state;
    if (!s) return;
    const elapsed = now - this.lastPump;
    this.lastPump = now;
    if (!this.paused) this.acc += elapsed * this.speed;
    if (!this.paused && elapsed > MAX_CATCHUP_TICKS * TICK_MS) {
      // Long background-tab gap: settle the real wall-clock time like offline
      // time; game speed applies to live ticks only.
      const report = settleOffline(s, elapsed / 1000);
      if (report) this.offline = report;
      this.resync();
      this.acc = 0;
      this.dirty = true;
    }
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      step(s, focusOp(s));
      this.stepOthers(s);
      this.acc -= TICK_MS;
      ticks++;
    }
    if (ticks > 0) {
      this.dirty = true;
      this.sendFrame();
    }
    this.sendEvents();
    if (this.dirty && now - this.lastUi > 1000 / UI_HZ) this.sendState(now);
  }

  /** A new state (a load, an import, a new run) starts with no open merges. */
  private adopt(state: GameState) {
    this.state = state;
    this.resync();
    this.fieldsAt = null;
    this.events.reset();
  }

  /**
   * Carriers in the viewed system run at Tier A (two may share a system, Q11 in #49);
   * the rest drop to Tier B. A carrier's map state is cleared when it leaves Tier A and
   * rebuilt when it enters, so a jump or a focus change keeps the tiers right.
   */
  private resync() {
    if (!this.state) return;
    this.live = new Set(this.state.ops.map((op) => op.id));
    this.retier();
  }

  private retier() {
    const g = this.state;
    if (!g) return;
    const here = focusOp(g).systemId;
    for (const op of g.ops) {
      const wantLive = op.systemId === here;
      const isLive = this.live.has(op.id);
      if (wantLive === isLive) continue;
      if (wantLive) {
        materialise(bind(g, op));
        this.live.add(op.id);
      } else {
        dematerialise(bind(g, op));
        this.live.delete(op.id);
      }
    }
  }

  /** The rest of one step: Tier A for carriers sharing the viewed system, Tier B for others. */
  private stepOthers(g: GameState) {
    if (g.ops.length < 2) return;
    this.retier();
    const focus = focusOp(g);
    this.bgAcc += TICK_MS / 1000;
    const bg = this.bgAcc >= BG_DT;
    if (bg) this.bgAcc -= BG_DT;
    for (const op of g.ops) {
      if (op === focus) continue;
      if (this.live.has(op.id)) stepOp(bind(g, op));
      else if (bg) stepBackground(bind(g, op), BG_DT);
    }
  }

  /** Drain the sim's outbox, merge and rank it, and send what changed. */
  private sendEvents() {
    const s = this.state;
    if (!s || s.events.length === 0) return;
    const events = this.events.push(s.events);
    s.events.length = 0;
    this.post({ t: 'events', epoch: this.epoch, events });
  }

  private sendFrame() {
    if (!this.state) return;
    const { frame, transfer } = encodeFrame(focusOp(this.state));
    this.post(frame, transfer);
  }

  private sendState(now = this.now()) {
    if (!this.state) return;
    this.lastUi = now;
    this.dirty = false;
    const s = this.state;
    const systemId = focusOp(s).systemId;
    const { snap, transfer } = encodeSnapshot(s, this.fieldsAt !== systemId);
    this.fieldsAt = systemId;
    this.post({ t: 'state', snap, offline: this.offline }, transfer);
    this.offline = null;
  }
}
