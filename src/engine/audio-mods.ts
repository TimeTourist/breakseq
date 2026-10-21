import type { AudioTarget, Clip, HalftimeEffect, Project, StepEffect } from '../model';
import {
  DEFAULT_GRAIN,
  DEFAULT_MOD_FREEZE,
  DEFAULT_MOD_REVERSE,
  DEFAULT_MOD_REWIND,
  DEFAULT_MOD_SCRAMBLE,
  DEFAULT_MOD_STUTTER,
  MOD_TARGETS,
  STEPS_PER_BAR,
  STEP_SIZES,
  halftimeOf,
  stepDuration,
} from '../model';
import type { ModRun } from './mods';
import { clipPosition, effectFor, laneDice, laneValueAt } from './mods';
import type { Dice } from './random';
import { CHOICE } from './random';

/**
 * Mods that sample what is heard (see Mods som samplar det som hörs): the
 * generator's part. Pure, like generate: it says what is played where, as
 * splices of what is heard, and render makes sound of them.
 *
 * What is heard is the song as it sounds with step mods, reverb and delay,
 * and tape: one long recording on the song's timeline. An audio mod never
 * hears itself or another audio mod: every splice reads that recording.
 */

/**
 * A splice: for `length` seconds from `time` it is heard instead of what is
 * heard there, playing what is heard from position `source(u)`, u going from 0
 * to 1 over the splice. The pitch follows the speed, like a record; with
 * grains the pitch is kept: grains of `length` seconds at 1× read where
 * `source` points, each moved by its offset (seconds). Render fades every
 * splice in and out over SPLICE_FADE at its edges, so splices next to each
 * other cross-fade.
 */
export interface Splice {
  readonly time: number;
  readonly length: number;
  /** Position in what is heard, seconds: s0 + s1·u + s2·u² + s3·u³. */
  readonly source: readonly [number, number, number, number];
  /** Linear: 1 as it is, 0 silent. */
  readonly gain: number;
  readonly grains: { readonly length: number; readonly offsets: readonly number[] } | null;
}

/** Seconds a splice fades in over at its start, and out over after its end. */
export const SPLICE_FADE = 0.003;

/** Where a splice reads at `u` (0–1 over it, or a little past either end). */
export function sourceAt(splice: Pick<Splice, 'source'>, u: number): number {
  const [a, b, c, d] = splice.source;
  return a + u * (b + u * (c + u * d));
}

/**
 * When each grain of a splice with grains starts, in seconds of the song:
 * half a grain apart, from a grain before the splice to past its fade, so the
 * Hann windows add up to 1 all over it.
 */
export function grainStarts(splice: Splice): number[] {
  if (splice.grains === null) return [];
  const hop = splice.grains.length / 2;
  const count = Math.ceil((splice.length + SPLICE_FADE) / hop) + 2;
  return Array.from({ length: count }, (_, k) => splice.time + (k - 2) * hop);
}

/** The part of a splice from song time `from` to `to`, within it: what it plays there, the same. */
export function clipSplice(splice: Splice, from: number, to: number): Splice {
  const u0 = (from - splice.time) / splice.length;
  const d = (to - from) / splice.length;
  const [, b, c, e] = splice.source;
  return {
    ...splice,
    time: from,
    length: to - from,
    source: [sourceAt(splice, u0), d * (b + 2 * c * u0 + 3 * e * u0 * u0), d * d * (c + 3 * e * u0), d * d * d * e],
  };
}

/** The audio mods in the order they win where two act at the same moment: gestures on a step, then cells, then the whole clip. (Claudes val.) */
export const AUDIO_ORDER: readonly AudioTarget[] = ['rewind', 'stutter', 'freeze', 'reverse', 'scramble', 'halftime'];

const EPSILON = 1e-9;

/** A run of song steps where one clip's mod plays a target: from `start` up to `end`. */
interface AudioWindow {
  readonly run: ModRun;
  readonly start: number;
  readonly end: number;
}

const hasTarget = (run: ModRun | null, target: AudioTarget): run is ModRun =>
  run !== null && (target === 'halftime' ? halftimeOf(run.mod) !== undefined : effectFor(run.mod, target) !== undefined);

/** Where a target plays: for each song step, B's clip if its mod has the target, else A's. A stretch of steps with the same clip is one window. */
function audioWindows(runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }, target: AudioTarget): AudioWindow[] {
  const windows: AudioWindow[] = [];
  runs.A.forEach((a, t) => {
    const b = runs.B[t] ?? null;
    const run = hasTarget(b, target) ? b : hasTarget(a, target) ? a : null;
    if (run === null) return;
    const last = windows.at(-1);
    if (last !== undefined && last.run.clip.id === run.clip.id && last.run.row === run.row && last.end === t) windows[windows.length - 1] = { ...last, end: t + 1 };
    else windows.push({ run, start: t, end: t + 1 });
  });
  return windows;
}

