import { describe, expect, it } from 'vitest';
import { FILTER_PEAK_DB, crushBits, distort, filterSettings, levelMatch, rms } from './colour';

const sine = (n: number, cycles: number, level = 0.5) => Float32Array.from({ length: n }, (_, i) => level * Math.sin((2 * Math.PI * cycles * i) / n));

describe('dist', () => {
  it('Drive saturates: nearly clean at 0, nearly square at 1', () => {
    const s = sine(1000, 5, 0.1);
    const clean = distort(s, { mode: 'drive', amount: 0 });
    expect(Math.max(...clean.map((v, i) => Math.abs(v - s[i]!)))).toBeLessThan(0.001);
    const hard = distort(s, { mode: 'drive', amount: 1 });
    expect(hard[50]).toBeGreaterThan(0.99);
  });

  it('Crush rounds to fewer bits: 2 bits at 1', () => {
    expect(crushBits(0)).toBe(16);
    const out = distort(sine(1000, 3), { mode: 'crush', amount: 1 });
    // Two bits over −1…1 is a step of 0.5.
    expect(new Set(out).size).toBeLessThanOrEqual(5);
    expect(out.every((v) => Math.abs(v / 0.5 - Math.round(v / 0.5)) < 1e-6)).toBe(true);
  });

  it('Decimate holds each sample: not at 0, for 32 samples at 1', () => {
    const ramp = Float32Array.from({ length: 128 }, (_, i) => i / 128);
    expect([...distort(ramp, { mode: 'decimate', amount: 0 })]).toEqual([...ramp]);
    const held = distort(ramp, { mode: 'decimate', amount: 1 });
    expect(new Set(held).size).toBe(4);
    expect(held[31]).toBe(0);
    expect(held[32]).toBe(ramp[32]);
  });

  it('the level match brings dist back to the RMS it had', () => {
    const s = sine(1000, 5, 0.2);
    const hard = distort(s, { mode: 'drive', amount: 1 });
    const gain = levelMatch(rms([s]), rms([hard]));
    expect(rms([hard.map((v) => v * gain)])).toBeCloseTo(rms([s]), 6);
    expect(levelMatch(0, 0.3)).toBe(1);
  });
});

describe('filter', () => {
  it('resonance 0 is flat, 1 a 21 dB peak held to 6 dB', () => {
    expect(filterSettings({ type: 'lowpass', cutoff: 1000, resonance: 0 }, 44100)).toMatchObject({ q: -3, gain: 1 });
    const loud = filterSettings({ type: 'lowpass', cutoff: 1000, resonance: 1 }, 44100);
    expect(loud.q).toBe(21);
    expect(20 * Math.log10(loud.gain) + loud.q).toBeCloseTo(FILTER_PEAK_DB);
  });

  it('a cutoff above Nyquist is brought below it', () => {
    expect(filterSettings({ type: 'highpass', cutoff: 20000, resonance: 0 }, 22050).frequency).toBeLessThan(11025);
  });
});
