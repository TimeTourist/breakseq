import type { Chance, LaneStep, LaneTarget, Rng, StepEffect } from './types';
import {
  CHANCES,
  DEFAULT_MOD_DELAY,
  DEFAULT_MOD_DIST,
  DEFAULT_MOD_FREEZE,
  DEFAULT_MOD_REVERB,
  DEFAULT_MOD_REVERSE,
  DEFAULT_MOD_REWIND,
  DEFAULT_MOD_SCRAMBLE,
  DEFAULT_MOD_STRETCH,
  DEFAULT_MOD_STUTTER,
  MAX_LANE_STEPS,
  isDice,
} from './types';

/**
 * Step lanes (see Stegrader): what a lane holds for each target, and the
 * drawing tools. Pure: randomness is injected.
 */

/** How a target's lane draws: its range (when drawing in a mod; a hit keeps its own), zero value and unit. */
export interface LaneRange {
  readonly min: number;
  readonly max: number;
  /** What the target does nothing at; Clear sets every step to it. */
  readonly zero: number;
  /** What a drawn value is rounded to; log lanes round by size (see quantize). */
  readonly step: number;
  /** Drawn on a log scale: Stretch and Filter cutoff. */
  readonly log?: true;
  /** Bars grow from the zero line, up or down: Pitch and Pan. */
  readonly bipolar?: true;
  /** On or off per step: Direction. */
  readonly onOff?: true;
  /** dB, st, Hz, %, ×, … */
  readonly unit: string;
}

export const LANES: Readonly<Record<LaneTarget, LaneRange>> = {
  pitch: { min: -24, max: 24, zero: 0, step: 1, bipolar: true, unit: 'st' },
  volume: { min: -24, max: 6, zero: 0, step: 1, unit: 'dB' },
  pan: { min: -100, max: 100, zero: 0, step: 5, bipolar: true, unit: '%' },
  ratchet: { min: 1, max: 8, zero: 1, step: 1, unit: '×' },
  padMember: { min: 1, max: 8, zero: 1, step: 1, unit: 'member' },
  direction: { min: 0, max: 1, zero: 0, step: 1, onOff: true, unit: 'on/off' },
  stretch: { min: 0.25, max: 4, zero: 1, step: 0.01, log: true, unit: '×' },
  dist: { min: 0, max: 100, zero: 0, step: 5, unit: '%' },
  filter: { min: 60, max: 18000, zero: 18000, step: 10, log: true, unit: 'Hz' },
  reverb: { min: 0, max: 100, zero: 0, step: 5, unit: '%' },
  delay: { min: 0, max: 100, zero: 0, step: 5, unit: '%' },
  // The audio mods (see Mods som samplar det som hörs): Scramble's value is the chance a cell is swapped,
  // Stutter's the repeat (0 off, 1 1/16, 2 1/32, 3 1/64), and the rest on or off.
  scramble: { min: 0, max: 100, zero: 0, step: 5, unit: '% swap' },
  stutter: { min: 0, max: 3, zero: 0, step: 1, unit: 'repeat' },
  freeze: { min: 0, max: 1, zero: 0, step: 1, onOff: true, unit: 'on/off' },
  reverse: { min: 0, max: 1, zero: 0, step: 1, onOff: true, unit: 'on/off' },
  rewind: { min: 0, max: 1, zero: 0, step: 1, onOff: true, unit: 'fires' },
};

/** Free pitch is drawn in tenths of a semitone. (Claudes val.) */
const FREE_PITCH_STEP = 0.1;

/** Whether a lane's values are whole semitones: Pitch unless set to Free. */
export const semitones = (effect: Pick<StepEffect, 'target' | 'pitch'>): boolean => effect.target !== 'pitch' || effect.pitch?.values !== 'free';

/** Whether a target's values, and its dice rolls, are whole numbers. */
export const wholeValues = (effect: Pick<StepEffect, 'target' | 'pitch'>): boolean =>
  effect.target === 'ratchet' ||
  effect.target === 'padMember' ||
  effect.target === 'stutter' ||
  LANES[effect.target].onOff === true ||
  (effect.target === 'pitch' && semitones(effect));

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** `x` kept within the target's range. */
export const clampToLane = (target: LaneTarget, x: number): number => clamp(Number.isFinite(x) ? x : LANES[target].zero, LANES[target].min, LANES[target].max);

/** A value as it is drawn: within the range, rounded to the lane's step (Filter to 10 Hz below 1 kHz and 100 Hz above). */
export function quantize(effect: Pick<StepEffect, 'target' | 'pitch'>, x: number): number {
  const range = LANES[effect.target];
  const v = clampToLane(effect.target, x);
  const step = effect.target === 'filter' ? (v < 1000 ? 10 : 100) : effect.target === 'pitch' && !semitones(effect) ? FREE_PITCH_STEP : range.step;
  // Round to the step, and get rid of float noise such as 0.30000000000000004.
  return clamp(Number((Math.round(v / step) * step).toFixed(6)), range.min, range.max);
}

