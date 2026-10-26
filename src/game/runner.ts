import { apply, prestige, settleOffline, type OfflineReport } from '../sim/actions';
import { DT } from '../sim/config';
import { step } from '../sim/tick';
import type { GameState } from '../sim/types';
import { EventAggregator } from './events';
import { encodeFrame, type InMsg, type OutMsg } from './protocol';

const TICK_MS = DT * 1000;
const MAX_CATCHUP_TICKS = 600; // a minute of sim; longer gaps go through offline settlement
const UI_HZ = 5;
export const PUMP_MS = 25;

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
  private timer: ReturnType<typeof setInterval> | null = null;
  private events = new EventAggregator();

  constructor(
    private post: Post,
    private now: () => number = () => performance.now(),
  ) {}

  handle(msg: InMsg) {
    switch (msg.t) {
      case 'init': {
        this.adopt(msg.state);
        if (msg.settle)
          this.offline = settleOffline(msg.state, (msg.now - msg.state.savedAt) / 1000);
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
      case 'speed':
        this.speed = msg.v;
        return;
      case 'pause':
        this.paused = msg.v;
        return;
      case 'prestige':
        if (!this.state) return;
        this.adopt(prestige(this.state));
        this.sendEvents();
        this.sendState();
        this.sendFrame();
        return;
      case 'replace':
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
      this.acc = 0;
      this.dirty = true;
    }
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      step(s);
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
    this.events.reset();
  }

  /** Drain the sim's outbox, merge and rank it, and send what changed. */
  private sendEvents() {
    const s = this.state;
    if (!s || s.events.length === 0) return;
    const events = this.events.push(s.events);
    s.events.length = 0;
    this.post({ t: 'events', events });
  }

  private sendFrame() {
    if (!this.state) return;
    const { frame, transfer } = encodeFrame(this.state);
    this.post(frame, transfer);
  }

  private sendState(now = this.now()) {
    if (!this.state) return;
    this.lastUi = now;
    this.dirty = false;
    this.post({ t: 'state', state: this.state, offline: this.offline });
    this.offline = null;
  }
}