/** What a target's lane does at song step `t` (fractional for cells of 1/32) of its clip, or null where it does nothing. */
const laneAt = (window: AudioWindow, effect: StepEffect, dice: Dice, t: number): number | null =>
  laneValueAt(effect, clipPosition(window.run.clip, t), laneDice(dice, window.run.mod, window.run.clip, effect.target));

/** The randomness of an audio mod's choices that are not its lane (Scramble's cells, Freeze's spread): from the mod's and clip's seeds, the target and the place. */
const audioRng = (dice: Dice, window: AudioWindow, target: AudioTarget, place: number) =>
  dice(CHOICE.audio, window.run.mod.seed, window.run.clip.seed, MOD_TARGETS.indexOf(target), place);

/** Where a clip's content starts on the song's timeline, in steps: its lanes and places count from here. */
const contentStart = (clip: Clip) => clip.start - clip.offset;

/** The context every target's splices are worked out in. */
interface Song {
  readonly steps: number;
  readonly stepTime: number;
  readonly dice: Dice;
}

/** A splice from song step `a` to `b` reading linearly from step `from` to step `to`. */
const linear = (song: Song, a: number, b: number, from: number, to: number, gain = 1): Splice => ({
  time: a * song.stepTime,
  length: (b - a) * song.stepTime,
  source: [from * song.stepTime, (to - from) * song.stepTime, 0, 0],
  gain,
  grains: null,
});

/** One cell of the song's grid under a clip, as Scramble plays it (also for the picture Where each cell comes from). */
export interface ScrambleCell {
  /** Song steps it is heard on: the cell, within the clip. */
  readonly start: number;
  readonly end: number;
  /** The cell's number on the song's grid. */
  readonly cell: number;
  /** The cell it plays, or null where it plays as heard. */
  readonly from: number | null;
  readonly reversed: boolean;
}

/** The cells a target with cells cuts a window into: on the song's grid, each within the window. */
function cellsOf(window: AudioWindow, size: number): { readonly cell: number; readonly start: number; readonly end: number }[] {
  const cells = [];
  for (let k = Math.floor(window.start / size + EPSILON); k * size < window.end - EPSILON; k++) {
    const start = Math.max(window.start, k * size);
    const end = Math.min(window.end, (k + 1) * size);
    if (end - start > EPSILON) cells.push({ cell: k, start, end });
  }
  return cells;
}

/**
 * Scramble: under the clip each cell of the song's grid is swapped, with the
 * lane's chance, for a cell picked from Take from: the whole song, ± bars
 * round the clip, or inside the clip; a swapped cell plays backwards with
 * Reverse chance. Each cell rolls from the seeds and its place in the clip.
 */
export function scrambleCells(window: AudioWindow, effect: StepEffect, songSteps: number, dice: Dice): ScrambleCell[] {
  const settings = effect.scramble ?? DEFAULT_MOD_SCRAMBLE;
  const size = settings.cell;
  const { clip } = window.run;
  const songCells = Math.ceil(songSteps / size - EPSILON);
  const [from, to] =
    settings.from === 'song'
      ? [0, songCells]
      : settings.from === 'clip'
        ? [Math.floor(clip.start / size + EPSILON), Math.ceil((clip.start + clip.length) / size - EPSILON)]
        : [Math.floor((clip.start - settings.around * STEPS_PER_BAR) / size + EPSILON), Math.ceil((clip.start + clip.length + settings.around * STEPS_PER_BAR) / size - EPSILON)];
  const lo = Math.max(0, from);
  const hi = Math.max(lo + 1, Math.min(songCells, to));
  const first = Math.floor(contentStart(clip) / size + EPSILON);
  return cellsOf(window, size).map(({ cell, start, end }) => {
    const rng = audioRng(dice, window, 'scramble', cell - first);
    const chance = laneAt(window, effect, dice, start) ?? 0;
    if (rng() * 100 >= chance) return { start, end, cell, from: null, reversed: false };
    const picked = lo + Math.min(hi - lo - 1, Math.floor(rng() * (hi - lo)));
    return { start, end, cell, from: picked, reversed: rng() * 100 < settings.reverse };
  });
}

