import { HANGAR_TYPES, SHIP_STATS } from '../sim/config';
import type { LossCause, Severity, SimEvent } from '../sim/types';

const CAUSE: Record<LossCause, string> = {
  destroyed: 'destroyed',
  emergencyJump: 'left behind in emergency jump',
  leftBehind: 'outside at jump time',
};

const ship = (cls: keyof typeof SHIP_STATS) => SHIP_STATS[cls].name;

/** Player-facing text for one event. Merged events (count > 1) read as a total. */
export function formatEvent(ev: SimEvent): string {
  const n = ev.count;
  switch (ev.kind) {
    case 'CarrierOnline':
      return `Carrier online in ${ev.data.system}. Set your doctrine, then let the fleet work.`;
    case 'ShipLost':
      return n > 1
        ? `${n} ships lost, the last a ${ship(ev.data.cls).toLowerCase()} (${CAUSE[ev.data.cause]}).`
        : `${ship(ev.data.cls)} lost (${CAUSE[ev.data.cause]}).`;
    case 'ShipRetreating':
      return n > 1
        ? `${n} ships retreating for repairs.`
        : `${ship(ev.data.cls)} retreating for repairs.`;
    case 'PirateWaveIncoming':
      return `Pirate wave inbound: ${ev.data.size} raiders in ${ev.data.eta} s.`;
    case 'PiratesArrived':
      return 'Pirates have arrived!';
    case 'WaveRepelled':
      return 'Pirate wave repelled.';
    case 'StormStarted':
      return ev.data.h2
        ? 'H2 storm: ships near the gas giant take damage, harvest yield up.'
        : 'Solar storm: ships outside take damage, solar output up.';
    case 'StormPassed':
      return ev.data.h2 ? 'H2 storm passed.' : 'Solar storm passed.';
    case 'HazardCharted':
      return n > 1
        ? `Scout charted ${n} hazard fields.`
        : `Scout charted a ${ev.data.hazard} field.`;
    case 'VeinFound': {
      const v = n > 1 ? n : ev.data.veins;
      return `Scout found ${v} rich vein${v > 1 ? 's' : ''}.`;
    }
    case 'BargeWrecked':
      return n > 1
        ? `${n} barge wrecks dropped cargo containers. Haulers can salvage them.`
        : 'Barge wreck dropped a cargo container. Haulers can salvage it.';
    case 'BargeFallback':
      return 'Barge falling back to the carrier.';
    case 'ReserveRebuilt':
      return n > 1
        ? `Reserve rebuilt ${n} ships.`
        : `Reserve rebuilt a ${ship(ev.data.cls).toLowerCase()}.`;
    case 'ShipRebuilt':
      return n > 1
        ? `Rebuilt ${n} ships.`
        : `Rebuilt a ${ship(ev.data.cls).toLowerCase()} for ${ev.data.cost} credits.`;
    case 'HangarInstalled':
      return `New ${HANGAR_TYPES[ev.data.hangarType].name.toLowerCase()} installed.`;
    case 'WarpCharging':
      return `Warp drive charging for ${ev.data.system}. Recalling the fleet.`;
    case 'WarpCancelled':
      return 'Jump cancelled.';
    case 'Warped':
      return `Warped to ${ev.data.system}.`;
    case 'EmergencyJump':
      return 'Carrier hull critical! Emergency jump to the starter system.';
    case 'Prestiged':
      return `Operation reset. +${ev.data.research} research points.`;
    case 'WelcomeBack':
      return `Welcome back. The fleet earned ${ev.data.credits} credits while you were away.`;
    case 'Legacy':
      return ev.data.text;
  }
}

/** CSS tone class for a severity; `critical` reuses the old red `bad` tone. */
export function toneClass(sev: Severity): string {
  return `tone-${sev === 'critical' ? 'bad' : sev}`;
}
