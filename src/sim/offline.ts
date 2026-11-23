// Offline settlement: the background model runs over time away with no new
// waves and no RP. orders.ts handles commands, actions.ts re-exports all (#250).

import { OFFLINE_CAP_S, OFFLINE_EFFICIENCY } from './config';
import { RETURN_GRACE_S, dematerialise, materialise, runBackground } from './background';
import { bind, emit, focusOp } from './state';
import { routeTick } from './routes';
import type { GameState, Sim } from './types';

export interface OfflineReport {
  seconds: number;
  credits: number;
  rebuilt: number;
}

/**
 * Offline, no new pirate waves roll; a wave already on the map at departure is resolved with
 * events. The fleet earns only
 * what safe mining yielded recently (salvage excluded), at reduced efficiency. Offline credits
 * do not count toward prestige research. Energy recharges from solar minus fleet upkeep over
 * the elapsed time (never below zero; mining income is already net of upkeep). Reserves keep
 * rebuilding.
 */
export function settleOffline(
  g: GameState,
  elapsedS: number,
  hidden = false,
): OfflineReport | null {
  const t = Math.min(OFFLINE_CAP_S, Math.max(0, elapsedS));
  if (t < 30) return null;
  const report: OfflineReport = { seconds: t, credits: 0, rebuilt: 0 };
  for (const op of g.ops) {
    const r = settleOp(bind(g, op), t);
    report.credits += r.credits;
    report.rebuilt += r.rebuilt;
  }
  // One summary for the whole settlement, on the focused carrier's log.
  if (g.ops.length)
    emit(bind(g, focusOp(g)), 'WelcomeBack', {
      credits: Math.round(report.credits),
      seconds: t,
      hidden,
    });
  // Routes keep running over the time away (whole seconds; the remainder is dropped).
  for (let i = 0; i < Math.floor(t) && g.routes.length; i++) routeTick(g, 1);
  return report;
}

function settleOp(s: Sim, t: number): { credits: number; rebuilt: number } {
  // Report the wave already on the map. No new wave rolls while away (#179).
  dematerialise(s, { events: true });
  const r = runBackground(s, t, {
    efficiency: OFFLINE_EFFICIENCY,
    events: false,
    waves: false,
    countsForRp: false,
    fusion: false,
  });
  s.carrier.shield = 1;
  // Never come back to an imminent wave.
  if (s.systems[s.systemId].tier > 1 && s.wave.timer < RETURN_GRACE_S) {
    s.wave.timer = RETURN_GRACE_S;
    s.wave.warning = false;
  }
  materialise(s);
  return { credits: r.credits, rebuilt: r.rebuilt };
}
