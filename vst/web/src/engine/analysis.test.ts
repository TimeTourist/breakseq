import { describe, expect, it } from 'vitest';
import type { AudioData } from '../model';
import { seededRng } from '../test/fixtures';
import { detectTransients } from './analysis';

const SR = 44100;

/** Sounds placed in silence: each is a function of time since its start. */
function render(seconds: number, hits: readonly { at: number; gain: number; sound: (t: number) => number }[]): AudioData {
  const x = new Float32Array(Math.round(seconds * SR));
  for (const { at, gain, sound } of hits) {
    const start = Math.round(at * SR);
    for (let i = start; i < x.length; i++) x[i]! += gain * sound((i - start) / SR);
  }
  return { sampleRate: SR, channels: [x, x] };
}

/** Noise, coloured by averaging: n = 1 is white; larger n is darker. */
function noise(seed: number, smoothing = 1) {
  const rng = seededRng(seed);
  const history: number[] = [];
  return () => {
    history.push(rng() * 2 - 1);
    if (history.length > smoothing) history.shift();
    return history.reduce((a, b) => a + b, 0) / Math.sqrt(history.length);
  };
}

/** Bright noise: the difference of white noise, which leans to the top. */
function brightNoise(seed: number) {
  const white = noise(seed);
  let last = 0;
  return () => {
    const v = white();
    const out = (v - last) / 2;
    last = v;
    return out;
  };
}

const kick = (t: number) => Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 12);
const snare = (() => {
  const n = noise(5, 6);
  return (t: number) => (0.6 * n() + 0.4 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 25);
})();
const hat = (() => {
  const n = brightNoise(7);
  return (t: number) => n() * Math.exp(-t * 60);
})();

describe('detectTransients', () => {
  const times = [0.1, 0.35, 0.6, 0.9];

  it('finds hits within 2 ms, just before each attack', () => {
    const audio = render(1.2, times.map((at, i) => ({ at, gain: 0.8, sound: [kick, snare, hat, snare][i]! })));
    const found = detectTransients(audio, 0, 1.2, 60);
    expect(found).toHaveLength(times.length);
    found.forEach((t, i) => {
      expect(Math.abs(t - times[i]!)).toBeLessThanOrEqual(0.002);
      expect(t).toBeLessThanOrEqual(times[i]!);
    });
  });

  it('finds nothing in silence', () => {
    expect(detectTransients(render(0.5, []), 0, 0.5, 100)).toEqual([]);
  });

  it('finds soft hits only with high sensitivity', () => {
    const audio = render(1, [
      { at: 0.1, gain: 0.9, sound: snare },
      { at: 0.5, gain: 0.9 * 10 ** (-38 / 20), sound: snare },
    ]);
    expect(detectTransients(audio, 0, 1, 100)).toHaveLength(2);
    expect(detectTransients(audio, 0, 1, 0)).toHaveLength(1);
  });

  it('works inside a window, in seconds from its start', () => {
    const audio = render(1.2, times.map((at) => ({ at, gain: 0.8, sound: snare })));
    const found = detectTransients(audio, 0.3, 0.5, 60);
    expect(found.map((t) => Math.round((t + 0.3) * 100) / 100)).toEqual([0.35, 0.6]);
  });
});
