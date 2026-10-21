import type { Folder } from '../engine/project-folder';
import type { AudioData, CommandContext } from '../model';

/** Ids id-1, id-2, … and seeds 1, 2, … so tests are deterministic. */
export function sequentialIds(): CommandContext {
  let n = 0;
  let seed = 0;
  return { newId: () => `id-${++n}`, newSeed: () => ++seed };
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

/** A project folder in memory, for snapshot tests. `files` shows what is on its "disk". */
export function memoryFolder(name = 'Project'): Folder & { readonly files: Map<string, Uint8Array>; readonly writes: string[] } {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
    name,
    files,
    writes,
    read: async (path) => files.get(path) ?? null,
    write: async (path, bytes) => {
      files.set(path, bytes);
      writes.push(path);
    },
    list: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)).filter((p) => !p.includes('/')),
  };
}

/** Generate options that draw every random choice from one Rng in turn, as takes did before seeds: for tests of what a random value does. */
export function withRng(rng: () => number): { readonly dice: () => () => number } {
  return { dice: () => rng };
}
