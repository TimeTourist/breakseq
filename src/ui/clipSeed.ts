import type { Clip } from '../model';
import { STEPS_PER_BAR, sameSeed, soundsSame } from '../model';

/** A clip's seed in short: three hex digits (◆ 7f3). "The same seed" always compares the whole seed, not this. */
export const seedCode = (seed: number): string => (seed & 0xfff).toString(16).padStart(3, '0');

export const seedTag = (seed: number): string => `◆ ${seedCode(seed)}`;

/** The bars a clip lies over, counted from 1: "bar 4", "bars 4–6". */
export function barsText(clip: Pick<Clip, 'start' | 'length'>): string {
  const first = Math.floor(clip.start / STEPS_PER_BAR) + 1;
  const last = Math.floor((clip.start + clip.length - 1) / STEPS_PER_BAR) + 1;
  return first === last ? `bar ${first}` : `bars ${first}–${last}`;
}

/** "bar 2", "bar 2 and bar 4", "bar 2, bar 3 and bar 4". */
const listText = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;

/** "the clip at bar 2", "the clips at bar 2 and bar 4". */
const clipsAt = (clips: readonly Clip[]): string => `the clip${clips.length === 1 ? '' : 's'} at ${listText(clips.map(barsText))}`;

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

/** The pointer over a clip: "amen 1 · bar 1 · seed ◆ 7f3 (sounds the same as bar 3)". */
export function clipSeedTitle(clips: readonly Clip[], clip: Clip, name: string): string {
  const twins = twinsOf(clips, clip);
  const same = twins.length === 0 ? '' : ` (sounds the same as ${listText(twins.map(barsText))})`;
  return `${name} · ${barsText(clip)} · seed ${seedTag(clip.seed)}${same}`;
}
