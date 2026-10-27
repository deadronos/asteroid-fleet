import type { AlertMode, AlertRules, Severity, SimEvent, SimEventKind } from '../sim/types';

/** How many toasts are on screen at once. Newer arrivals wait behind these. */
export const VISIBLE_CAP = 3;

/** How many toasts may wait for a slot. Past this, the oldest non-critical waiter is dropped. */
export const WAITING_CAP = 10;

/** Dismissed bus ids remembered so a merge in the same window does not reopen the toast. */
export const DISMISSED_CAP = 32;

/**
 * Auto-dismiss delays. Critical toasts stay until the player closes them.
 * These are wall-clock milliseconds, not sim seconds: the queue is given `Date.now`
 * by the engine, so a toast keeps expiring while the game is paused. That is
 * intentional. A toast is UI, and pausing the fleet must not pin it on screen.
 */
export const TOAST_MS = {
  info: 3000,
  good: 3000,
  warn: 6000,
} as const;

/**
 * Minimum time a toast stays up once it has a slot. A warn that waited almost
 * its whole display time must not flash for a fraction of a second when promoted.
 */
export const MIN_ON_SCREEN_MS = 1_500;

/** The overflow summary asks the UI to open the Log tab on this filter. */
export interface OpenInboxAction {
  type: 'open-inbox';
  severity: 'critical';
}

/**
 * Per-kind toast policy. Per-carrier alert rules (#79) can override this table later:
 * `inbox` is the log only, `toast` always, `focused` only for the carrier on screen,
 * `bargeOrMany` for ShipLost (a barge, or three or more ships).
 * A `critical` severity toasts even when the kind says inbox.
 */
export type ToastPolicy = 'inbox' | 'toast' | 'focused' | 'bargeOrMany';

export const TOAST_POLICY: Record<SimEventKind, ToastPolicy> = {
  CarrierOnline: 'inbox',
  ShipLost: 'bargeOrMany',
  ShipRetreating: 'inbox',
  PirateWaveIncoming: 'toast',
  PiratesArrived: 'toast',
  WaveRepelled: 'inbox',
  StormStarted: 'focused',
  StormPassed: 'inbox',
  HazardCharted: 'inbox',
  VeinFound: 'inbox',
  BargeWrecked: 'inbox',
  BargeFallback: 'inbox',
  ReserveRebuilt: 'inbox',
  ShipRebuilt: 'inbox',
  HangarInstalled: 'inbox',
  WarpCharging: 'toast',
  WarpCancelled: 'inbox',
  Warped: 'toast',
  EmergencyJump: 'toast',
  Prestiged: 'inbox',
  Admiralty: 'inbox',
  ChallengeStarted: 'inbox',
  ChallengeComplete: 'toast',
  WelcomeBack: 'toast',
  Legacy: 'inbox',
};

const SEV_RANK: Record<Severity, number> = { critical: 0, warn: 1, good: 2, info: 3 };

/** The player's rule for this event: the carrier's override, else the fleet's, else none. */
export function resolveAlert(
  rules: AlertRules | undefined,
  kind: SimEventKind,
  carrierId: number,
): AlertMode | null {
  return rules?.byCarrier[carrierId]?.[kind] ?? rules?.fleet[kind] ?? null;
}

/** True when this event should appear as a toast for the carrier the player is watching. */
export function wantsToast(ev: SimEvent, focusedCarrierId: number, rules?: AlertRules): boolean {
  const mode = resolveAlert(rules, ev.kind, ev.carrierId);
  if (mode) return mode === 'toast' || mode === 'pause' || mode === 'focus';
  if (ev.severity === 'critical') return true;
  const policy = TOAST_POLICY[ev.kind];
  switch (policy) {
    case 'toast':
      return true;
    case 'focused':
      return ev.carrierId === focusedCarrierId;
    case 'bargeOrMany':
      return ev.kind === 'ShipLost' && (ev.data.cls === 'barge' || ev.count >= 3);
    case 'inbox':
      return false;
  }
}

