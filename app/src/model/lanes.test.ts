import { describe, expect, it } from 'vitest';
import type { LaneStep, StepEffect } from './types';
import { createMod, cloneMod } from './commands';
import { createProject } from './project';
import {
  LANES,
  clearLane,
  cycleChance,
  denorm,
  inTurn,
  laneProblem,
  moveEdge,
  newStepEffect,
  norm,
  paintSteps,
  quantize,
  rampLane,
  rampsUp,
  randomizeLane,
  setLaneLength,
  toggleDice,
} from './lanes';
import { sequentialIds, sequenceRng } from '../test/fixtures';

const fixed = (...values: number[]): LaneStep[] => values.map((v) => ({ v }));
const effect = (target: StepEffect['target'], lane: LaneStep[], extra: Partial<StepEffect> = {}): StepEffect => ({ target, step: '1/16', lane, ...extra });

describe('lane ranges', () => {
  it('are the spec’s: Pitch ±24 st, Volume −24 to +6 dB, Pan ±100 %, Filter 60 Hz–18 kHz with 18 kHz as zero', () => {
    expect(LANES.pitch).toMatchObject({ min: -24, max: 24, zero: 0 });
    expect(LANES.volume).toMatchObject({ min: -24, max: 6, zero: 0, step: 1 });
    expect(LANES.pan).toMatchObject({ min: -100, max: 100, step: 5 });
    expect(LANES.filter).toMatchObject({ min: 60, max: 18000, zero: 18000, log: true });
    expect(LANES.stretch).toMatchObject({ min: 0.25, max: 4, zero: 1, log: true });
    expect(LANES.ratchet).toMatchObject({ min: 1, max: 8, zero: 1 });
    expect(LANES.padMember).toMatchObject({ min: 0, max: 8, zero: 0 });
    expect(LANES.direction).toMatchObject({ onOff: true, zero: 0 });
  });

  it('round drawn values to the lane’s step: Filter 10 Hz below 1 kHz and 100 Hz above; free Pitch in tenths', () => {
    expect(quantize({ target: 'volume' }, -6.4)).toBe(-6);
    expect(quantize({ target: 'pan' }, 12)).toBe(10);
    expect(quantize({ target: 'filter' }, 434)).toBe(430);
    expect(quantize({ target: 'filter' }, 4340)).toBe(4300);
    expect(quantize({ target: 'pitch' }, 2.36)).toBe(2);
    expect(quantize({ target: 'pitch', pitch: { values: 'free' } }, 2.36)).toBe(2.4);
    expect(quantize({ target: 'volume' }, 40)).toBe(6);
  });

  it('log lanes draw on a log scale', () => {
    expect(norm('stretch', 1)).toBeCloseTo(0.5);
    expect(denorm({ target: 'stretch' }, 0.5)).toBe(1);
  });
});

describe('a new effect', () => {
  it('has 4 steps of a beat at the zero value, except Reverb (100) and Delay (80)', () => {
    expect(newStepEffect('volume')).toMatchObject({ step: 'beat', lane: fixed(0, 0, 0, 0) });
    expect(newStepEffect('filter')).toMatchObject({ lane: fixed(18000, 18000, 18000, 18000), filter: { type: 'lowpass', resonance: 0.3 } });
    expect(newStepEffect('reverb').lane).toEqual(fixed(100, 100, 100, 100));
    expect(newStepEffect('delay').lane).toEqual(fixed(80, 80, 80, 80));
    expect(newStepEffect('pitch').pitch).toEqual({ values: 'semitones' });
  });
});

describe('Pad member has off', () => {
  it('its range is off or member 1–8, and a new one is off on every step, so it does not change the sound', () => {
    expect(LANES.padMember).toMatchObject({ min: 0, max: 8, zero: 0 });
    expect(newStepEffect('padMember').lane).toEqual(fixed(0, 0, 0, 0));
  });

  it('Clear sets off; drawing and a dice step reach off', () => {
    const pm = effect('padMember', fixed(3, 2));
    expect(clearLane(pm)).toEqual(fixed(0, 0));
    expect(denorm(pm, 0)).toBe(0);
    expect(laneProblem(effect('padMember', [{ lo: 0, hi: 2, chance: 100 }]))).toBeNull();
    // 🎲 round off: a band from off.
    expect(toggleDice(effect('padMember', fixed(0)), 0)).toEqual([{ lo: 0, hi: 1, chance: 100 }]);
  });
});

describe('drawing', () => {
  it('paints across steps, but not over dice steps', () => {
    const lane: LaneStep[] = [{ v: 0 }, { lo: -6, hi: 0, chance: 100 }, { v: 0 }, { v: 0 }];
    expect(paintSteps(lane, 3, 0, -12)).toEqual([{ v: -12 }, { lo: -6, hi: 0, chance: 100 }, { v: -12 }, { v: -12 }]);
  });

  it('moves the dragged edge of a dice step, never past the other', () => {
    const lane: LaneStep[] = [{ lo: -6, hi: 0, chance: 100 }];
    expect(moveEdge(lane, 0, 'lo', -12)).toEqual([{ lo: -12, hi: 0, chance: 100 }]);
    expect(moveEdge(lane, 0, 'hi', -9)).toEqual([{ lo: -6, hi: -6, chance: 100 }]);
  });

  it('🎲 makes a dice step of ±15 % of the range round the value, chance 100; again fixes it in the middle', () => {
    const pitch = effect('pitch', fixed(0));
    const dice = toggleDice(pitch, 0);
    expect(dice).toEqual([{ lo: -7, hi: 7, chance: 100 }]);
    expect(toggleDice({ ...pitch, lane: [{ lo: -7, hi: 5, chance: 75 }] }, 0)).toEqual(fixed(-1));
  });

  it('🎲 on an on/off lane is 0–1 at 50 %', () => {
    expect(toggleDice(effect('direction', fixed(0)), 0)).toEqual([{ lo: 0, hi: 1, chance: 50 }]);
  });

  it('a click on the chance steps 100, 75, 50, 25 and round', () => {
    let lane: LaneStep[] = [{ lo: 0, hi: 1, chance: 100 }];
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      lane = cycleChance(lane, 0);
      seen.push((lane[0] as { chance: number }).chance);
    }
    expect(seen).toEqual([75, 50, 25, 100]);
  });
});

