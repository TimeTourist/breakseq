import type { Id } from './types';

/** How many seeds there are: a seed is a whole number 0 ≤ seed < SEEDS. */
export const SEEDS = 2 ** 32;

export const isSeed = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < SEEDS;

/**
 * A seed made from an id (FNV-1a), for objects saved before they had seeds:
 * the same file gets the same seeds every time it is loaded. (Claudes val.)
 */
export function seedOf(id: Id): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A fresh seed from the browser's random source, for new objects. */
export function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
