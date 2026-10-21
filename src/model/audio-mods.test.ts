import { describe, expect, it } from 'vitest';
import type { HalftimeEffect, ModEffect, StepEffect } from './types';
import { AUDIO_TARGETS, DEFAULT_HALFTIME, isAudioEffect, isStepEffect } from './types';
import { createMod } from './commands';
import { createProject } from './project';
import { LANES, newStepEffect, toggleDice, wholeValues } from './lanes';
import { sequentialIds } from '../test/fixtures';

const ctx = sequentialIds();
const make = (effects: readonly ModEffect[]) => createMod('M', effects)(createProject(), ctx);

describe('audio mods in the model', () => {
  it('are Scramble, Stutter, Freeze, Reverse, Rewind and Halftime; all but Halftime have a lane', () => {
    expect(AUDIO_TARGETS).toEqual(['scramble', 'stutter', 'freeze', 'reverse', 'rewind', 'halftime']);
    for (const target of ['scramble', 'stutter', 'freeze', 'reverse', 'rewind'] as const) {
      const effect = newStepEffect(target);
      expect(isStepEffect(effect)).toBe(true);
      expect(isAudioEffect(effect)).toBe(true);
    }
    expect(isStepEffect(DEFAULT_HALFTIME)).toBe(false);
    expect(isAudioEffect(DEFAULT_HALFTIME)).toBe(true);
    expect(isAudioEffect(newStepEffect('pitch'))).toBe(false);
  });

  it('have the lanes of the sketch: Scramble a chance 0–100 %, Stutter off, 1/16, 1/32, 1/64, the rest on/off', () => {
    expect(LANES.scramble).toMatchObject({ min: 0, max: 100, zero: 0, step: 5, unit: '% swap' });
    expect(LANES.stutter).toMatchObject({ min: 0, max: 3, zero: 0, step: 1, unit: 'repeat' });
    expect(LANES.freeze).toMatchObject({ onOff: true, zero: 0, unit: 'on/off' });
    expect(LANES.reverse).toMatchObject({ onOff: true, zero: 0, unit: 'on/off' });
    expect(LANES.rewind).toMatchObject({ onOff: true, zero: 0, unit: 'fires' });
    expect(wholeValues({ target: 'stutter' })).toBe(true);
  });

  it('a new one has 4 steps of a beat at the zero value, Scramble at 50, with the sketch’s settings', () => {
    const lane = (e: StepEffect) => [e.step, e.lane];
    expect(lane(newStepEffect('scramble'))).toEqual(['beat', [{ v: 50 }, { v: 50 }, { v: 50 }, { v: 50 }]]);
    expect(lane(newStepEffect('stutter'))).toEqual(['beat', [{ v: 0 }, { v: 0 }, { v: 0 }, { v: 0 }]]);
    expect(newStepEffect('scramble').scramble).toEqual({ cell: 1, from: 'song', around: 2, reverse: 0 });
    expect(newStepEffect('stutter').stutter).toEqual({ grabs: 1, pitch: 0, gate: 100 });
    expect(newStepEffect('freeze').freeze).toEqual({ grain: 30, spread: 0, level: 0 });
    expect(newStepEffect('reverse').reverse).toEqual({ cell: 1 });
    expect(newStepEffect('rewind').rewind).toEqual({ pullBack: 4, curve: 'fast' });
    expect(DEFAULT_HALFTIME).toEqual<HalftimeEffect>({ target: 'halftime', speed: 0.5, keepPitch: false });
  });

  it('🎲 on a Stutter step gives a band one choice either side, as the sketch', () => {
    const stutter: StepEffect = { ...newStepEffect('stutter'), lane: [{ v: 2 }, { v: 0 }, { v: 3 }] };
    expect(toggleDice(stutter, 0)[0]).toEqual({ lo: 1, hi: 3, chance: 100 });
    expect(toggleDice(stutter, 1)[1]).toEqual({ lo: 0, hi: 1, chance: 100 });
    expect(toggleDice(stutter, 2)[2]).toEqual({ lo: 2, hi: 3, chance: 100 });
  });

  it('commands check their settings', () => {
    expect(make([newStepEffect('scramble'), newStepEffect('stutter'), newStepEffect('freeze'), newStepEffect('reverse'), newStepEffect('rewind'), DEFAULT_HALFTIME]).ok).toBe(true);
    expect(make([{ ...DEFAULT_HALFTIME, speed: 3 as never }]).ok).toBe(false);
    expect(make([{ ...newStepEffect('scramble'), scramble: { cell: 3 as never, from: 'song', around: 2, reverse: 0 } }]).ok).toBe(false);
    expect(make([{ ...newStepEffect('stutter'), lane: [{ v: 4 }] }]).ok).toBe(false);
    expect(make([{ ...newStepEffect('rewind'), rewind: { pullBack: 5 as never, curve: 'fast' } }]).ok).toBe(false);
    expect(make([{ ...newStepEffect('freeze'), freeze: { grain: 30, spread: 10 as never, level: 0 } }]).ok).toBe(false);
  });
});