export interface Toast {
  key: string;
  /** Bus id, so a later merge updates this toast instead of stacking another. */
  eventId: number | null;
  /**
   * The sim event, when this toast came from the bus. The UI formats it.
   * Null for engine errors and for the critical-overflow summary, which use `text`.
   */
  event: (SimEvent & { id?: number }) | null;
  text: string;
  severity: Severity;
  /** Set for carrier-scoped events. Engine errors leave it null, so they have no Go to. */
  carrierId: number | null;
  /** System the event happened in, used to name the Go to button. Null for engine errors. */
  systemId: number | null;
  /** Wall-clock ms when it joined the queue. A merge into a waiter refreshes this. */
  arrivedAt: number;
  /**
   * Wall-clock ms when it last took a visible slot. Null while it is waiting.
   * Expiry is the later of `shownAt + MIN_ON_SCREEN_MS` and `arrivedAt` plus the
   * display time, so a promoted toast is readable and a fresh one still lasts
   * its full display time.
   */
  shownAt: number | null;
  /** Set on the sticky summary of critical toasts that did not fit in the queue. */
  action?: OpenInboxAction;
}

export interface ToastInput {
  eventId?: number | null;
  event?: (SimEvent & { id?: number }) | null;
  text?: string;
  severity: Severity;
  carrierId: number | null;
  systemId?: number | null;
}

/**
 * Plain toast queue. Expiry is a timestamp check plus one timer that asks the UI to
 * re-render; the timer is cleared whenever the deadline changes, so none are left behind.
 * Visible toasts are newest-first (index 0 is the top). A new toast takes a slot and
 * the oldest lesser one waits; a critical toast stays up until it is dismissed.
 */
export class ToastQueue {
  private visible: Toast[] = [];
  private pending: Toast[] = [];
  /**
   * Critical toasts that did not fit in the waiting cap, collapsed into one sticky
   * summary. It does not take a visible or waiting slot: the newest criticals stay
   * queued, and this row only counts the ones that were dropped.
   */
  private overflow: Toast | null = null;
  private overflowCount = 0;
  /** Bus ids the player closed, oldest first. A later merge stays hidden unless it is more severe. */
  private dismissed: { id: number; severity: Severity }[] = [];
  private seq = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;

  constructor(
    private now: () => number = Date.now,
    private onChange: () => void = () => {},
  ) {}

  /** How many toasts are waiting for a free slot. */
  get waiting(): number {
    return this.pending.length;
  }

  /** True when this bus id already has a toast on screen or waiting. */
  has(eventId: number): boolean {
    return this.findEvent(eventId) !== null;
  }

  /**
   * Show or, when `eventId` matches a toast already queued, update that one.
   * Returns its key, or null when the player already dismissed this id and the new
   * severity is not higher.
   */
  push(input: ToastInput): string | null {
    const now = this.now();
    if (input.eventId != null) {
      const existing = this.findEvent(input.eventId);
      if (existing) {
        if (input.text !== undefined) existing.text = input.text;
        if (input.event !== undefined) existing.event = input.event;
        existing.severity = input.severity;
        existing.carrierId = input.carrierId;
        if (input.systemId !== undefined) existing.systemId = input.systemId;
        // A merge into a waiter refreshes its arrival so it is not dropped as stale.
        // A merge into a visible toast restarts the on-screen timer.
        existing.arrivedAt = now;
        if (this.visible.includes(existing)) {
          existing.shownAt = now;
          this.schedule(now);
        }
        return existing.key;
      }
      const held = this.dismissed.find((d) => d.id === input.eventId);
      if (held && SEV_RANK[input.severity] >= SEV_RANK[held.severity]) return null;
      if (held) this.dismissed.splice(this.dismissed.indexOf(held), 1);
    }
    const toast: Toast = {
      key: input.eventId != null ? `e${input.eventId}` : `m${this.seq++}`,
      eventId: input.eventId ?? null,
      event: input.event ?? null,
      text: input.text ?? '',
      severity: input.severity,
      carrierId: input.carrierId,
      systemId: input.systemId ?? null,
      arrivedAt: now,
      shownAt: null,
    };
    // Newest on top. A full row keeps critical toasts and waits the oldest lesser one.
    this.visible.unshift(toast);
    while (this.visible.length > VISIBLE_CAP) {
      let demote = -1;
      for (let i = this.visible.length - 1; i >= 0; i--) {
        if (this.visible[i].severity !== 'critical') {
          demote = i;
          break;
        }
      }
      const idx = demote >= 0 ? demote : this.visible.length - 1;
      const oldest = this.visible.splice(idx, 1)[0];
      if (oldest) {
        // Back in the queue: the next time it is shown, the minimum starts again.
        oldest.shownAt = null;
        this.pending.unshift(oldest);
      }
    }
    this.prunePending(now);
    for (const t of this.visible) if (t.shownAt == null) t.shownAt = now;
    this.schedule(now);
    return toast.key;
  }

