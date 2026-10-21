import type { Clip, Mod, Project, Rng, TapeCurve, TapeDirection, TapeEffect } from '../model';
import type { Dice } from './random';
import { CHOICE } from './random';
import { stepDuration, tapeOf } from '../model';
import type { Trigger } from './generate';
import type { ModRun } from './mods';

/** One sine in the wobble on a tape's speed: depth is a fraction of the speed. */
export interface Wobble {
  readonly frequency: number;
  readonly phase: number;
  readonly depth: number;
}

/**
 * A stretch of song where a mod's Tape plays instead of the song. It plays a
 * recording of the segment from the clip's start, round and round, at a speed
 * that ramps from `speed.from` to `speed.to` and wobbles with wow and flutter.
 */
export interface Tape {
  /** Seconds from the start of the song where it is heard. */
  readonly time: number;
  readonly end: number;
  /** Where its clip starts: the speed and the tape's position count from here. At or before `time`. */
  readonly start: number;
  /** What the segment played, with times from the segment's start. */
  readonly source: readonly Trigger[];
  /** The segment's length in seconds. */
  readonly length: number;
  readonly direction: TapeDirection;
  readonly speed: {
    readonly from: number;
    readonly to: number;
    /** Seconds from `start` the ramp takes; then it holds `to`. */
    readonly ramp: number;
    readonly curve: TapeCurve;
  };
  readonly wobble: readonly Wobble[];
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

/** The grid the speed is sampled on, in seconds. Web Audio interpolates value curves linearly in between. */
export const TAPE_GRID = 0.001;
/** Passes are capped so a very short segment at high speed cannot run away. */
const MAX_PASSES = 4096;
const EPSILON = 1e-9;

/** Where along the ramp the speed is at `u` (0–1) of its time. */
const CURVES: Record<TapeCurve, (u: number) => number> = {
  linear: (u) => u,
  softStart: (u) => u ** 2,
  softEnd: (u) => 1 - (1 - u) ** 2,
  // Most of the change at once, then easing into the end value.
  hardStart: (u) => 1 - (1 - u) ** 4,
  // Holding on, then all of the change at the very end.
  hardEnd: (u) => u ** 4,
};

const shaped = (curve: TapeCurve, u: number) => CURVES[curve](u);

/** The tape's speed at song time `t`: the ramp, times the wobble, never below 0. */
export function tapeSpeed(tape: Tape, t: number): number {
  const { from, to, ramp, curve } = tape.speed;
  const elapsed = t - tape.start;
  const u = ramp <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / ramp));
  const base = from + (to - from) * shaped(curve, u);
  const wobble = tape.wobble.reduce((sum, w) => sum + w.depth * Math.sin(2 * Math.PI * w.frequency * elapsed + w.phase), 0);
  return Math.max(0, base * (1 + wobble));
}

/** Speeds sampled evenly from `from` to `to`, both included: what a value curve plays. */
export function speedCurve(tape: Tape, from: number, to: number): Float32Array {
  const count = Math.max(2, Math.ceil((to - from) / TAPE_GRID) + 1);
  return Float32Array.from({ length: count }, (_, i) => tapeSpeed(tape, from + ((to - from) * i) / (count - 1)));
}

/**
 * The passes a tape makes. The speed is sampled every TAPE_GRID from the clip's
 * start and integrated as trapezoids, the way Web Audio plays a value curve; a
 * pass ends where the position reaches the next multiple of the segment's
 * length. At speed 0 no new pass is reached.
 */
