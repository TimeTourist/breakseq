import { describe, expect, it } from 'vitest';
import type { Splice } from './audio-mods';
import { SPLICE_FADE } from './audio-mods';
import { applySplices } from './render-audio-mods';

const RATE = 1000;
/** One second that rises from 0 to 1, in both channels: where it reads from shows in its value. */
const ramp = () => [0, 1].map(() => Float32Array.from({ length: RATE }, (_, i) => i / RATE));
const splice = (fields: Partial<Splice>): Splice => ({ time: 0.2, length: 0.2, source: [0.2, 0.2, 0, 0], gain: 1, grains: null, ...fields });
const fade = Math.round(SPLICE_FADE * RATE);

describe('applySplices', () => {
  it('without splices gives what is heard back as it is', () => {
    const heard = ramp();
    expect(applySplices(heard, [], RATE)[0]).toEqual(heard[0]);
  });

  it('a splice reading backwards plays the cell backwards in its place; outside it what is heard plays', () => {
    const [out] = applySplices(ramp(), [splice({ source: [0.4, -0.2, 0, 0] })], RATE);
    expect(out![100]).toBeCloseTo(0.1, 6);
    expect(out![250]).toBeCloseTo(0.35, 6);
    expect(out![350]).toBeCloseTo(0.25, 6);
    expect(out![700]).toBeCloseTo(0.7, 6);
  });

  it('cross-fades at its edges over SPLICE_FADE, from what is heard and back', () => {
    const [out] = applySplices(ramp(), [splice({ source: [0.8, 0, 0, 0] })], RATE);
    // Two frames into the fade in (of three): a third what is heard (0.201), two thirds the splice (0.8).
    expect(fade).toBe(3);
    expect(out![201]).toBeCloseTo((1 / 3) * 0.201 + (2 / 3) * 0.8, 6);
    expect(out![210]).toBeCloseTo(0.8, 6);
    // It fades out after its end.
    expect(out![400 + fade + 1]).toBeCloseTo(0.4 + (fade + 1) / RATE, 6);
  });

  it('two splices side by side cross-fade without a dip', () => {
    const a = splice({ time: 0.2, length: 0.2, source: [0.5, 0, 0, 0] });
    const b = splice({ time: 0.4, length: 0.2, source: [0.5, 0, 0, 0] });
    const [out] = applySplices(ramp(), [a, b], RATE);
    for (let i = 205; i < 600; i++) expect(out![i]).toBeCloseTo(0.5, 6);
  });

  it('a gain of 0 is silence', () => {
    const [out] = applySplices(ramp(), [splice({ gain: 0 })], RATE);
    expect(out![300]).toBe(0);
  });

  it('half speed reads half as far, so the pitch drops like a record', () => {
    const [out] = applySplices(ramp(), [splice({ source: [0.2, 0.1, 0, 0] })], RATE);
    expect(out![300]).toBeCloseTo(0.25, 6);
    expect(out![390]).toBeCloseTo(0.295, 6);
  });

  it('grains at a still point hold it: every grain plays the same piece at 1×', () => {
    const grains = { length: 0.02, offsets: Array.from({ length: 40 }, () => 0) };
    const [out] = applySplices(ramp(), [splice({ source: [0.5, 0, 0, 0], grains })], RATE);
    // Hann windows half a grain apart add up to 1: what plays stays within the grain read at 0.5.
    for (let i = 220; i < 380; i++) {
      expect(out![i]).toBeGreaterThan(0.5 - 1e-6);
      expect(out![i]).toBeLessThan(0.52 + 1e-6);
    }
    // And it repeats every half grain: a tone.
    expect(out![250]).toBeCloseTo(out![260]!, 6);
  });
});
