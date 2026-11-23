// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fx } from '../sim/types';
import type { BusEvent } from './events';
import { events, frame, play, resetAudio, unlock } from './audio';
import { DEFAULT_SETTINGS, updateSettings } from './settings';

class Param {
  value = 0;
  setValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}
class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  type = '';
  buffer: unknown = null;
  addEventListener() {}
  connect(n: Node) {
    return n;
  }
  start() {
    fake.started++;
  }
  stop() {}
}
const fake = {
  started: 0,
  oscillators: 0,
  instance: null as FakeCtx | null,
};
class FakeCtx {
  currentTime = 0;
  state = 'running';
  sampleRate = 8000;
  destination = new Node();
  constructor() {
    fake.instance = this;
  }
  createGain() {
    return new Node();
  }
  createOscillator() {
    fake.oscillators++;
    return new Node();
  }
  createBufferSource() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
  createBuffer(_ch: number, len: number) {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const fx = (kind: Fx['kind']): Fx => ({
  kind,
  a: { x: 0, y: 0, z: 0 },
  b: { x: 1, y: 0, z: 0 },
  ttl: 0.1,
});

const win = window as Window & { AudioContext?: typeof AudioContext };
let original: typeof AudioContext | undefined;

beforeEach(() => {
  resetAudio();
  fake.started = 0;
  fake.oscillators = 0;
  fake.instance = null;
  original = win.AudioContext;
  updateSettings(DEFAULT_SETTINGS);
});
afterEach(() => {
  resetAudio();
  win.AudioContext = original;
  updateSettings(DEFAULT_SETTINGS);
});

describe('audio without AudioContext', () => {
  it('no-ops safely when the API is absent or muted', () => {
    win.AudioContext = undefined;
    expect(() => {
      unlock();
      play('laser');
      frame([fx('explosion'), fx('warp')]);
      events(
        [
          {
            id: 1,
            kind: 'Warped',
            carrierId: 0,
            systemId: 0,
            severity: 'info',
            t: 0,
            count: 1,
            data: { system: 'x' },
          } satisfies BusEvent,
        ],
        0,
      );
    }).not.toThrow();
    expect(fake.instance).toBeNull();
  });
});

describe('audio gating', () => {
  beforeEach(() => {
    win.AudioContext = FakeCtx as unknown as typeof AudioContext;
  });

  it('does not build a context while muted or at zero volume', () => {
    updateSettings({ sound: false });
    play('boom');
    updateSettings({ sound: true, volume: 0 });
    play('boom');
    expect(fake.instance).toBeNull();
  });

  it('rate-limits each cue kind within a frame burst', () => {
    unlock();
    frame([fx('laser'), fx('laser'), fx('laser')]);
    frame([fx('laser')]);
    expect(fake.oscillators).toBe(1);
  });

  it('lets unrelated cue kinds play in the same frame', () => {
    unlock();
    frame([fx('laser'), fx('pirateLaser'), fx('explosion')]);
    expect(fake.oscillators).toBeGreaterThanOrEqual(3);
  });

  it('plays each new event id once and resets across runs', () => {
    unlock();
    const ev = {
      id: 7,
      kind: 'PiratesArrived',
      carrierId: 0,
      systemId: 0,
      severity: 'warn',
      t: 0,
      count: 1,
      data: { size: 3 },
    } satisfies BusEvent;
    events([ev], 1);
    events([ev], 1);
    expect(fake.oscillators).toBe(2); // klaxon is two tones
    fake.instance!.currentTime += 0.5; // clear the per-kind rate limit
    events([ev], 2); // new run replays
    expect(fake.oscillators).toBe(4);
  });
});
