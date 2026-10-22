import type { Clip } from '../model';
import { STEPS_PER_BAR, sameSeed, soundsSame } from '../model';
import { musicalLength } from './labels';

/** A clip's seed in short: three hex digits (◆ 7f3). "The same seed" always compares the whole seed, not this. */
export const seedCode = (seed: number): string => (seed & 0xfff).toString(16).padStart(3, '0');

export const seedTag = (seed: number): string => `◆ ${seedCode(seed)}`;

/** Where a clip starts, as bar.beat in the ruler's notation, counted from 1: "4.3"; off the beat with its 1/16 too: "4.3.2". */
export function startText(start: number): string {
  const bar = Math.floor(start / STEPS_PER_BAR) + 1;
  const beat = Math.floor((start % STEPS_PER_BAR) / 4) + 1;
  const sixteenth = (start % 4) + 1;
  return sixteenth === 1 ? `${bar}.${beat}` : `${bar}.${beat}.${sixteenth}`;
}

/** A clip's length as a musician says it: "2 beats", "1 bar", "1 bar 2 beats", "2 bars 3/16". */
export function clipLength(steps: number): string {
  const bars = Math.floor(steps / STEPS_PER_BAR);
  const rest = steps % STEPS_PER_BAR;
  return bars === 0 || rest === 0 ? musicalLength(steps) : `${musicalLength(bars * STEPS_PER_BAR)} ${musicalLength(rest)}`;
}

/** Where a clip sits: "at 4.3 · 1 bar" (Magnus beslut 2026-10-22). */
export const placeText = (clip: Pick<Clip, 'start' | 'length'>): string => `at ${startText(clip.start)} · ${clipLength(clip.length)}`;

/** "4.1", "2.1 and 4.1", "2.1, 3.1 and 4.1". */
const listText = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;

/** "the clip at 2.1", "the clips at 2.1 and 4.1". */
const clipsAt = (clips: readonly Clip[]): string => `the clip${clips.length === 1 ? '' : 's'} at ${listText(clips.map((c) => startText(c.start)))}`;

/** The other clips that sound the same as `clip` (Song-v2), in song order. */
export const twinsOf = (clips: readonly Clip[], clip: Clip): Clip[] => clips.filter((c) => soundsSame(clip, c));

/**
 * The sentence in the selected clip's panel: the clips that sound the same, or
 * else the ones that only share its seed, or its own roll. (Claudes val: when
 * some sound the same and others only share the seed, only the first are named.)
 */
export function twinsText(clips: readonly Clip[], clip: Clip): string {
  const twins = twinsOf(clips, clip);
  if (twins.length > 0) return `Same seed as ${clipsAt(twins)}: they sound the same.`;
  const shared = clips.filter((c) => sameSeed(clip, c));
  if (shared.length > 0) return `Shares its seed with ${clipsAt(shared)}.`;
  return 'Its own roll.';
}

/** The pointer over a clip: "amen 1 · at 1.1 · 1 bar · seed ◆ 7f3 (sounds the same as the clip at 3.1)". */
export function clipSeedTitle(clips: readonly Clip[], clip: Clip, name: string): string {
  const twins = twinsOf(clips, clip);
  const same = twins.length === 0 ? '' : ` (sounds the same as ${clipsAt(twins)})`;
  return `${name} · ${placeText(clip)} · seed ${seedTag(clip.seed)}${same}`;
}
