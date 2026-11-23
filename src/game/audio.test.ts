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
  start(when = 0) {
    fake.started++;
    fake.starts.push(when);
  }
  stop() {}
}
const fake = {
  started: 0,
  starts: [] as number[],
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

const fx = (kind: Fx['kind'], x = 0, ttl = 0.1): Fx => ({
  kind,
  a: { x, y: 0, z: 0 },
  b: { x: x + 1, y: 0, z: 0 },
  ttl,
});

const win = window as Window & { AudioContext?: typeof AudioContext };
let original: typeof AudioContext | undefined;

beforeEach(() => {
  resetAudio();
  fake.started = 0;
  fake.starts = [];
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

  it('does not build a context before unlock or while muted or at zero volume', () => {
    play('boom');
    updateSettings({ sound: false });
    play('boom');
    updateSettings({ sound: true, volume: 0 });
    play('boom');
    expect(fake.instance).toBeNull();
  });

  it('starts delayed tones at their scheduled time and allows long-gap cues at t=0', () => {
    unlock();
    play('arrive');
    expect(fake.oscillators).toBe(1);
    play('klaxon');
    expect(fake.starts.slice(-2)).toEqual([0, 0.19]);
  });

  it('rate-limits each cue kind within a frame burst', () => {
    unlock();
    frame([fx('laser', 0), fx('laser', 1), fx('laser', 2)]);
    frame([fx('laser', 3)]);
    expect(fake.oscillators).toBe(1);
  });

  it('plays an explosion once across its decaying TTL and again for a new one', () => {
    unlock();
    frame([fx('explosion', 10, 0.8)]);
    fake.instance!.currentTime += 0.2;
    frame([fx('explosion', 10, 0.6)]);
    expect(fake.oscillators).toBe(1);
    fake.instance!.currentTime += 0.2;
    frame([fx('explosion', 10, 0.4), fx('explosion', 20, 0.8)]);
    expect(fake.oscillators).toBe(2);
  });

  it('lets unrelated cue kinds play in the same frame', () => {
    unlock();
    frame([fx('laser'), fx('pirateLaser'), fx('explosion')]);
    expect(fake.oscillators).toBeGreaterThanOrEqual(3);
  });

  it('plays severity-ranked batches without skipping lower-id events and ignores other carriers', () => {
    unlock();
    const warn = {
      id: 9,
      kind: 'PiratesArrived',
      carrierId: 0,
      systemId: 0,
      severity: 'warn',
      t: 0,
      count: 1,
      data: { size: 3 },
    } satisfies BusEvent;
    const info = {
      id: 10,
      kind: 'VeinFound',
      carrierId: 0,
      systemId: 0,
      severity: 'info',
      t: 0,
      count: 1,
      data: { veins: 1 },
    } satisfies BusEvent;
    const other = {
      id: 11,
      kind: 'PiratesArrived',
      carrierId: 1,
      systemId: 1,
      severity: 'warn',
      t: 0,
      count: 1,
      data: { size: 2 },
    } satisfies BusEvent;
    events([warn, info], 1, 0);
    expect(fake.oscillators).toBe(4); // chime (2) + klaxon (2)
    fake.instance!.currentTime += 0.5;
    events([other, warn, info], 1, 0);
    expect(fake.oscillators).toBe(4); // carrier 1 event ignored
    events([other, warn, info], 1, 1);
    expect(fake.oscillators).toBe(4); // switching to carrier 1 does not replay it
    events([warn], 2, 0); // new run replays
    expect(fake.oscillators).toBe(6);
  });
});
