import { describe, expect, it } from 'vitest';
import type { HalftimeEffect, ModEffect, ModTranceGate, StepEffect } from './types';
import { AUDIO_TARGETS, DEFAULT_HALFTIME, DEFAULT_MOD_TRANCE_GATE, MOD_TARGETS, isAudioEffect, isStepEffect } from './types';
import { createMod, replaceEffect } from './commands';
import { apply, createHistory, undo } from './history';
import { createProject } from './project';
import { LANES, clearTranceGate, newStepEffect, toggleDice, tranceGatePreset, wholeValues } from './lanes';
import { sequentialIds } from '../test/fixtures';

const ctx = sequentialIds();
const make = (effects: readonly ModEffect[]) => createMod('M', effects)(createProject(), ctx);

describe('audio mods in the model', () => {
  it('are Scramble, Stutter, Freeze, Reverse, Rewind, Halftime and Trance gate; all but Halftime have a lane', () => {
    expect(AUDIO_TARGETS).toEqual(['scramble', 'stutter', 'freeze', 'reverse', 'rewind', 'halftime', 'tranceGate']);
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

describe('Trance gate in the model (Magnus beslut 2026-10-23)', () => {
  it('is an audio mod with an on/off lane (on = open), after the others so the dice keep their numbers', () => {
    expect(AUDIO_TARGETS.at(-1)).toBe('tranceGate');
    expect(MOD_TARGETS.at(-1)).toBe('tranceGate');
    const effect = newStepEffect('tranceGate');
    expect(isStepEffect(effect)).toBe(true);
    expect(isAudioEffect(effect)).toBe(true);
    expect(LANES.tranceGate).toMatchObject({ onOff: true, min: 0, max: 1 });
  });

  it('a new one has 16 steps of 1/16, all open, as Straight: Depth −∞, Open 50 %, Smooth 5 ms', () => {
    const effect = newStepEffect('tranceGate');
    expect(effect.step).toBe('1/16');
    expect(effect.lane).toEqual(Array.from({ length: 16 }, () => ({ v: 1 })));
    expect(effect.tranceGate).toEqual<ModTranceGate>({ depth: '-inf', open: 50, smooth: 5 });
    expect(DEFAULT_MOD_TRANCE_GATE).toEqual({ depth: '-inf', open: 50, smooth: 5 });
  });

  it('Clear makes every step open and Open 100 %, as without the gate', () => {
    const effect: StepEffect = { ...newStepEffect('tranceGate'), lane: [{ v: 0 }, { lo: 0, hi: 1, chance: 50 }, { v: 1 }], tranceGate: { depth: -12, open: 25, smooth: 20 } };
    const cleared = clearTranceGate(effect);
    expect(cleared.lane).toEqual([{ v: 1 }, { v: 1 }, { v: 1 }]);
    expect(cleared.tranceGate).toEqual({ depth: -12, open: 100, smooth: 20 });
  });

  it('the presets: Straight, Off-beat and 3-3-2, 16 steps of 1/16, keeping Depth and Smooth', () => {
    const start: StepEffect = { ...newStepEffect('tranceGate'), step: 'beat', lane: [{ v: 0 }], tranceGate: { depth: -6, open: 25, smooth: 30 } };
    const open = (e: StepEffect) => e.lane.flatMap((s, i) => ('v' in s && s.v === 1 ? [i + 1] : []));
    const straight = tranceGatePreset(start, 'Straight');
    expect([straight.step, straight.lane.length, open(straight), straight.tranceGate]).toEqual(['1/16', 16, Array.from({ length: 16 }, (_, i) => i + 1), { depth: -6, open: 50, smooth: 30 }]);
    const offBeat = tranceGatePreset(start, 'Off-beat');
    expect([offBeat.lane.length, open(offBeat), offBeat.tranceGate?.open]).toEqual([16, [3, 7, 11, 15], 75]);
    const tresillo = tranceGatePreset(start, '3-3-2');
    expect([tresillo.lane.length, open(tresillo), tresillo.tranceGate?.open]).toEqual([16, [1, 4, 7, 9, 12, 15], 75]);
  });

  it('commands check Depth, Open and Smooth', () => {
    const gate = (x: Partial<ModTranceGate>) => make([{ ...newStepEffect('tranceGate'), tranceGate: { ...DEFAULT_MOD_TRANCE_GATE, ...x } }]);
    for (const depth of [-6, -12, -24, '-inf'] as const) expect(gate({ depth }).ok).toBe(true);
    for (const open of [25, 50, 75, 100] as const) expect(gate({ open }).ok).toBe(true);
    expect(gate({ smooth: 1 }).ok).toBe(true);
    expect(gate({ smooth: 50 }).ok).toBe(true);
    expect(gate({ smooth: 17 }).ok).toBe(true);
    expect(gate({ depth: -3 as never }).ok).toBe(false);
    expect(gate({ open: 60 as never }).ok).toBe(false);
    expect(gate({ smooth: 0 }).ok).toBe(false);
    expect(gate({ smooth: 51 }).ok).toBe(false);
    expect(gate({ smooth: Number.NaN }).ok).toBe(false);
    expect(make([{ ...newStepEffect('tranceGate'), lane: [{ v: 2 }] }]).ok).toBe(false);
  });

  it('a change to it is a command that undo takes back', () => {
    const made = make([newStepEffect('tranceGate')]);
    if (!made.ok) throw new Error('made');
    const modId = Object.keys(made.project.mods)[0]!;
    let history = createHistory(made.project);
    const changed: StepEffect = { ...newStepEffect('tranceGate'), tranceGate: { depth: -6, open: 75, smooth: 12 } };
    const applied = apply(history, replaceEffect(modId, 'tranceGate', changed), ctx);
    if (!applied.ok) throw new Error('applied');
    history = applied.history;
    expect(history.present.mods[modId]!.effects[0]).toEqual(changed);
    history = undo(history);
    expect(history.present.mods[modId]!.effects[0]).toEqual(newStepEffect('tranceGate'));
  });
});