/** Where `x` is in the target's range, 0–1 (log for log lanes). */
export function norm(target: LaneTarget, x: number): number {
  const { min, max, log } = LANES[target];
  const v = clampToLane(target, x);
  return log === true ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
}

/** The value at `n` (0–1) of the range, as drawn. */
export function denorm(effect: Pick<StepEffect, 'target' | 'pitch'>, n: number): number {
  const { min, max, log } = LANES[effect.target];
  const u = clamp(n, 0, 1);
  return quantize(effect, log === true ? min * (max / min) ** u : min + u * (max - min));
}

/** The zero value of a target: what it does nothing at. */
export const zeroOf = (target: LaneTarget): number => LANES[target].zero;

/** What a new effect's steps are: the zero value, except Reverb (100) and Delay (80), which are throws, and Scramble (50). */
const NEW_VALUE: Partial<Record<LaneTarget, number>> = { reverb: 100, delay: 80, scramble: 50 };

/** Each target's own settings in a new effect. */
const NEW_SETTINGS: Partial<Record<LaneTarget, Partial<StepEffect>>> = {
  pitch: { pitch: { values: 'semitones' } },
  filter: { filter: { type: 'lowpass', resonance: 0.3 } },
  dist: { dist: DEFAULT_MOD_DIST },
  stretch: { stretch: DEFAULT_MOD_STRETCH },
  reverb: { reverb: DEFAULT_MOD_REVERB },
  delay: { delay: DEFAULT_MOD_DELAY },
  scramble: { scramble: DEFAULT_MOD_SCRAMBLE },
  stutter: { stutter: DEFAULT_MOD_STUTTER },
  freeze: { freeze: DEFAULT_MOD_FREEZE },
  reverse: { reverse: DEFAULT_MOD_REVERSE },
  rewind: { rewind: DEFAULT_MOD_REWIND },
};

/** A new step effect: 4 steps of a beat, each at the zero value (Reverb 100, Delay 80, Scramble 50), with the target's own settings. */
export function newStepEffect(target: LaneTarget): StepEffect {
  const v = NEW_VALUE[target] ?? zeroOf(target);
  const lane = Array.from({ length: 4 }, () => ({ v }));
  const own = NEW_SETTINGS[target] ?? {};
  return { target, step: 'beat', lane, ...own };
}

/** Steps `from` to `to` (either order) painted with `v`; dice steps are not painted over. */
export function paintSteps(lane: readonly LaneStep[], from: number, to: number, v: number): LaneStep[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return lane.map((s, i) => (i >= a && i <= b && !isDice(s) ? { v } : s));
}

/** The edge of a dice step's band nearer to `v`. */
export function nearerEdge(target: LaneTarget, step: Extract<LaneStep, { lo: number }>, v: number): 'lo' | 'hi' {
  const n = norm(target, v);
  return Math.abs(n - norm(target, step.lo)) <= Math.abs(n - norm(target, step.hi)) ? 'lo' : 'hi';
}

/** A dice step's band with one edge moved to `v`; it never crosses the other edge. */
export function moveEdge(lane: readonly LaneStep[], i: number, edge: 'lo' | 'hi', v: number): LaneStep[] {
  return lane.map((s, k) => {
    if (k !== i || !isDice(s)) return s;
    return edge === 'lo' ? { ...s, lo: Math.min(v, s.hi) } : { ...s, hi: Math.max(v, s.lo) };
  });
}

/**
 * Step `i` made a dice step (a band of ±15 % of the range round its value,
 * chance 100; on an on/off lane 0–1 and 50 %; on Stutter one choice either
 * side), or a dice step fixed again in the middle of its band.
 */
export function toggleDice(effect: StepEffect, i: number): LaneStep[] {
  const range = LANES[effect.target];
  return effect.lane.map((s, k) => {
    if (k !== i) return s;
    if (isDice(s)) return { v: quantize(effect, (s.lo + s.hi) / 2) };
    if (range.onOff === true) return { lo: 0, hi: 1, chance: 50 };
    // Stutter's few choices: one either side, as the sketch.
    if (effect.target === 'stutter') return { lo: clamp(s.v - 1, range.min, range.max), hi: clamp(s.v + 1, range.min, range.max), chance: 100 };
    const n = norm(effect.target, s.v);
    return { lo: denorm(effect, n - 0.15), hi: denorm(effect, n + 0.15), chance: 100 };
  });
}

/** The next chance down: 100, 75, 50, 25, then 100 again. */
export const nextChance = (chance: Chance): Chance => CHANCES[(CHANCES.indexOf(chance) + 1) % CHANCES.length]!;

