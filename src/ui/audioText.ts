import type { CellSize, HalftimeEffect, ModRewind, ModStutter, StepEffect } from '../model';
import { DEFAULT_MOD_FREEZE, DEFAULT_MOD_REVERSE, DEFAULT_MOD_REWIND, DEFAULT_MOD_SCRAMBLE, DEFAULT_MOD_STUTTER, isDice } from '../model';
import { laneLength } from './laneText';

/** How the audio mods read (see Mods som samplar det som hörs and the sketch): their values, settings and sentences. */

/** The line every audio mod's card has, and what its title says. */
export const SOURCE_NOTE = 'Source: what’s heard (step mods, reverb/delay, tape), never itself or another audio mod. Every roll is seeded.';
export const SOURCE_TITLE =
  'Audio mods sample what is heard under their clip: Main or Fill with every step mod, reverb and delay, and tape. Never themselves, and never another audio mod (Scramble, Stutter, Freeze, Reverse, Rewind, Halftime).';

export const CELL_TEXT: Record<CellSize, string> = { 0.5: '1/32', 1: '1/16', 2: '1/8', 4: 'beat' };
export const GRAB_TEXT: Record<ModStutter['grabs'], string> = { 1: '1/16', 2: '1/8', 4: 'beat' };
export const PULL_TEXT: Record<ModRewind['pullBack'], string> = { 4: '1 beat', 8: '2 beats', 16: '1 bar' };
export const CURVE_TEXT: Record<ModRewind['curve'], string> = { fast: 'Fast', slowing: 'Slowing', spinBack: 'Spin-back' };
/** Stutter's choices: the repeat's length. */
export const REPEAT_TEXT = ['off', '1/16', '1/32', '1/64'] as const;

const signed = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${Math.abs(x)}` : '0');
export const pitchStep = (x: number) => `${signed(x)} st`;
export const levelText = (db: number) => `${db < 0 ? `−${Math.abs(db)}` : '0'} dB`;
export const speedText = (speed: number) => `×${speed}`;

const diceCount = (effect: StepEffect) => {
  const n = effect.lane.filter(isDice).length;
  return n === 0 ? '' : `, ${n} ${n === 1 ? 'dice step' : 'dice steps'}`;
};
/** Fixed steps that are on. */
const onCount = (effect: StepEffect) => effect.lane.filter((s) => !isDice(s) && s.v >= 0.5).length;

/**
 * What an audio mod with a lane does, in one line, as the sketch:
 * "Scramble · cells of 1/16 from the whole song · 4 steps of 1 beat (1 bar), loops · 25 to 100% swap, 1 dice step · 25% reversed".
 */
export function audioSentence(effect: StepEffect): string {
  const lane = laneLength(effect);
  const dice = diceCount(effect);
  const values = effect.lane.flatMap((s) => (isDice(s) ? [s.lo, s.hi] : [s.v]));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const n = effect.lane.length;
  switch (effect.target) {
    case 'scramble': {
      const x = effect.scramble ?? DEFAULT_MOD_SCRAMBLE;
      const from = x.from === 'song' ? 'the whole song' : x.from === 'clip' ? 'inside the clip' : `± ${x.around} ${x.around === 1 ? 'bar' : 'bars'} around the clip`;
      return `Scramble · cells of ${CELL_TEXT[x.cell]} from ${from} · ${lane} · ${lo === hi ? `${lo}%` : `${lo} to ${hi}%`} swap${dice} · ${x.reverse}% reversed`;
    }
    case 'stutter': {
      const x = effect.stutter ?? DEFAULT_MOD_STUTTER;
      const first = Math.max(1, Math.round(lo));
      const repeats = hi === 0 ? 'off' : `repeats ${REPEAT_TEXT[first]}${hi > first ? ` → ${REPEAT_TEXT[Math.round(hi)]}` : ''}`;
      return `Stutter · grabs ${GRAB_TEXT[x.grabs]} · ${lane} · ${repeats}${dice} · ${x.pitch !== 0 ? `${signed(x.pitch)} st per repeat` : 'no pitch drift'}, gate ${x.gate}%`;
    }
    case 'freeze': {
      const x = effect.freeze ?? DEFAULT_MOD_FREEZE;
      return `Freeze · ${lane} · frozen on ${onCount(effect)} of ${n}${dice} · grain ${x.grain} ms, spread ${x.spread}%, ${levelText(x.level)}`;
    }
    case 'reverse': {
      const x = effect.reverse ?? DEFAULT_MOD_REVERSE;
      return `Reverse · cells of ${CELL_TEXT[x.cell]} · ${lane} · reversed on ${onCount(effect)} of ${n}${dice}`;
    }
    case 'rewind': {
      const x = effect.rewind ?? DEFAULT_MOD_REWIND;
      const at = effect.lane.flatMap((s, i) => (isDice(s) || s.v >= 0.5 ? [i + 1] : []));
      return `Rewind · pulls back ${PULL_TEXT[x.pullBack]}, ${CURVE_TEXT[x.curve]} · ${lane} · ${at.length > 0 ? `fires on step ${at.join(', ')}` : 'never fires'}${dice}`;
    }
    default:
      return '';
  }
}

/** "Halftime · ×0.5 under the whole clip, no ramp · pitch drops like a record" */
export function halftimeSentence(effect: HalftimeEffect): string {
  const pitch = effect.keepPitch ? 'pitch kept (stretch)' : effect.speed === 2 ? 'double time, pitch up like a record' : 'pitch drops like a record';
  return `Halftime · ${speedText(effect.speed)} under the whole clip, no ramp · ${pitch}`;
}