  /** Remove a toast. A waiting one takes its place. */
  dismiss(key: string | null) {
    if (key == null || !this.take(key)) return;
    const now = this.now();
    this.fill(now);
    this.schedule(now);
  }

  /**
   * Close the toast and return the carrier Go to should focus.
   * Null when the toast is already gone, or when it is not tied to a carrier.
   */
  goTo(key: string | null): number | null {
    if (key == null) return null;
    const toast = this.take(key);
    if (!toast) return null;
    const now = this.now();
    this.fill(now);
    this.schedule(now);
    return toast.carrierId;
  }

  /**
   * Where the summary toast sends the player, or null when `key` is not that toast.
   * Opening the inbox does not dismiss it; the player closes it with the usual button.
   */
  inboxAction(key: string | null): OpenInboxAction | null {
    if (key == null || this.overflow?.key !== key) return null;
    return this.overflow.action ?? null;
  }

  /** Visible toasts after applying expiry at `now`, newest first. The overflow summary is last. */
  shown(now = this.now()): readonly Toast[] {
    this.visible = this.visible.filter((t) => !visibleExpired(t, now));
    this.fill(now);
    this.schedule(now);
    const rows = this.visible.slice();
    if (this.overflow) rows.push(this.overflow);
    return rows;
  }

  clear() {
    this.visible = [];
    this.pending = [];
    this.overflow = null;
    this.overflowCount = 0;
    this.dismissed = [];
    this.clearTimer();
    this.deadline = null;
  }

  private findEvent(eventId: number): Toast | null {
    return (
      this.visible.find((t) => t.eventId === eventId) ??
      this.pending.find((t) => t.eventId === eventId) ??
      null
    );
  }

  private take(key: string): Toast | null {
    if (this.overflow?.key === key) {
      const toast = this.overflow;
      this.overflow = null;
      this.overflowCount = 0;
      return toast;
    }
    const vis = this.visible.findIndex((t) => t.key === key);
    let toast: Toast | undefined;
    if (vis >= 0) toast = this.visible.splice(vis, 1)[0];
    else {
      const wait = this.pending.findIndex((t) => t.key === key);
      if (wait >= 0) toast = this.pending.splice(wait, 1)[0];
    }
    if (toast?.eventId != null) this.rememberDismissed(toast.eventId, toast.severity);
    return toast ?? null;
  }

  private rememberDismissed(id: number, severity: Severity) {
    const idx = this.dismissed.findIndex((d) => d.id === id);
    if (idx >= 0) this.dismissed.splice(idx, 1);
    this.dismissed.push({ id, severity });
    if (this.dismissed.length > DISMISSED_CAP) this.dismissed.shift();
  }

  /** The newest waiter comes back under the toasts that are already showing. */
  private fill(now: number) {
    this.prunePending(now);
    while (this.visible.length < VISIBLE_CAP && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      if (waiterStale(next, now)) continue;
      next.shownAt = now;
      this.visible.push(next);
    }
  }