export function tapePasses(tape: Tape): TapePass[] {
  const { length } = tape;
  if (tape.end - tape.time <= 0 || length <= 0) return [];
  const steps = Math.max(1, Math.ceil((tape.end - tape.start) / TAPE_GRID - EPSILON));
  const timeAt = (k: number) => Math.min(tape.end, tape.start + k * TAPE_GRID);

  // Position on the tape at each grid point.
  const position = new Float64Array(steps + 1);
  let previous = tapeSpeed(tape, tape.start);
  for (let k = 1; k <= steps; k++) {
    const speed = tapeSpeed(tape, timeAt(k));
    position[k] = position[k - 1]! + ((previous + speed) / 2) * (timeAt(k) - timeAt(k - 1));
    previous = speed;
  }
  /** Position at any time, between grid points by the same trapezoid rule. */
  const positionAt = (t: number) => {
    const k = Math.max(0, Math.min(steps - 1, Math.floor((t - tape.start) / TAPE_GRID + EPSILON)));
    const t0 = timeAt(k);
    return position[k]! + ((tapeSpeed(tape, t0) + tapeSpeed(tape, t)) / 2) * (t - t0);
  };
  /** The first time after `after` the position reaches `target`, or null. */
  const reach = (target: number, after: number): number | null => {
    for (let k = Math.max(1, Math.floor((after - tape.start) / TAPE_GRID)); k <= steps; k++) {
      if (position[k]! < target - EPSILON) continue;
      // Within one grid step the speed is close to linear: interpolate.
      const t0 = timeAt(k - 1);
      const p0 = position[k - 1]!;
      const t1 = timeAt(k);
      const p1 = position[k]!;
      const t = p1 - p0 <= EPSILON ? t1 : t0 + ((target - p0) / (p1 - p0)) * (t1 - t0);
      if (t > after + EPSILON) return t;
    }
    return null;
  };

  const passes: TapePass[] = [];
  let t = tape.time;
  let index = Math.floor(positionAt(t) / length + EPSILON);
  while (t < tape.end - EPSILON && passes.length < MAX_PASSES) {
    const reached = reach((index + 1) * length, t);
    const end = reached === null ? tape.end : Math.min(tape.end, reached);
    const direction = tape.direction === 'reverse' || (tape.direction === 'pingpong' && index % 2 === 1) ? 'reverse' : 'forward';
    passes.push({
      time: t,
      end,
      direction,
      from: Math.max(0, Math.min(length, positionAt(t) - index * length)),
      speedStart: tapeSpeed(tape, t),
      speedEnd: tapeSpeed(tape, end),
    });
    t = end;
    index++;
  }
  return passes;
}

/** A tape run over song steps: the clip and its tape, where it plays. */
export interface TapeWindow {
  readonly clip: Clip;
  /** The mod with the tape: its seed gives wow and flutter. */
  readonly mod: Mod;
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
      windows.push({ clip: run.clip, mod: run.mod, tape: tapeOf(run.mod)!, start: t, end: t + 1 });
    }
  });
  return windows;
}

/** Wow: two slow sines; flutter: three fast ones. Depths at 100 %, split between the sines by weight. */
const WOW = { depth: 0.25, frequencies: [0.5, 1], weights: [0.7, 0.3] };
const FLUTTER = { depth: 0.06, frequencies: [6, 15], weights: [0.5, 0.3, 0.2] };

/** Sines for wow and flutter, with frequencies and phases drawn from `rng`. */
export function wobbles(tape: Pick<TapeEffect, 'wow' | 'flutter'>, rng: Rng): Wobble[] {
  const make = (amount: number, kind: typeof WOW) =>
    amount <= 0
      ? []
      : kind.weights.map((weight) => ({
          frequency: kind.frequencies[0]! + rng() * (kind.frequencies[1]! - kind.frequencies[0]!),
          phase: rng() * 2 * Math.PI,
          depth: amount * kind.depth * weight,
        }));
  return [...make(tape.wow, WOW), ...make(tape.flutter, FLUTTER)];
}

/**
 * Turns a window into a tape over what was heard. What you see is what you
 * hear: the segment starts where the clip starts on the timeline, even when its
 * start was trimmed, and the speed ramps from there. Wow and flutter come from
 * the mod's and the clip's seeds and where in the clip the window starts.
 */
export function windowTape(project: Project, window: TapeWindow, heard: readonly Trigger[], dice: Dice): Tape {
  const stepTime = stepDuration(project.song.bpm);
  const { clip, tape } = window;
  const start = clip.start * stepTime;
  const length = tape.length * stepTime;
  return {
    time: window.start * stepTime,
    end: window.end * stepTime,
    start,
    source: heard
      .filter((trigger) => trigger.time >= start - EPSILON && trigger.time < start + length - EPSILON)
      .map((trigger) => ({ ...trigger, time: trigger.time - start })),
    length,
    direction: tape.direction,
    speed: { from: tape.speed.from, to: tape.speed.to, ramp: (tape.rampOver ?? clip.length) * stepTime, curve: tape.curve },
    wobble: wobbles(tape, dice(CHOICE.tape, window.mod.seed, clip.seed, window.start - clip.start)),
  };
}
