// Zero-asset procedural Web Audio cues for combat, warp, alerts and UI (#236).
// Lives in the lazy Scene chunk; nothing is constructed until a user gesture calls `unlock`.
// No DOM or three.js beyond AudioContext, so it stays importable from Node tests.
import type { Fx, SimEventKind } from '../sim/types';
import type { BusEvent } from './events';
import { getSettings } from './settings';

type Cue =
  | 'laser'
  | 'pirate'
  | 'turret'
  | 'boom'
  | 'charge'
  | 'arrive'
  | 'klaxon'
  | 'chime'
  | 'sting'
  | 'ui';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let voices = 0;
const MAX_VOICES = 14;
/** Minimum seconds between cues of one kind; the 400-ship cap that keeps battles from clipping (#236). */
const GAP: Record<Cue, number> = {
  laser: 0.06,
  pirate: 0.07,
  turret: 0.09,
  boom: 0.11,
  charge: 1.2,
  arrive: 1.2,
  klaxon: 0.45,
  chime: 0.35,
  sting: 0.5,
  ui: 0.045,
};
const last = new Map<Cue, number>();

/** Lazily builds the context, master gain and the one shared noise buffer. Never throws. */
function ensure(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
  const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    const n = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < n; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      d[i] = seed / 0x80000000 - 1;
    }
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Resume a context on a user gesture so browser autoplay rules are respected. */
export function unlock(): void {
  const c = ensure();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
}

/** True when a cue may play: unmuted, unlocked, under the voice cap and past its rate limit. */
function ready(kind: Cue): AudioContext | null {
  const s = getSettings();
  if (!s.sound || s.volume <= 0) return null;
  const c = ensure();
  if (!c || c.state === 'suspended' || voices >= MAX_VOICES) return null;
  const t = c.currentTime;
  if (t - (last.get(kind) ?? -1) < GAP[kind]) return null;
  last.set(kind, t);
  master!.gain.value = s.volume;
  return c;
}

function voice(src: AudioScheduledSourceNode, end: number): void {
  voices++;
  src.addEventListener('ended', () => void voices--, { once: true });
  src.start();
  src.stop(end);
}

/** One enveloped oscillator, optionally swept in frequency and delayed from now. */
function tone(
  c: AudioContext,
  from: number,
  to: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  delay = 0,
): void {
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  voice(o, t + dur + 0.01);
}

/** A short filtered burst from the shared noise buffer. */
function hiss(
  c: AudioContext,
  dur: number,
  freq: number,
  gain: number,
  type: BiquadFilterType = 'bandpass',
): void {
  if (!noise) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  voice(src, t + dur);
}

/** Play one gated cue. Safe to call every frame from the render loop. */
export function play(kind: Cue): void {
  const c = ready(kind);
  if (!c) return;
  switch (kind) {
    case 'laser':
      tone(c, 760, 340, 0.09, 'sawtooth', 0.05);
      break;
    case 'pirate':
      tone(c, 480, 230, 0.1, 'square', 0.045);
      break;
    case 'turret':
      tone(c, 920, 460, 0.08, 'sawtooth', 0.05);
      hiss(c, 0.05, 1800, 0.016);
      break;
    case 'boom':
      tone(c, 130, 38, 0.34, 'sine', 0.18);
      hiss(c, 0.18, 280, 0.05, 'lowpass');
      break;
    case 'charge':
      tone(c, 180, 620, 1.1, 'sawtooth', 0.035);
      break;
    case 'arrive':
      tone(c, 220, 38, 0.7, 'sine', 0.2);
      hiss(c, 0.4, 480, 0.05, 'lowpass');
      break;
    case 'klaxon':
      tone(c, 430, 380, 0.16, 'square', 0.045);
      tone(c, 320, 285, 0.16, 'square', 0.04, 0.19);
      break;
    case 'chime':
      tone(c, 880, 1180, 0.28, 'sine', 0.045);
      tone(c, 1320, 1320, 0.2, 'sine', 0.022, 0.06);
      break;
    case 'sting':
      tone(c, 523, 784, 0.35, 'triangle', 0.065);
      tone(c, 784, 1046, 0.42, 'triangle', 0.045, 0.11);
      break;
    case 'ui':
      tone(c, 920, 600, 0.035, 'square', 0.018);
      break;
  }
}

/** Event kind to cue. Unlisted kinds stay silent. */
const EVENT_CUE: Partial<Record<SimEventKind, Cue>> = {
  ShipLost: 'boom',
  BargeWrecked: 'boom',
  PirateWaveIncoming: 'klaxon',
  PiratesArrived: 'klaxon',
  StormStarted: 'chime',
  HazardCharted: 'chime',
  VeinFound: 'chime',
  WarpCharging: 'charge',
  Warped: 'arrive',
  EmergencyJump: 'arrive',
  Prestiged: 'sting',
  Admiralty: 'sting',
  ChallengeComplete: 'sting',
};

let seenEpoch = -1;
let lastId = 0;
/** Play cues for newly arrived events, ignoring merges and a previous run's events. */
export function events(list: readonly BusEvent[], epoch: number): void {
  if (epoch !== seenEpoch) {
    seenEpoch = epoch;
    lastId = 0;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.id <= lastId) continue;
    lastId = e.id;
    const cue = EVENT_CUE[e.kind];
    if (cue) play(cue);
  }
}

/** One frame of combat FX: at most one rate-limited cue per kind, whatever the battle size. */
export function frame(fx: readonly Fx[]): void {
  let laser = false;
  let pirate = false;
  let turret = false;
  let boom = false;
  let warp = false;
  for (const f of fx) {
    if (f.kind === 'laser') laser = true;
    else if (f.kind === 'pirateLaser') pirate = true;
    else if (f.kind === 'turretLaser') turret = true;
    else if (f.kind === 'explosion') boom = true;
    else if (f.kind === 'warp') warp = true;
  }
  if (laser) play('laser');
  if (pirate) play('pirate');
  if (turret) play('turret');
  if (boom) play('boom');
  if (warp) play('arrive');
}

/** Test hook: drop the cached context so a fake AudioContext can be installed between cases. */
export function resetAudio(): void {
  void ctx?.close().catch(() => {});
  ctx = null;
  master = null;
  noise = null;
  voices = 0;
  last.clear();
  seenEpoch = -1;
  lastId = 0;
}
