import type { Command, OfflineReport } from '../sim/actions';
import type { Carrier, Fx, GameState, Operation, ShipMode, Warp } from '../sim/types';
import type { BusEvent } from './events';
import type { UiSnapshot } from './snapshot';

/** How often the sim host pumps its tick loop (ms). */
export const PUMP_MS = 25;

/** Ship modes by index, for the per-tick `modes` byte array. */
export const MODES: ShipMode[] = [
  'docked',
  'idle',
  'toAsteroid',
  'mining',
  'toDropoff',
  'toBarge',
  'toCarrier',
  'station',
  'escort',
  'attack',
  'patrol',
  'repairing',
  'retreat',
  'recall',
];
const MODE_INDEX = new Map(MODES.map((m, i) => [m, i]));

/** Messages from the main thread to the sim. */
export type InMsg =
  | { t: 'init'; state: GameState; now: number; settle: boolean; epoch?: number }
  | { t: 'cmd'; cmd: Command }
  | { t: 'speed'; v: number }
  | { t: 'pause'; v: boolean }
  | { t: 'prestige' }
  | { t: 'replace'; state: GameState; epoch: number }
  | { t: 'snapshot'; id: number };

/**
 * Hot entity data for one pump: ships first (`nShips` of them), then pirates.
 * Positions are Float64 so a mirror built from them saves exactly what the sim holds.
 */
export interface Frame {
  t: 'frame';
  nShips: number;
  ids: Int32Array;
  pos: Float64Array;
  modes: Uint8Array;
  targets: Int32Array;
  carrier: Carrier;
  warp: Warp | null;
  fx: Fx[];
}

/** Messages from the sim to the main thread. */
export type OutMsg =
  | Frame
  /** A few times per second; see `UiSnapshot`. */
  | { t: 'state'; snap: UiSnapshot; offline: OfflineReport | null }
  /**
   * New or grown events since the last batch, most severe first.
   * `epoch` is the run generation the worker stamped. The engine ignores a batch
   * whose epoch is not the current one, so a message sent before `replace` was
   * handled cannot toast the previous run.
   */
  | { t: 'events'; epoch: number; events: BusEvent[] }
  | { t: 'error'; text: string }
  | { t: 'snapshot'; id: number; state: GameState };

export function encodeFrame(s: Operation): { frame: Frame; transfer: ArrayBuffer[] } {
  const n = s.ships.length + s.pirates.length;
  const ids = new Int32Array(n);
  const pos = new Float64Array(n * 3);
  const modes = new Uint8Array(n);
  const targets = new Int32Array(n);
  let i = 0;
  for (const sh of s.ships) {
    ids[i] = sh.id;
    pos[i * 3] = sh.pos.x;
    pos[i * 3 + 1] = sh.pos.y;
    pos[i * 3 + 2] = sh.pos.z;
    modes[i] = MODE_INDEX.get(sh.mode) ?? 0;
    targets[i] = sh.targetId;
    i++;
  }
  for (const p of s.pirates) {
    ids[i] = p.id;
    pos[i * 3] = p.pos.x;
    pos[i * 3 + 1] = p.pos.y;
    pos[i * 3 + 2] = p.pos.z;
    targets[i] = p.targetId;
    i++;
  }
  return {
    frame: {
      t: 'frame',
      nShips: s.ships.length,
      ids,
      pos,
      modes,
      targets,
      carrier: s.carrier,
      warp: s.warp,
      fx: s.fx,
    },
    transfer: [ids.buffer, pos.buffer, modes.buffer, targets.buffer],
  };
}
