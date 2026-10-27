import type { EventData, Severity, Sim, SimEvent, SimEventKind } from './types';

export const SEVERITY: Record<SimEventKind, Severity> = {
  CarrierOnline: 'good',
  ShipLost: 'warn',
  ShipRetreating: 'warn',
  PirateWaveIncoming: 'warn',
  PiratesArrived: 'critical',
  WaveRepelled: 'good',
  StormStarted: 'warn',
  StormPassed: 'info',
  HazardCharted: 'warn',
  VeinFound: 'good',
  BargeWrecked: 'warn',
  BargeFallback: 'warn',
  ReserveRebuilt: 'good',
  ShipRebuilt: 'good',
  HangarInstalled: 'good',
  WarpCharging: 'warn',
  WarpCancelled: 'info',
  Warped: 'good',
  EmergencyJump: 'critical',
  Prestiged: 'good',
  Admiralty: 'good',
  ChallengeStarted: 'info',
  ChallengeComplete: 'good',
  WelcomeBack: 'good',
  Legacy: 'info',
};

const LOG_CAP = 40;
/** Bounds the outbox when nothing drains it (tests, headless balance runs). */
const OUTBOX_CAP = 256;

/** Report an event to the player. Write-only: the sim never reads events back. */
export function emit<K extends SimEventKind>(s: Sim, kind: K, data: EventData[K]) {
  const ev = {
    kind,
    carrierId: s.id,
    systemId: s.systemId,
    severity: SEVERITY[kind],
    t: s.time,
    count: 1,
    data,
  } as SimEvent;
  s.log.unshift(ev);
  if (s.log.length > LOG_CAP) s.log.length = LOG_CAP;
  s.events.push({ ...ev });
  if (s.events.length > OUTBOX_CAP) s.events.splice(0, s.events.length - OUTBOX_CAP);
}
