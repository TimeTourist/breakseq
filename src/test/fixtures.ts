import type { AudioData, CommandContext } from '../model';

/** Ids id-1, id-2, … so tests are deterministic. */
export function sequentialIds(): CommandContext {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

/** Synthetic audio: every sample has the given value in each channel. */
export function constantAudio(seconds: number, values: readonly number[] = [0.5, 0.5], sampleRate = 44100): AudioData {
  const length = Math.round(seconds * sampleRate);
  return { sampleRate, channels: values.map((v) => new Float32Array(length).fill(v)) };
}

/** A deterministic Rng that returns the given values in turn, repeating. */
export function sequenceRng(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

/** Mulberry32, a small seeded Rng for tests. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