/** Step `i`'s chance, if it is a dice step, one further round 100, 75, 50, 25. */
export const cycleChance = (lane: readonly LaneStep[], i: number): LaneStep[] =>
  lane.map((s, k) => (k === i && isDice(s) ? { ...s, chance: nextChance(s.chance) } : s));

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;

/**
 * Randomize: every step a random fixed value, as if drawn; with `dice`, a
 * dice step with a band of 15–40 % of the range and a chance of 100, 75 or 50
 * % (on/off lanes 75, 50 or 25 %). What it rolls is kept as the steps' values.
 */
export function randomizeLane(effect: StepEffect, rng: Rng, dice: boolean): LaneStep[] {
  const onOff = LANES[effect.target].onOff === true;
  return effect.lane.map((): LaneStep => {
    if (!dice) return { v: denorm(effect, rng()) };
    if (onOff) return { lo: 0, hi: 1, chance: pick(rng, [75, 50, 25] as const) };
    const centre = rng();
    const width = 0.15 + rng() * 0.25;
    return { lo: denorm(effect, centre - width / 2), hi: denorm(effect, centre + width / 2), chance: pick(rng, [100, 75, 50] as const) };
  });
}

/** Whether a lane has a slope to ramp: not an on/off lane. */
export const canRamp = (target: LaneTarget): boolean => LANES[target].onOff !== true;

/**
 * Whether the next Ramp goes up: it does, unless the lane already is a line
 * going up (fixed steps, never lower than the one before, the last above the
 * first). So each press turns it round. (Claudes val: worked out from the lane,
 * so Undo and other changes keep it right.)
 */
export function rampsUp(effect: StepEffect): boolean {
  const values = effect.lane.map((s) => (isDice(s) ? null : s.v));
  if (values.length < 2 || values.some((v) => v === null)) return true;
  const vs = values as number[];
  const rising = vs.every((v, i) => i === 0 || v >= vs[i - 1]!) && vs[vs.length - 1]! > vs[0]!;
  return !rising;
}

/**
 * Ramp: a straight line over the steps from the lane's lowest value to its
 * highest (up) or the other way (down), in fixed steps. All values the same:
 * the whole range. Fewer than 2 steps: nothing changes.
 */
export function rampLane(effect: StepEffect, up: boolean): LaneStep[] {
  const n = effect.lane.length;
  if (n < 2 || !canRamp(effect.target)) return [...effect.lane];
  const ns = effect.lane.flatMap((s) => (isDice(s) ? [norm(effect.target, s.lo), norm(effect.target, s.hi)] : [norm(effect.target, s.v)]));
  let lo = Math.min(...ns);
  let hi = Math.max(...ns);
  if (hi - lo < 1e-6) {
    lo = 0;
    hi = 1;
  }
  const [a, b] = up ? [lo, hi] : [hi, lo];
  return effect.lane.map((_, k) => ({ v: denorm(effect, a + ((b - a) * k) / (n - 1)) }));
}

/** Clear: every step at the target's zero value, fixed. */
export const clearLane = (effect: StepEffect): LaneStep[] => effect.lane.map(() => ({ v: zeroOf(effect.target) }));

/** The lane `n` steps long (1–16): shorter drops from the end, longer adds copies of the last step. */
export function setLaneLength(lane: readonly LaneStep[], n: number): LaneStep[] {
  const count = clamp(Math.round(n), 1, MAX_LANE_STEPS);
  const last = lane[lane.length - 1] ?? { v: 0 };
  return count <= lane.length ? lane.slice(0, count) : [...lane, ...Array.from({ length: count - lane.length }, () => ({ ...last }))];
}

/** In turn (Pad member): 1, 2, 3 … up to `members` (1–8). */
export const inTurn = (members: number): LaneStep[] =>
  Array.from({ length: clamp(Math.round(members), 1, LANES.padMember.max) }, (_, i) => ({ v: i + 1 }));

/** What is wrong with a lane, or null: 1–16 steps, values within range, bands not upside down, chances 100/75/50/25. */
export function laneProblem(effect: StepEffect): string | null {
  const { lane, target } = effect;
  if (!Array.isArray(lane) || lane.length < 1 || lane.length > MAX_LANE_STEPS) return 'A lane has 1 to 16 steps';
  const range = LANES[target];
  if (range === undefined) return `${String(target)} has no lane`;
  const within = (x: number) => Number.isFinite(x) && x >= range.min - 1e-9 && x <= range.max + 1e-9;
  for (const s of lane) {
    if (isDice(s)) {
      if (!within(s.lo) || !within(s.hi) || s.lo > s.hi) return 'A dice step is a band within the lane’s range';
      if (!(CHANCES as readonly number[]).includes(s.chance)) return 'A dice step’s chance is 100, 75, 50 or 25 %';
    } else if (!within(s.v)) return 'A step’s value is within the lane’s range';
  }
  return null;
}
