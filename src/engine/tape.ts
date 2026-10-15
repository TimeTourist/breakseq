import type { Clip, Mod, Project, TapeDirection, TapeEffect } from '../model';
import { stepDuration, tapeOf } from '../model';
import type { Trigger } from './generate';
import type { ModRun } from './mods';

/**
 * A stretch of song where a mod's Tape plays instead of the song. It plays a
 * recording of the segment from the clip's start, round and round, at a speed
 * changing linearly from `speed.start` at `time` to `speed.end` at `end`.
 */
export interface Tape {
  /** Seconds from the start of the song. */
  readonly time: number;
  readonly end: number;
  /** What the segment played, with times from the segment's start. */
  readonly source: readonly Trigger[];
  /** The segment's length in seconds. */
  readonly length: number;
  readonly direction: TapeDirection;
  readonly speed: { readonly start: number; readonly end: number };
  /** Seconds of tape already played at `time`: more than 0 when the clip's start is trimmed. */
  readonly position: number;
}

/** One time round the segment. */
export interface TapePass {
  readonly time: number;
  readonly end: number;
  readonly direction: 'forward' | 'reverse';
  /** How far into the pass it starts, in seconds of recording: more than 0 only for a tape started part way. */
  readonly from: number;
  readonly speedStart: number;
  readonly speedEnd: number;
}

/** Passes are capped so a very short segment at high speed cannot run away. */
const MAX_PASSES = 4096;
const EPSILON = 1e-9;

/**
 * The passes a tape makes. Speed is linear in time, so the position on the tape
 * is p(t) = position + s0·t + (s1 − s0)·t² / 2T. A pass ends where p reaches the
 * next multiple of the segment's length. At speed 0 no new pass is reached.
 */
export function tapePasses(tape: Tape): TapePass[] {
  const duration = tape.end - tape.time;
  const { length } = tape;
  if (duration <= 0 || length <= 0) return [];
  const s0 = tape.speed.start;
  const s1 = tape.speed.end;
  const a = (s1 - s0) / (2 * duration);
  const at = (t: number) => tape.position + s0 * t + a * t * t;
  const speedAt = (t: number) => s0 + ((s1 - s0) * t) / duration;

  /** The first time from `after` at which the tape reaches `target`, or null if never within the tape. */
  const reach = (target: number, after: number): number | null => {
    const c = tape.position - target;
    if (Math.abs(a) < EPSILON) return s0 > EPSILON ? -c / s0 : null;
    const disc = s0 * s0 - 4 * a * c;
    if (disc < 0) return null;
    const roots = [(-s0 - Math.sqrt(disc)) / (2 * a), (-s0 + Math.sqrt(disc)) / (2 * a)].filter((r) => r > after + EPSILON).sort((x, y) => x - y);
    return roots[0] ?? null;
  };

  const passes: TapePass[] = [];
  let t = 0;
  let index = Math.floor(tape.position / length + EPSILON);
  while (t < duration - EPSILON && passes.length < MAX_PASSES) {
    const reached = reach((index + 1) * length, t);
    const end = reached === null ? duration : Math.min(duration, reached);
    const direction = tape.direction === 'reverse' || (tape.direction === 'pingpong' && index % 2 === 1) ? 'reverse' : 'forward';
    passes.push({
      time: tape.time + t,
      end: tape.time + end,
      direction,
      from: Math.max(0, Math.min(length, at(t) - index * length)),
      speedStart: speedAt(t),
      speedEnd: speedAt(end),
    });
    t = end;
    index++;
  }
  return passes;
}

/** A tape run over song steps: the clip and its tape, where it plays. */
export interface TapeWindow {
  readonly clip: Clip;
  readonly tape: TapeEffect;
  /** Song steps it plays over: from `start` up to `end`. */
  readonly start: number;
  readonly end: number;
}

/**
 * Where tapes play: for each song step, B's mod if it has Tape, else A's. A
 * stretch of steps with the same clip is one window.
 */
export function tapeWindows(runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }): TapeWindow[] {
  const withTape = (run: ModRun | null) => (run !== null && tapeOf(run.mod) !== undefined ? run : null);
  const windows: TapeWindow[] = [];
  runs.A.forEach((a, t) => {
    const run = withTape(runs.B[t] ?? null) ?? withTape(a);
    const last = windows.at(-1);
    if (run === null) return;
    if (last !== undefined && last.clip.id === run.clip.id && last.end === t) {
      windows[windows.length - 1] = { ...last, end: t + 1 };
    } else {
      windows.push({ clip: run.clip, tape: tapeOf(run.mod as Mod)!, start: t, end: t + 1 });
    }
  });
  return windows;
}

/**
 * Turns a window into a tape over what was heard. The segment starts where the
 * clip's content starts (its start less its trimmed offset), and the speed
 * ramps over the clip's whole content, so a trimmed clip starts part way.
 */
export function windowTape(project: Project, window: TapeWindow, heard: readonly Trigger[]): Tape {
  const stepTime = stepDuration(project.song.bpm);
  const { clip, tape } = window;
  const contentStart = Math.max(0, clip.start - clip.offset) * stepTime;
  const contentLength = (clip.offset + clip.length) * stepTime;
  const length = tape.length * stepTime;
  const speedAt = (time: number) => tape.speed.from + ((tape.speed.to - tape.speed.from) * (time - contentStart)) / contentLength;
  const time = window.start * stepTime;
  const end = window.end * stepTime;
  const elapsed = time - contentStart;
  return {
    time,
    end,
    source: heard
      .filter((trigger) => trigger.time >= contentStart - EPSILON && trigger.time < contentStart + length - EPSILON)
      .map((trigger) => ({ ...trigger, time: trigger.time - contentStart })),
    length,
    direction: tape.direction,
    speed: { start: speedAt(time), end: speedAt(end) },
    // The integral of the speed from the content's start to here.
    position: elapsed * (tape.speed.from + (speedAt(time) - tape.speed.from) / 2),
  };
}
