import { describe, expect, it } from 'vitest';
import { sameSeed, soundsSame } from './clips';
import type { Clip } from './types';

const clip = (patch: Partial<Clip> = {}): Clip => ({ id: 'a', row: 'main', ref: 'loop-1', start: 0, length: 16, offset: 0, seed: 7, ...patch });

describe('clips that sound the same (Song-v2)', () => {
  it('same loop or mod, seed, length and start in the loop: they sound the same, wherever and in whichever row of its kind they lie', () => {
    const a = clip();
    expect(soundsSame(a, clip({ id: 'b', start: 32 }))).toBe(true);
    expect(soundsSame(a, clip({ id: 'b', row: 'fill', start: 32 }))).toBe(true);
    const mod = clip({ row: 'modA', ref: 'mod-1' });
    expect(soundsSame(mod, { ...mod, id: 'b', row: 'modB', start: 16 })).toBe(true);
  });

  it('a clip is not its own twin', () => {
    expect(soundsSame(clip(), clip())).toBe(false);
    expect(sameSeed(clip(), clip())).toBe(false);
  });

  it('another loop or mod, seed, length or start in the loop: they do not', () => {
    const a = clip();
    for (const patch of [{ ref: 'loop-2' }, { seed: 8 }, { length: 8 }, { offset: 4 }]) expect(soundsSame(a, clip({ id: 'b', start: 32, ...patch }))).toBe(false);
    // A mod and a loop with the same id never sound alike.
    expect(soundsSame(a, clip({ id: 'b', row: 'modA' }))).toBe(false);
  });

  it('the offset counts unwrapped: the random choices follow it, so a whole loop further on is another start', () => {
    expect(soundsSame(clip(), clip({ id: 'b', offset: 16 }))).toBe(false);
  });

  it('only the same seed: they share their seed, though they play different parts', () => {
    const a = clip();
    const half = clip({ id: 'b', start: 8, length: 8, offset: 8 });
    expect(soundsSame(a, half)).toBe(false);
    expect(sameSeed(a, half)).toBe(true);
    expect(sameSeed(a, clip({ id: 'b', seed: 8 }))).toBe(false);
  });
});
