import type { Splice } from './audio-mods';
import { SPLICE_FADE, grainStarts, sourceAt } from './audio-mods';

/**
 * Plays the audio mods' splices over what is heard (see Mods som samplar det
 * som hörs). Plain arithmetic on the channels, no Web Audio: every splice
 * reads what is heard as it was given, never another splice, so no audio mod
 * hears itself or another.
 */

/** `data` at a frame between frames, read linearly; silence outside it. */
function read(data: Float32Array, frame: number): number {
  const i = Math.floor(frame);
  if (i < 0 || i >= data.length) return 0;
  const a = data[i]!;
  const b = i + 1 < data.length ? data[i + 1]! : 0;
  return a + (b - a) * (frame - i);
}

/** A periodic Hann window at `x` (0–1): two half a window apart add up to 1. */
const hann = (x: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);

/**
 * What is heard with the splices played over it. Each splice fades in over
 * SPLICE_FADE from its start and out over SPLICE_FADE after its end; where
 * splices are, what is heard is faded out by as much as they cover, so a
 * splice next to another, or to what is heard, cross-fades with it.
 */
export function applySplices(heard: readonly Float32Array[], splices: readonly Splice[], sampleRate: number): Float32Array[] {
  if (splices.length === 0) return heard.map((c) => c.slice());
  const total = heard[0]?.length ?? 0;
  const fade = SPLICE_FADE * sampleRate;
  const cover = new Float32Array(total);
  const played = heard.map(() => new Float32Array(total));

  for (const splice of splices) {
    const first = Math.max(0, Math.round(splice.time * sampleRate));
    const end = Math.round((splice.time + splice.length) * sampleRate);
    const last = Math.min(total, end + Math.ceil(fade));
    const gate = (f: number) => Math.max(0, Math.min(1, (f - first + 1) / fade, 1 - (f - end + 1) / fade));
    for (let f = first; f < last; f++) cover[f]! += gate(f);
    if (splice.gain === 0) continue;
    const at = (f: number) => (f / sampleRate - splice.time) / splice.length;

    if (splice.grains === null) {
      for (let f = first; f < last; f++) {
        const g = gate(f) * splice.gain;
        if (g === 0) continue;
        const frame = sourceAt(splice, at(f)) * sampleRate;
        heard.forEach((data, c) => (played[c]![f]! += g * read(data, frame)));
      }
      continue;
    }
    // Grains at 1×, half a grain apart, each reading from where the splice points when it starts.
    const { length, offsets } = splice.grains;
    grainStarts(splice).forEach((start, k) => {
      const from = (sourceAt(splice, (start - splice.time) / splice.length) + (offsets[k % offsets.length] ?? 0)) * sampleRate;
      const g0 = Math.max(first, Math.ceil(start * sampleRate));
      const g1 = Math.min(last, Math.ceil((start + length) * sampleRate));
      for (let f = g0; f < g1; f++) {
        const t = f / sampleRate - start;
        const g = gate(f) * splice.gain * hann(t / length);
        if (g === 0) continue;
        heard.forEach((data, c) => (played[c]![f]! += g * read(data, from + t * sampleRate)));
      }
    });
  }
  return heard.map((data, c) => {
    const out = played[c]!;
    for (let f = 0; f < total; f++) out[f]! += data[f]! * (1 - Math.min(1, cover[f]!));
    return out;
  });
}
