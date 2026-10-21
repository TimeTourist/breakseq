import type { FaderCell, Rng, ScratchEffect, ScratchRecord } from './types';
import { MAX_LANE_STEPS, MIN_SCRATCH_STEPS, SCRATCH_RECORDS, STEP_SIZES } from './types';

/**
 * Scratch (see Scratch): the needle and the crossfader, and the drawing tools
 * on its card. Pure: randomness is injected.
 */

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Slower than this (× the recording's speed) the record is held still, and silent. */
export const HELD_SPEED = 0.05;

/** A needle position as drawn: within 0–1, in steps of half a 1/16 of the recording. */
export const snapPoint = (record: ScratchRecord, p: number): number => {
  const k = record * 2;
  return Math.round(clamp(Number.isFinite(p) ? p : 0, 0, 1) * k) / k;
};

/** Where the needle is at the end of the last step: it carries on at the speed it arrived with, within the recording. */
export const scratchEnd = (points: readonly number[]): number => {
  const n = points.length;
  return n < 2 ? (points[0] ?? 0) : clamp(2 * points[n - 1]! - points[n - 2]!, 0, 1);
};

/** Each step's speed, × the recording's: how far the needle goes in the step, from one point to the next. */
export function scratchSpeeds(effect: Pick<ScratchEffect, 'points' | 'record' | 'step'>): number[] {
  const to = [...effect.points.slice(1), scratchEnd(effect.points)];
  const size = STEP_SIZES[effect.step];
  return effect.points.map((p, i) => ((to[i]! - p) * effect.record) / size);
}

export type ScratchMotion = 'forward' | 'backward' | 'held';
export const scratchMotion = (speed: number): ScratchMotion => (Math.abs(speed) < HELD_SPEED ? 'held' : speed > 0 ? 'forward' : 'backward');

/** A step's curve: the needle's position at u (0–1 over the step) is c0 + c1·u + c2·u² + c3·u³. */
export type ScratchCurve = readonly [number, number, number, number];

export const scratchPosition = (c: ScratchCurve, u: number): number => c[0] + u * (c[1] + u * (c[2] + u * c[3]));

/**
 * Step `j`'s curve: Catmull-Rom through the points, so the needle moves
 * smoothly from one to the next. The last step goes to where it carries on to
 * (scratchEnd). Before the first point and after the end the curve goes on
 * straight (Claudes val), so a straight line is straight to its ends and Clear
 * plays at 1× all through.
 */
export function scratchCurve(effect: Pick<ScratchEffect, 'points'>, j: number): ScratchCurve {
  const q = [...effect.points, scratchEnd(effect.points)];
  const n = q.length - 1;
  const at = (k: number): number => (k < 0 ? 2 * q[0]! - q[1]! : k > n ? 2 * q[n]! - q[n - 1]! : q[k]!);
  const p0 = at(j - 1);
  const p1 = at(j);
  const p2 = at(j + 1);
  const p3 = at(j + 2);
  const m1 = (p2 - p0) / 2;
  const m2 = (p3 - p1) / 2;
  return [p1, m1, -3 * p1 + 3 * p2 - 2 * m1 - m2, 2 * p1 - 2 * p2 + m1 + m2];
}

const open = (n: number): FaderCell[] => Array.from({ length: n }, () => [true] as const);

/** The presets under Start from, like a scratch DJ: each a hand movement with its own fader, 8 steps of 1/16. (Magnus beslut; the movements are Claudes val.) */
export const SCRATCH_PRESETS: readonly { readonly name: string; readonly does: string; readonly draw: (effect: ScratchEffect) => ScratchEffect }[] = [
  { name: 'Baby', does: 'Back and forth, the fader always open', points: [0.1, 0.25, 0.1, 0.25, 0.1, 0.25, 0.1, 0.25], fader: open(8) },
  {
    name: 'Chirp',
    does: 'A forward push and pull back; the fader opens at the start of each stroke and closes right as the record turns, so each stroke is a short chirp',
    points: [0.1, 0.18, 0.26, 0.18, 0.1, 0.18, 0.26, 0.18],
    fader: Array.from({ length: 8 }, (_, k): FaderCell => (k % 2 === 0 ? [true] : [true, false])),
  },
  {
    name: 'Transformer',
    does: 'A slow, steady push forward and back while the fader taps open and closed evenly in 1/32s',
    points: [0.1, 0.13, 0.16, 0.19, 0.22, 0.19, 0.16, 0.13],
    fader: Array.from({ length: 8 }, (): FaderCell => [true, false]),
  },
  { name: 'Tear', does: 'Forward, then the backward stroke in two jerks with a small pause, the fader open', points: [0.1, 0.2, 0.3, 0.25, 0.2, 0.2, 0.15, 0.1], fader: open(8) },
].map(({ name, does, points, fader }) => ({ name, does, draw: (effect: ScratchEffect): ScratchEffect => ({ ...effect, step: '1/16', points: [...points], fader: fader.map((c) => [...c] as unknown as FaderCell) }) }));

/** A new Scratch: Baby on 1 bar. */
export const newScratch = (): ScratchEffect => SCRATCH_PRESETS[0]!.draw({ target: 'scratch', record: 16, step: '1/16', points: [], fader: [] });

/** Clear plays normally: a straight line forward through the recording at 1×, one pass over the lane, the fader open. (Magnus beslut.) */
export const clearScratch = (effect: ScratchEffect): ScratchEffect => ({
  ...effect,
  points: effect.points.map((_, k) => snapPoint(effect.record, (k * STEP_SIZES[effect.step]) / effect.record)),
  fader: open(effect.points.length),
});

/**
 * Whether the next Ramp sweeps forward: it does, unless the points already
 * are a line going forward (never lower than the one before, the last above
 * the first). So each press turns it round, also after Undo. (Claudes val, as
 * on the lanes.)
 */
export function scratchRampsUp(effect: Pick<ScratchEffect, 'points'>): boolean {
  const ps = effect.points;
  if (ps.length < 2) return true;
  return !(ps.every((p, i) => i === 0 || p >= ps[i - 1]!) && ps.at(-1)! > ps[0]!);
}

/** Ramp: one steady sweep through the recording, from the lowest point to the highest (forward) or back; all the same: the whole recording. */
export function rampScratch(effect: ScratchEffect, up: boolean): ScratchEffect {
  const n = effect.points.length;
  if (n < 2) return effect;
  let lo = Math.min(...effect.points);
  let hi = Math.max(...effect.points);
  if (hi - lo < 1e-6) {
    lo = 0;
    hi = 1;
  }
  const [a, b] = up ? [lo, hi] : [hi, lo];
  return { ...effect, points: effect.points.map((_, k) => snapPoint(effect.record, a + ((b - a) * k) / (n - 1))) };
}

/**
 * Randomize: a random hand movement, as if drawn: the needle wanders from
 * somewhere early in the recording, now and then holding, and the fader opens
 * and closes, now and then in halves. Kept as the points and cells.
 */
export function randomizeScratch(effect: ScratchEffect, rng: Rng): ScratchEffect {
  let p = 0.1 + rng() * 0.3;
  const points = effect.points.map(() => {
    const now = p;
    if (rng() >= 0.15) p = clamp(p + (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.15), 0, 1);
    return snapPoint(effect.record, now);
  });
  const fader = effect.fader.map((): FaderCell => (rng() < 0.25 ? [rng() < 0.6, rng() < 0.5] : [rng() < 0.8]));
  return { ...effect, points, fader };
}

/** The movement `n` steps long (2–16): shorter drops from the end, longer adds copies of the last point and fader cell. */
export function setScratchLength(effect: ScratchEffect, n: number): ScratchEffect {
  const count = clamp(Math.round(n), MIN_SCRATCH_STEPS, MAX_LANE_STEPS);
  const have = effect.points.length;
  if (count <= have) return { ...effect, points: effect.points.slice(0, count), fader: effect.fader.slice(0, count) };
  const extra = count - have;
  const lastCell = effect.fader[have - 1] ?? ([true] as const);
  return {
    ...effect,
    points: [...effect.points, ...Array.from({ length: extra }, () => effect.points[have - 1] ?? 0)],
    fader: [...effect.fader, ...Array.from({ length: extra }, () => [...lastCell] as unknown as FaderCell)],
  };
}

/** A click on fader cell `i` (`half` 0 or 1 when split) opens or closes it; with Alt it splits the cell in two, or joins the halves (open if either was). */
export function toggleFader(effect: ScratchEffect, i: number, half: number, alt: boolean): ScratchEffect {
  const fader = effect.fader.map((cell, k): FaderCell => {
    if (k !== i) return cell;
    if (alt) return cell.length > 1 ? [cell[0] || cell[1]!] : [cell[0], cell[0]];
    return cell.length > 1 ? [half === 0 ? !cell[0] : cell[0], half === 1 ? !cell[1]! : cell[1]!] : [!cell[0]];
  });
  return { ...effect, fader };
}

/** What is wrong with a Scratch, or null. */
export function scratchProblem(effect: ScratchEffect): string | null {
  if (!(SCRATCH_RECORDS as readonly number[]).includes(effect.record)) return 'Scratch records 1 beat, 2 beats, 1 bar or 2 bars';
  if (STEP_SIZES[effect.step] === undefined) return 'A step is 1/16, a beat or a bar';
  const { points, fader } = effect;
  if (!Array.isArray(points) || points.length < MIN_SCRATCH_STEPS || points.length > MAX_LANE_STEPS) return 'Scratch has 2 to 16 steps';
  if (!points.every((p) => Number.isFinite(p) && p >= 0 && p <= 1)) return 'The needle is 0 to 1 into the recording';
  if (!Array.isArray(fader) || fader.length !== points.length || !fader.every((c) => Array.isArray(c) && (c.length === 1 || c.length === 2) && c.every((b) => typeof b === 'boolean'))) {
    return 'Each step has one fader cell, whole or in two halves';
  }
  return null;
}
