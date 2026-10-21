import { describe, expect, it } from 'vitest';
import { seededRng, sequentialIds } from '../test/fixtures';
import { createMod, replaceEffect } from './commands';
import { createProject } from './project';
import type { ScratchEffect } from './types';
import { MOD_TARGETS } from './types';
import {
  HELD_SPEED,
  SCRATCH_PRESETS,
  clearScratch,
  newScratch,
  rampScratch,
  randomizeScratch,
  scratchCurve,
  scratchEnd,
  scratchMotion,
  scratchPosition,
  scratchProblem,
  scratchRampsUp,
  scratchSpeeds,
  setScratchLength,
  snapPoint,
  toggleFader,
} from './scratch';

const scratch = (points: readonly number[], extra: Partial<ScratchEffect> = {}): ScratchEffect => ({ ...newScratch(), points, fader: points.map(() => [true] as const), ...extra });

describe('Scratch in the model', () => {
  it('comes last among the targets, so the others keep their numbers in dice rolls', () => {
    expect(MOD_TARGETS.at(-1)).toBe('scratch');
    expect(MOD_TARGETS.indexOf('halftime')).toBe(18);
  });

  it('a new Scratch is Baby on 1 bar', () => {
    expect(newScratch()).toEqual({ target: 'scratch', record: 16, step: '1/16', points: [0.1, 0.25, 0.1, 0.25, 0.1, 0.25, 0.1, 0.25], fader: Array.from({ length: 8 }, () => [true]) });
  });

  it('has the presets of the spec, each 8 steps of 1/16 with its own fader', () => {
    const open = Array.from({ length: 8 }, () => [true]);
    expect(SCRATCH_PRESETS.map((p) => p.name)).toEqual(['Baby', 'Chirp', 'Transformer', 'Tear']);
    const [baby, chirp, transformer, tear] = SCRATCH_PRESETS.map((p) => p.draw(newScratch()));
    expect(baby).toMatchObject({ step: '1/16', points: [0.1, 0.25, 0.1, 0.25, 0.1, 0.25, 0.1, 0.25], fader: open });
    expect(chirp).toMatchObject({ points: [0.1, 0.18, 0.26, 0.18, 0.1, 0.18, 0.26, 0.18], fader: Array.from({ length: 8 }, (_, k) => (k % 2 === 0 ? [true] : [true, false])) });
    expect(transformer).toMatchObject({ points: [0.1, 0.13, 0.16, 0.19, 0.22, 0.19, 0.16, 0.13], fader: Array.from({ length: 8 }, () => [true, false]) });
    expect(tear).toMatchObject({ points: [0.1, 0.2, 0.3, 0.25, 0.2, 0.2, 0.15, 0.1], fader: open });
    // A preset keeps what is recorded.
    expect(SCRATCH_PRESETS[0]!.draw({ ...newScratch(), record: 32 }).record).toBe(32);
  });

  it('snaps a point to half a 1/16 of the recording, within 0–1', () => {
    expect(snapPoint(16, 0.26)).toBe(0.25);
    expect(snapPoint(16, 0.27)).toBeCloseTo(0.28125);
    expect(snapPoint(4, 0.3)).toBe(0.25);
    expect(snapPoint(16, 1.4)).toBe(1);
    expect(snapPoint(16, -0.2)).toBe(0);
  });

  it('the last step carries on at the speed it arrived with', () => {
    expect(scratchEnd([0.1, 0.25])).toBeCloseTo(0.4);
    expect(scratchEnd([0.5, 0.9])).toBe(1);
    expect(scratchEnd([0.3, 0.1])).toBe(0);
  });

  it('gives each step its speed: the needle’s way times the recording over the step', () => {
    // Baby on 1 bar: 0.15 of 16 steps of recording in one step is 2.4×.
    const speeds = scratchSpeeds(newScratch());
    expect(speeds[0]).toBeCloseTo(2.4);
    expect(speeds[1]).toBeCloseTo(-2.4);
    expect(speeds[7]).toBeCloseTo(2.4);
    expect(scratchSpeeds({ ...newScratch(), step: 'beat' })[0]).toBeCloseTo(0.6);
  });

  it('is held, and silent, slower than 0.05×', () => {
    expect(HELD_SPEED).toBe(0.05);
    expect(scratchMotion(0.04)).toBe('held');
    expect(scratchMotion(-0.04)).toBe('held');
    expect(scratchMotion(0.06)).toBe('forward');
    expect(scratchMotion(-2.4)).toBe('backward');
    expect(scratchSpeeds(scratch([0.2, 0.2, 0.4])).map(scratchMotion)).toEqual(['held', 'forward', 'forward']);
  });

  describe('the curve', () => {
    it('goes through the points, smoothed between them', () => {
      const effect = newScratch();
      effect.points.forEach((p, j) => expect(scratchPosition(scratchCurve(effect, j), 0)).toBeCloseTo(p));
      expect(scratchPosition(scratchCurve(effect, 0), 1)).toBeCloseTo(0.25);
      expect(scratchPosition(scratchCurve(effect, 7), 1)).toBeCloseTo(scratchEnd(effect.points));
      // Smooth: the slope at the end of one step is the slope at the start of the next.
      const slope = (c: readonly number[], u: number) => c[1]! + 2 * c[2]! * u + 3 * c[3]! * u * u;
      for (let j = 0; j < 7; j++) expect(slope(scratchCurve(effect, j), 1)).toBeCloseTo(slope(scratchCurve(effect, j + 1), 0));
    });

    it('a straight line stays straight to its ends, so Clear plays at 1× all through', () => {
      const cleared = clearScratch({ ...newScratch(), points: Array.from({ length: 16 }, () => 0) , fader: Array.from({ length: 16 }, () => [true] as const) });
      for (let j = 0; j < 16; j++) expect(scratchCurve(cleared, j).map((c) => +c.toFixed(9))).toEqual([j / 16, 1 / 16, 0, 0]);
    });
  });

  it('Clear plays normally: forward through the recording at 1×, the fader open', () => {
    const cleared = clearScratch({ ...SCRATCH_PRESETS[1]!.draw(newScratch()), step: 'beat' });
    expect(cleared.points).toEqual([0, 0.25, 0.5, 0.75, 1, 1, 1, 1]);
    expect(cleared.fader).toEqual(Array.from({ length: 8 }, () => [true]));
    expect(scratchSpeeds(cleared).slice(0, 4).map((s) => +s.toFixed(9))).toEqual([1, 1, 1, 1]);
  });

  it('Ramp draws one steady sweep through the recording, forward then backward', () => {
    const baby = newScratch();
    expect(scratchRampsUp(baby)).toBe(true);
    const up = rampScratch(baby, true);
    expect(up.points.map((p) => +p.toFixed(5))).toEqual([0.09375, 0.125, 0.15625, 0.15625, 0.1875, 0.21875, 0.21875, 0.25]);
    expect(scratchRampsUp(up)).toBe(false);
    const down = rampScratch(up, false);
    expect(down.points[0]).toBeCloseTo(0.25);
    expect(down.points.at(-1)).toBeCloseTo(0.09375);
    expect(scratchRampsUp(down)).toBe(true);
    // All points the same: the whole recording.
    expect(rampScratch(scratch([0.5, 0.5, 0.5]), true).points).toEqual([0, 0.5, 1]);
  });

  it('Randomize draws a hand movement and a fader, snapped and within the recording', () => {
    const drawn = randomizeScratch(newScratch(), seededRng(3));
    expect(drawn.points).toHaveLength(8);
    expect(drawn.fader).toHaveLength(8);
    for (const p of drawn.points) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(snapPoint(16, p)).toBe(p);
    }
    expect(drawn.fader.every((c) => c.length === 1 || c.length === 2)).toBe(true);
    expect(randomizeScratch(newScratch(), seededRng(3))).toEqual(drawn);
  });

  it('is 2 to 16 steps long; a step more copies the last point and fader cell', () => {
    const chirp = SCRATCH_PRESETS[1]!.draw(newScratch());
    const longer = setScratchLength(chirp, 9);
    expect(longer.points.at(-1)).toBe(0.18);
    expect(longer.fader.at(-1)).toEqual([true, false]);
    expect(setScratchLength(chirp, 1).points).toHaveLength(2);
    expect(setScratchLength(chirp, 40).points).toHaveLength(16);
  });

  it('a click opens or closes a fader cell; Alt-click splits it in two or joins the halves', () => {
    const effect = newScratch();
    const closed = toggleFader(effect, 2, 0, false);
    expect(closed.fader[2]).toEqual([false]);
    const split = toggleFader(effect, 2, 0, true);
    expect(split.fader[2]).toEqual([true, true]);
    const half = toggleFader(split, 2, 1, false);
    expect(half.fader[2]).toEqual([true, false]);
    expect(toggleFader(half, 2, 1, true).fader[2]).toEqual([true]);
    expect(toggleFader(toggleFader(split, 2, 0, false), 2, 0, true).fader[2]).toEqual([true]);
    expect(toggleFader({ ...effect, fader: effect.fader.map((_, i) => (i === 2 ? [false, false] : [true])) }, 2, 0, true).fader[2]).toEqual([false]);
  });

  it('says what is wrong with a Scratch, and commands refuse it', () => {
    expect(scratchProblem(newScratch())).toBeNull();
    expect(scratchProblem({ ...newScratch(), record: 12 as 16 })).toMatch(/1 beat, 2 beats, 1 bar or 2 bars/);
    expect(scratchProblem(scratch([0.5]))).toMatch(/2 to 16/);
    expect(scratchProblem(scratch([0.5, 1.5]))).toMatch(/0 to 1/);
    expect(scratchProblem({ ...newScratch(), fader: [[true]] })).toMatch(/fader cell/);
    expect(scratchProblem({ ...newScratch(), fader: newScratch().fader.map(() => [true, true, true] as unknown as [boolean]) })).toMatch(/fader cell/);

    const ctx = sequentialIds();
    const made = createMod('DJ hands', [newScratch()])(createProject(), ctx);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const id = Object.keys(made.project.mods)[0]!;
    expect(replaceEffect(id, 'scratch', scratch([2, 0.1]))(made.project, ctx).ok).toBe(false);
  });
});
