import type { Rng } from '../model';

/**
 * Randomness from seeds: every random choice is worked out from the seeds of
 * what makes it and where it is made, so the same project always plays the
 * same (see Slump och seeds). Pure, like generate: no Math.random.
 */

/** Randomness for one choice: the same numbers (seeds and place) give the same Rng. */
export type Dice = (...place: readonly number[]) => Rng;

/** One 32-bit number from many whole numbers, each changing it all through (murmur3's mixing). */
export function mix(values: readonly number[]): number {
  let h = 0x9e3779b9 ^ values.length;
  for (const value of values) {
    let k = Math.imul(value >>> 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32 from a 32-bit seed: 0 ≤ x < 1. */
function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The Rng for a choice made from these seeds at this place. */
export const placeRng: Dice = (...place) => mulberry(mix(place));

/** What a choice is, mixed in first, so two kinds of choice at the same place differ. */
export const CHOICE = { pad: 1, mod: 2, stack: 3, shuffle: 4, tape: 5, pass: 6, audio: 7 } as const;

/** The seed of pass number `pass` in Play's passes (varv) of a matrix, loop or mod. */
export const passSeed = (pass: number): number => mix([CHOICE.pass, pass]);