describe('Randomize, Ramp, Clear and Length', () => {
  it('Randomize fills the steps with random fixed values, as drawn', () => {
    const lane = randomizeLane(effect('volume', fixed(0, 0, 0)), sequenceRng([0, 0.5, 0.999]), false);
    expect(lane).toEqual(fixed(-24, -9, 6));
  });

  it('Shift: dice fills them with dice steps of 15–40 % of the range and chance 100, 75 or 50 (on/off 75, 50, 25)', () => {
    const lane = randomizeLane(effect('pan', fixed(0, 0)), sequenceRng([0.5, 0, 0.1]), true);
    for (const s of lane) {
      const d = s as { lo: number; hi: number; chance: number };
      expect((d.hi - d.lo) / 200).toBeGreaterThanOrEqual(0.15 - 0.03);
      expect((d.hi - d.lo) / 200).toBeLessThanOrEqual(0.4 + 0.03);
      expect([100, 75, 50]).toContain(d.chance);
    }
    const onOff = randomizeLane(effect('direction', fixed(0, 0, 0)), sequenceRng([0, 0.5, 0.9]), true);
    expect(onOff.map((s) => (s as { chance: number }).chance)).toEqual([75, 50, 25]);
  });

  it('Ramp draws a line from the lane’s lowest value to its highest, or back; equal values take the whole range', () => {
    const vol = effect('volume', fixed(-12, 0, -6, -3));
    expect(rampLane(vol, true)).toEqual(fixed(-12, -8, -4, 0));
    expect(rampLane(vol, false)).toEqual(fixed(0, -4, -8, -12));
    expect(rampLane(effect('volume', fixed(0, 0, 0, 0)), true)).toEqual(fixed(-24, -14, -4, 6));
    expect(rampLane(effect('volume', fixed(-3)), true)).toEqual(fixed(-3));
  });

  it('each press of Ramp turns round: it shows what the next press does', () => {
    const vol = effect('volume', fixed(-12, 0, -6, -3));
    expect(rampsUp(vol)).toBe(true);
    const up = { ...vol, lane: rampLane(vol, true) };
    expect(rampsUp(up)).toBe(false);
    expect(rampsUp({ ...up, lane: rampLane(up, false) })).toBe(true);
  });

  it('Clear sets every step to the zero value, fixed', () => {
    expect(clearLane(effect('filter', [{ v: 200 }, { lo: 300, hi: 900, chance: 50 }]))).toEqual(fixed(18000, 18000));
  });

  it('Length: + adds a copy of the last step, within 1–16', () => {
    expect(setLaneLength(fixed(1, 2), 3)).toEqual(fixed(1, 2, 2));
    expect(setLaneLength(fixed(1, 2), 0)).toEqual(fixed(1));
    expect(setLaneLength(fixed(1), 40)).toHaveLength(16);
  });

  it('In turn draws 1, 2, 3 … up to the pad’s members', () => {
    expect(inTurn(3)).toEqual(fixed(1, 2, 3));
    expect(inTurn(12)).toHaveLength(8);
  });
});

describe('lanes in commands', () => {
  it('a lane must have 1–16 steps within range, and chances of 100, 75, 50 or 25 %', () => {
    expect(laneProblem(effect('volume', []))).not.toBeNull();
    expect(laneProblem(effect('volume', fixed(10)))).not.toBeNull();
    expect(laneProblem(effect('volume', [{ lo: 0, hi: -6, chance: 100 }]))).not.toBeNull();
    expect(laneProblem(effect('volume', [{ lo: -6, hi: 0, chance: 30 as 25 }]))).not.toBeNull();
    expect(laneProblem(effect('volume', fixed(0, -6)))).toBeNull();
    const ctx = sequentialIds();
    expect(createMod('M', [effect('volume', fixed(12))])(createProject(), ctx).ok).toBe(false);
  });

  it('Clone makes "<name> copy" with an id and a seed of its own', () => {
    const ctx = sequentialIds();
    const made = createMod('Wobble', [effect('volume', fixed(0, -6))])(createProject(), ctx);
    if (!made.ok) throw new Error();
    const id = Object.keys(made.project.mods)[0]!;
    const cloned = cloneMod(id)(made.project, ctx);
    if (!cloned.ok) throw new Error();
    const copy = Object.values(cloned.project.mods).find((m) => m.id !== id)!;
    expect(copy.name).toBe('Wobble copy');
    expect(copy.effects).toEqual(made.project.mods[id]!.effects);
    expect(copy.seed).not.toBe(made.project.mods[id]!.seed);
  });
});