function scrambleSplices(song: Song, window: AudioWindow, effect: StepEffect): Splice[] {
  const size = (effect.scramble ?? DEFAULT_MOD_SCRAMBLE).cell;
  return scrambleCells(window, effect, song.steps, song.dice).flatMap(({ start, end, cell, from, reversed }) => {
    if (from === null) return [];
    // A cell cut by the clip's edge plays the same part of the cell it takes.
    const into = start - cell * size;
    const at = from * size + (reversed ? size - into : into);
    return [linear(song, start, end, at, reversed ? at - (end - start) : at + (end - start))];
  });
}

/** Reverse: the cells where the lane is on play backwards, each in its place. */
function reverseSplices(song: Song, window: AudioWindow, effect: StepEffect): Splice[] {
  const size = (effect.reverse ?? DEFAULT_MOD_REVERSE).cell;
  return cellsOf(window, size).flatMap(({ start, end }) => ((laneAt(window, effect, song.dice, start) ?? 0) >= 0.5 ? [linear(song, start, end, end, start)] : []));
}

/** The lane's steps within a window, each from where it starts to where it ends (in song steps), with its value. */
function laneSteps(window: AudioWindow, effect: StepEffect, dice: Dice): { readonly start: number; readonly end: number; readonly value: number | null }[] {
  const size = STEP_SIZES[effect.step];
  const origin = contentStart(window.run.clip);
  const steps = [];
  for (let j = Math.floor((window.start - origin) / size); origin + j * size < window.end; j++) {
    const start = Math.max(window.start, origin + j * size);
    const end = Math.min(window.end, origin + (j + 1) * size);
    if (end > start) steps.push({ start, end, value: laneAt(window, effect, dice, start) });
  }
  return steps;
}

/**
 * Stutter: on a step with a repeat of 1/16, 1/32 or 1/64, the start of the
 * Grabs window it is in (on the song's grid) plays again and again, each
 * repeat as long as the step's value. Repeat n in a Grabs window is n · Pitch
 * per repeat semitones off, and is heard for Gate of its length; the rest of it
 * is silent. (Claudes val.)
 */
function stutterSplices(song: Song, window: AudioWindow, effect: StepEffect): Splice[] {
  const { grabs, pitch, gate } = effect.stutter ?? DEFAULT_MOD_STUTTER;
  const out: Splice[] = [];
  const counts = new Map<number, number>();
  for (const step of laneSteps(window, effect, song.dice)) {
    const choice = Math.round(step.value ?? 0);
    if (choice <= 0) continue;
    const repeat = 2 ** (1 - Math.min(3, choice));
    // Repeats keep time with the Grabs window, so a step in the middle of it carries on its repeats.
    for (let t = step.start; t < step.end - EPSILON; ) {
      const grab = Math.floor(t / grabs + EPSILON) * grabs;
      const begins = grab + Math.floor((t - grab) / repeat + EPSILON) * repeat;
      const ends = Math.min(begins + repeat, step.end, grab + grabs);
      const n = counts.get(grab) ?? 0;
      counts.set(grab, n + 1);
      const rate = 2 ** ((n * pitch) / 12);
      const heard = Math.min(ends, begins + (repeat * gate) / 100);
      const into = t - begins;
      if (heard > t + EPSILON) out.push(linear(song, t, heard, grab + into * rate, grab + (heard - begins) * rate));
      if (ends > Math.max(t, heard) + EPSILON) out.push(linear(song, Math.max(t, heard), ends, grab, grab, 0));
      t = ends;
    }
  }
  return out;
}

/**
 * Freeze: a run of on steps holds a grain of what is heard where the run
 * starts, as a tone: grains of Grain length read there over and over, each
 * moved by up to Spread of a grain either way, from the seeds. (Claudes val.)
 */
function freezeSplices(song: Song, window: AudioWindow, effect: StepEffect): Splice[] {
  const { grain, spread, level } = effect.freeze ?? DEFAULT_MOD_FREEZE;
  const runs: { start: number; end: number }[] = [];
  for (const step of laneSteps(window, effect, song.dice)) {
    if ((step.value ?? 0) < 0.5) continue;
    const last = runs.at(-1);
    if (last !== undefined && Math.abs(last.end - step.start) < EPSILON) last.end = step.end;
    else runs.push({ start: step.start, end: step.end });
  }
  return runs.map(({ start, end }) => {
    const splice: Splice = { ...linear(song, start, end, start, start, 10 ** (level / 20)), grains: { length: grain / 1000, offsets: [] } };
    const rng = audioRng(song.dice, window, 'freeze', Math.round((start - contentStart(window.run.clip)) * 4));
    const width = (spread / 100) * (grain / 1000);
    return { ...splice, grains: { length: grain / 1000, offsets: grainStarts(splice).map(() => (spread === 0 ? 0 : (rng() * 2 - 1) * width)) } };
  });
}