  /**
   * Drop stale non-critical waiters, then the oldest non-critical ones, until the
   * queue fits. A critical that does not fit is counted on the sticky summary
   * instead of disappearing.
   */
  private prunePending(now: number) {
    this.pending = this.pending.filter((t) => !waiterStale(t, now));
    while (this.pending.length > WAITING_CAP) {
      let drop = this.pending.length - 1;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i].severity !== 'critical') {
          drop = i;
          break;
        }
      }
      const removed = this.pending.splice(drop, 1)[0];
      if (removed?.severity === 'critical') this.noteCriticalOverflow(now);
    }
  }

  private noteCriticalOverflow(now: number) {
    this.overflowCount += 1;
    if (!this.overflow) {
      this.overflow = {
        key: 'critical-overflow',
        eventId: null,
        event: null,
        text: '',
        severity: 'critical',
        carrierId: null,
        systemId: null,
        arrivedAt: now,
        shownAt: now,
        action: { type: 'open-inbox', severity: 'critical' },
      };
    }
    this.overflow.text = criticalOverflowText(this.overflowCount);
  }

  /** One timer for the soonest auto-dismiss. Cleared and replaced when that moment changes. */
  private schedule(now: number) {
    let next: number | null = null;
    for (const t of this.visible) {
      const at = visibleDeadline(t);
      if (at === null) continue;
      if (next === null || at < next) next = at;
    }
    if (next === this.deadline) return;
    this.clearTimer();
    this.deadline = next;
    if (next === null) return;
    const delay = Math.max(0, next - now);
    const timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      this.onChange();
    }, delay);
    this.timer = timer;
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** A waiter whose display time ran out before it was shown. Criticals wait until dismissed. */
function waiterStale(t: Toast, now: number): boolean {
  if (t.severity === 'critical') return false;
  return now >= t.arrivedAt + TOAST_MS[t.severity];
}

/** When a visible non-critical toast comes down. Null for criticals and for waiters. */
function visibleDeadline(t: Toast): number | null {
  if (t.severity === 'critical' || t.shownAt == null) return null;
  return Math.max(t.shownAt + MIN_ON_SCREEN_MS, t.arrivedAt + TOAST_MS[t.severity]);
}

function visibleExpired(t: Toast, now: number): boolean {
  const at = visibleDeadline(t);
  return at !== null && now >= at;
}

function criticalOverflowText(n: number): string {
  const noun = n === 1 ? 'event' : 'events';
  return `${n} more critical ${noun}, open inbox`;
}

/**
 * Push the events that should toast, mildest and oldest first so the newest severe one
 * lands on top. A repeated bus id updates the open toast. Returns whether anything changed.
 */
export function offerToasts(
  queue: ToastQueue,
  events: readonly (SimEvent & { id: number })[],
  focusedCarrierId: number,
  rules?: AlertRules,
): boolean {
  const ordered = events
    .slice()
    .sort((a, b) => a.t - b.t || SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  let changed = false;
  for (const ev of ordered) {
    // A toast already open for this id keeps receiving merges, even when the new
    // payload would not have opened one (a barge loss followed by a drone).
    if (!wantsToast(ev, focusedCarrierId, rules) && !queue.has(ev.id)) continue;
    const key = queue.push({
      eventId: ev.id,
      event: ev,
      severity: ev.severity,
      carrierId: ev.carrierId,
      systemId: ev.systemId,
    });
    if (key !== null) changed = true;
  }
  return changed;
}

/**
 * Events whose rule asks for more than a toast: the game pauses on `pause`, and the
 * newest `focus` event names the carrier to switch to. `seen` holds bus ids already
 * acted on, so a merge into the same event does not pause or refocus again.
 */
export function alertActions(
  events: readonly (SimEvent & { id: number })[],
  rules: AlertRules | undefined,
  seen: Set<number>,
): { pause: boolean; focus: number | null } {
  let pause = false;
  let focus: number | null = null;
  for (const ev of events) {
    const mode = resolveAlert(rules, ev.kind, ev.carrierId);
    if ((mode !== 'pause' && mode !== 'focus') || seen.has(ev.id)) continue;
    seen.add(ev.id);
    if (seen.size > 256) seen.delete(seen.values().next().value as number);
    if (mode === 'pause') pause = true;
    else focus = ev.carrierId;
  }
  return { pause, focus };
}