/**
 * Rewind: on a step where it fires, what was heard is pulled back by Pulls
 * back over the step, like tape wound back. Fast at an even speed; Slowing
 * fast at first, coming to a stop at the end; Spin-back braking from playing,
 * turning and spinning back faster and faster. (Claudes val.)
 */
function rewindSplices(song: Song, window: AudioWindow, effect: StepEffect): Splice[] {
  const { pullBack, curve } = effect.rewind ?? DEFAULT_MOD_REWIND;
  return laneSteps(window, effect, song.dice).flatMap((step): Splice[] => {
    if ((step.value ?? 0) < 0.5) return [];
    const t0 = step.start * song.stepTime;
    const length = (step.end - step.start) * song.stepTime;
    const back = pullBack * song.stepTime;
    const source: Splice['source'] =
      curve === 'fast' ? [t0, -back, 0, 0] : curve === 'slowing' ? [t0, -2 * back, back, 0] : [t0, length, 0, -(length + back)];
    return [{ time: t0, length, source, gain: 1, grains: null }];
  });
}

/**
 * Halftime: what is heard under the whole clip, at its speed from where the
 * clip starts on the timeline (what you see is what you hear). The pitch
 * follows like a record, or with Keep pitch is kept, as grains of DEFAULT_GRAIN.
 */
function halftimeSplices(song: Song, window: AudioWindow, effect: HalftimeEffect): Splice[] {
  const start = window.run.clip.start;
  const read = (t: number) => start + effect.speed * (t - start);
  const splice = linear(song, window.start, window.end, read(window.start), read(window.end));
  return [effect.keepPitch ? { ...splice, grains: { length: DEFAULT_GRAIN / 1000, offsets: [0] } } : splice];
}

function targetSplices(song: Song, window: AudioWindow, target: AudioTarget): Splice[] {
  if (target === 'halftime') return halftimeSplices(song, window, halftimeOf(window.run.mod)!);
  const effect = effectFor(window.run.mod, target)!;
  switch (target) {
    case 'scramble':
      return scrambleSplices(song, window, effect);
    case 'stutter':
      return stutterSplices(song, window, effect);
    case 'freeze':
      return freezeSplices(song, window, effect);
    case 'reverse':
      return reverseSplices(song, window, effect);
    case 'rewind':
      return rewindSplices(song, window, effect);
  }
}

/** Intervals of song time, sorted and apart. */
type Spans = { start: number; end: number }[];

/** `splice` without the time `taken` already has: the parts of it left, each playing what it played there. */
function without(splice: Splice, taken: Spans): Splice[] {
  const parts: Splice[] = [];
  let from = splice.time;
  const end = splice.time + splice.length;
  for (const span of taken) {
    if (span.end <= from + EPSILON) continue;
    if (span.start >= end - EPSILON) break;
    if (span.start > from + EPSILON) parts.push(clipSplice(splice, from, span.start));
    from = Math.max(from, span.end);
  }
  if (end > from + EPSILON) parts.push(from === splice.time ? splice : clipSplice(splice, from, end));
  return parts;
}

function take(taken: Spans, splices: readonly Splice[]): Spans {
  const all = [...taken, ...splices.map((s) => ({ start: s.time, end: s.time + s.length }))].sort((a, b) => a.start - b.start);
  const merged: Spans = [];
  for (const span of all) {
    const last = merged.at(-1);
    if (last !== undefined && span.start <= last.end + EPSILON) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Every splice the audio mods play in the song, in time order. Each target
 * plays under its clips (B's where both rows have it); where several act at
 * the same moment, the first in AUDIO_ORDER is heard. Where none acts, what is
 * heard is heard; after a clip, the song goes on on the main clock.
 */
export function audioSplices(project: Project, runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }, dice: Dice): Splice[] {
  const song: Song = { steps: project.song.bars * STEPS_PER_BAR, stepTime: stepDuration(project.song.bpm), dice };
  let taken: Spans = [];
  const out: Splice[] = [];
  for (const target of AUDIO_ORDER) {
    const mine = audioWindows(runs, target).flatMap((window) => targetSplices(song, window, target).flatMap((s) => without(s, taken)));
    out.push(...mine);
    taken = take(taken, mine);
  }
  return out.filter((s) => s.length > EPSILON).sort((a, b) => a.time - b.time);
}

export { audioWindows, type AudioWindow };
