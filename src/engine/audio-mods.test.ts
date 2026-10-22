import { describe, expect, it } from 'vitest';
import type { Command, Id, LaneStep, ModEffect, Project, StepEffect } from '../model';
import { DEFAULT_HALFTIME, addClip, addSample, createLoop, createMod, createProject, newScratch, newStepEffect, rerollMod, setBpm, setSongBars, setStep, stepDuration } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Splice } from './audio-mods';
import { sourceAt } from './audio-mods';
import { generateTake } from './generate';
import { scramblePicture } from './mod-pass';
import { modBlock } from './preview';

const ctx = sequentialIds();
const STEP = stepDuration(120);

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** A 4-bar song at 120 BPM with a one-bar main playing on every step. */
function song(): Project {
  const project = run(createProject(), setBpm(120), setSongBars(4), addSample({ name: 'k', audio: constantAudio(0.05) }), createLoop(null, 'main', 1));
  const pad = Object.values(project.pads)[0]!.id;
  const loop = Object.values(project.loops)[0]!.id;
  return run(project, ...Array.from({ length: 16 }, (_, i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 64));
}

/** `project` with a mod of `effects`, laid in `row` from step `start` for `length` steps. */
function withMod(project: Project, effects: readonly ModEffect[], start: number, length: number, row: 'modA' | 'modB' = 'modA'): [Project, Id] {
  const before = project;
  const made = run(project, createMod('M', effects));
  const id = Object.keys(made.mods).find((k) => !(k in before.mods))!;
  return [run(made, addClip(row, id, start, length)), id];
}

const lane = (step: StepEffect['step'], values: readonly (number | LaneStep)[]): Pick<StepEffect, 'step' | 'lane'> => ({
  step,
  lane: values.map((v) => (typeof v === 'number' ? { v } : v)),
});
const effect = (target: StepEffect['target'], step: StepEffect['step'], values: readonly (number | LaneStep)[], extra: Partial<StepEffect> = {}): StepEffect => ({
  ...newStepEffect(target),
  ...lane(step, values),
  ...extra,
});

/** A splice in steps: where it is heard, and where in what is heard it reads at its start and end. */
const inSteps = (s: Splice) => ({
  at: +(s.time / STEP).toFixed(6),
  length: +(s.length / STEP).toFixed(6),
  from: +(sourceAt(s, 0) / STEP).toFixed(6),
  to: +(sourceAt(s, 1) / STEP).toFixed(6),
  gain: +s.gain.toFixed(6),
});
const splices = (project: Project) => (generateTake(project).splices ?? []).map(inSteps);

describe('Stutter', () => {
  it('a Roll on the last beat of a bar repeats 1/16, then 1/32, then 1/64', () => {
    const roll = effect('stutter', '1/16', [1, 2, 3, 3]);
    const [project] = withMod(song(), [roll], 12, 4);
    const got = splices(project);
    expect(got.map((s) => s.length)).toEqual([1, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
    // Grabs 1/16: each step repeats its own start.
    expect(got.map((s) => s.from)).toEqual([12, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15]);
    expect(got.map((s) => s.at)).toEqual([12, 13, 13.5, 14, 14.25, 14.5, 14.75, 15, 15.25, 15.5, 15.75]);
    // Each repeat plays as long as it lasts: as heard, not faster.
    for (const s of got) expect(s.to - s.from).toBeCloseTo(s.length, 6);
  });

  it('Grabs a beat repeats the start of the beat; Pitch per repeat and Gate shape each repeat', () => {
    const roll = effect('stutter', '1/16', [1, 2, 3, 3], { stutter: { grabs: 4, pitch: -1, gate: 50 } });
    const [project] = withMod(song(), [roll], 12, 4);
    const heard = splices(project).filter((s) => s.gain > 0);
    expect(heard.map((s) => s.from)).toEqual(Array.from({ length: 11 }, () => 12));
    // Repeat n is n semitones down: it reads less of what is heard in the same time.
    heard.forEach((s, n) => expect((s.to - s.from) / s.length).toBeCloseTo(2 ** (-n / 12), 4));
    // Half of each repeat is heard, the rest is silent.
    expect(heard[1]).toMatchObject({ at: 13, length: 0.25 });
    expect(splices(project).find((s) => s.at === 13.25)).toMatchObject({ length: 0.25, gain: 0 });
  });

  it('off steps leave what is heard alone', () => {
    const [project] = withMod(song(), [effect('stutter', '1/16', [0, 0, 2, 0])], 0, 4);
    expect(splices(project).map((s) => s.at)).toEqual([2, 2.5]);
  });
});

describe('Scramble', () => {
  const always = effect('scramble', 'beat', [100]);

  it('with Take from Whole song plays cells from other parts of the song, the same cells every time', () => {
    const [project] = withMod(song(), [always], 32, 16);
    const got = splices(project);
    expect(got).toHaveLength(16);
    // Each cell of the clip plays a cell of 1/16 from somewhere in the song.
    got.forEach((s, j) => {
      expect(s).toMatchObject({ at: 32 + j, length: 1 });
      expect(Number.isInteger(s.from) && s.from >= 0 && s.from < 64).toBe(true);
      expect(s.to - s.from).toBeCloseTo(1, 6);
    });
    expect(got.some((s) => s.from < 32 || s.from >= 48)).toBe(true);
    expect(splices(project)).toEqual(got);
  });

  it('🎲 on the mod picks other cells', () => {
    const [project, mod] = withMod(song(), [always], 32, 16);
    const rerolled = run(project, rerollMod(mod));
    expect(splices(rerolled).map((s) => s.from)).not.toEqual(splices(project).map((s) => s.from));
  });

  it('takes cells from ± bars round the clip, or from inside it', () => {
    const around = effect('scramble', 'beat', [100], { scramble: { cell: 1, from: 'around', around: 1, reverse: 0 } });
    const inside = effect('scramble', 'beat', [100], { scramble: { cell: 2, from: 'clip', around: 1, reverse: 0 } });
    const [a] = withMod(song(), [around], 32, 8);
    for (const s of splices(a)) expect(s.from >= 16 && s.from < 56).toBe(true);
    const [b] = withMod(song(), [inside], 32, 8);
    expect(splices(b)).toHaveLength(4);
    for (const s of splices(b)) expect(s.from >= 32 && s.from < 40 && s.from % 2 === 0).toBe(true);
  });

  it('the lane is the chance a cell is swapped, and Reverse chance plays swapped cells backwards', () => {
    const [none] = withMod(song(), [effect('scramble', 'beat', [0])], 32, 16);
    expect(splices(none)).toEqual([]);
    const backwards = effect('scramble', 'beat', [100], { scramble: { cell: 1, from: 'song', around: 2, reverse: 100 } });
    const [project] = withMod(song(), [backwards], 32, 4);
    for (const s of splices(project)) expect(s.from - s.to).toBeCloseTo(1, 6);
  });
});

describe('Reverse', () => {
  it('plays the cells where the lane is on backwards, each in its place', () => {
    const [project] = withMod(song(), [effect('reverse', 'beat', [0, 1, 0, 0], { reverse: { cell: 2 } })], 0, 16);
    expect(splices(project)).toEqual([
      { at: 4, length: 2, from: 6, to: 4, gain: 1 },
      { at: 6, length: 2, from: 8, to: 6, gain: 1 },
    ]);
  });
});

describe('Freeze', () => {
  it('holds a grain of what is heard where a run of on steps starts, as a tone, at its level', () => {
    const [project] = withMod(song(), [effect('freeze', '1/16', [0, 0, 1, 1], { freeze: { grain: 30, spread: 0, level: -6 } })], 0, 4);
    const [only, ...rest] = generateTake(project).splices ?? [];
    expect(rest).toEqual([]);
    expect(inSteps(only!)).toEqual({ at: 2, length: 2, from: 2, to: 2, gain: +(10 ** (-6 / 20)).toFixed(6) });
    expect(only!.grains?.length).toBeCloseTo(0.03, 9);
    expect(new Set(only!.grains?.offsets)).toEqual(new Set([0]));
  });

  it('Spread lets each grain start a little round the frozen point, from the seeds', () => {
    const [project] = withMod(song(), [effect('freeze', '1/16', [1], { freeze: { grain: 80, spread: 50, level: 0 } })], 0, 2);
    const offsets = generateTake(project).splices![0]!.grains!.offsets;
    expect(offsets.length).toBeGreaterThan(4);
    for (const o of offsets) expect(Math.abs(o)).toBeLessThanOrEqual(0.04 + 1e-9);
    expect(new Set(offsets).size).toBeGreaterThan(1);
    expect(generateTake(project).splices![0]!.grains!.offsets).toEqual(offsets);
  });
});

describe('Rewind', () => {
  it('pulls the last beat back over its step: Fast at an even speed', () => {
    const [project] = withMod(song(), [effect('rewind', 'beat', [0, 0, 0, 1])], 0, 16);
    const [only] = generateTake(project).splices!;
    expect(inSteps(only!)).toMatchObject({ at: 12, length: 4, from: 12, to: 8 });
    expect((sourceAt(only!, 0.5) - 12 * STEP) / STEP).toBeCloseTo(-2, 6);
  });

  it('Slowing comes to a stop; Spin-back brakes from playing, turns and spins back faster and faster', () => {
    const slowing = withMod(song(), [effect('rewind', 'beat', [1], { rewind: { pullBack: 16, curve: 'slowing' } })], 0, 4)[0];
    const s = generateTake(slowing).splices![0]!;
    expect(inSteps(s)).toMatchObject({ from: 0, to: -16 });
    const speed = (sp: Splice, u: number) => (sourceAt(sp, u + 1e-4) - sourceAt(sp, u)) / (1e-4 * sp.length);
    expect(speed(s, 0)).toBeLessThan(-1);
    expect(Math.abs(speed(s, 1 - 1e-4))).toBeLessThan(0.01);
    const spin = withMod(song(), [effect('rewind', 'beat', [1], { rewind: { pullBack: 4, curve: 'spinBack' } })], 4, 4)[0];
    const b = generateTake(spin).splices![0]!;
    expect(inSteps(b)).toMatchObject({ from: 4, to: 0 });
    expect(speed(b, 0)).toBeCloseTo(1, 3);
    expect(speed(b, 0.99)).toBeLessThan(-2);
  });
});

describe('Halftime', () => {
  it('plays what is heard under the whole clip at half speed, from where the clip starts', () => {
    const [project] = withMod(song(), [DEFAULT_HALFTIME], 16, 16);
    expect(splices(project)).toEqual([{ at: 16, length: 16, from: 16, to: 24, gain: 1 }]);
    expect(generateTake(project).splices![0]!.grains).toBeNull();
  });

  it('×2 reads ahead; Keep pitch plays it as grains at 1×', () => {
    const [project] = withMod(song(), [{ ...DEFAULT_HALFTIME, speed: 2, keepPitch: true }], 16, 8);
    const [only] = generateTake(project).splices!;
    expect(inSteps(only!)).toMatchObject({ from: 16, to: 32 });
    expect(only!.grains?.length).toBeCloseTo(0.03, 9);
  });
});

describe('A and B, order and the clip', () => {
  it('with the same audio mod in both rows, B’s plays where they meet', () => {
    const [a] = withMod(song(), [DEFAULT_HALFTIME], 0, 32);
    const [project] = withMod(a, [{ ...DEFAULT_HALFTIME, speed: 0.75 }], 16, 8, 'modB');
    expect(splices(project)).toEqual([
      { at: 0, length: 16, from: 0, to: 8, gain: 1 },
      { at: 16, length: 8, from: 16, to: 22, gain: 1 },
      { at: 24, length: 8, from: 12, to: 16, gain: 1 },
    ]);
  });

  it('where two act at once, one wins in a fixed order: Rewind, Stutter, Freeze, Reverse, Scramble, Halftime', () => {
    const [project] = withMod(song(), [DEFAULT_HALFTIME, effect('stutter', '1/16', [0, 1, 0, 0])], 0, 4);
    expect(splices(project)).toEqual([
      { at: 0, length: 1, from: 0, to: 0.5, gain: 1 },
      { at: 1, length: 1, from: 1, to: 2, gain: 1 },
      { at: 2, length: 2, from: 1, to: 2, gain: 1 },
    ]);
  });

  it('acts only under its clip: after the clip there is nothing to splice', () => {
    const [project] = withMod(song(), [effect('reverse', '1/16', [1])], 8, 4);
    const got = splices(project);
    expect(Math.min(...got.map((s) => s.at))).toBe(8);
    expect(Math.max(...got.map((s) => s.at + s.length))).toBe(12);
  });
});

describe('what is heard', () => {
  it('a take has every trigger heard, also those under a Tape, as the source of what is heard', () => {
    const tape: ModEffect = { target: 'tape', length: 2, direction: 'forward', speed: { from: 1, to: 1 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };
    const [project] = withMod(song(), [tape], 16, 16);
    const take = generateTake(project);
    expect(take.triggers).toHaveLength(48);
    expect(take.heard).toHaveLength(64);
  });
});

describe('Where each cell comes from', () => {
  it('shows what Play in Mods renders in the pass: the same cells from the same block', () => {
    const base = song();
    const loop = Object.values(base.loops)[0]!.id;
    const made = run(base, createMod('S', [effect('scramble', '1/16', [100, 50])]));
    const mod = Object.keys(made.mods)[0]!;
    for (const pass of [0, 1, 2]) {
      const picture = scramblePicture(made, mod, loop, pass)!;
      // A one-bar loop: a block is one pass, so Whole song is the pass.
      expect(picture).toMatchObject({ cell: 1, songCells: 16, clip: { start: 0, end: 16 }, range: { start: 0, end: 16 }, bars: 1 });
      const played = (generateTake(modBlock(made, mod, loop, pass)).splices ?? []).map((s) => [Math.round(s.time / STEP), Math.round(sourceAt(s, 0) / STEP)]);
      expect(picture.cells.filter((c) => c.from !== null).map((c) => [c.start, c.from])).toEqual(played);
    }
    expect(scramblePicture(made, mod, loop, 0)!.cells).not.toEqual(scramblePicture(made, mod, loop, 1)!.cells);
  });
});

describe('where the export cuts a piece of its own (Magnus beslut 2026-10-22)', () => {
  const clips = (project: Project) => (generateTake(project).audioClips ?? []).map((c) => ({ time: +(c.time / STEP).toFixed(6), end: +(c.end / STEP).toFixed(6) }));

  it('a clip with an audio mod is a stretch of its own, also where the mod does nothing', () => {
    const [project] = withMod(song(), [effect('stutter', '1/16', [0, 0, 2, 0])], 4, 8);
    expect(clips(project)).toEqual([{ time: 4, end: 12 }]);
  });

  it('so is a clip with Scratch, and Halftime', () => {
    const [scratched] = withMod(song(), [newScratch()], 0, 8);
    const [both] = withMod(scratched, [DEFAULT_HALFTIME], 16, 4, 'modB');
    expect(clips(both)).toEqual([
      { time: 0, end: 8 },
      { time: 16, end: 20 },
    ]);
  });

  it('a clip with only step mods, or Tape, is not', () => {
    const tape: ModEffect = { target: 'tape', length: 4, direction: 'forward', speed: { from: 1, to: 1 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };
    const [project] = withMod(withMod(song(), [effect('pitch', '1/16', [3])], 0, 8)[0], [tape], 8, 8, 'modB');
    expect(clips(project)).toEqual([]);
  });

  it('where A and B both have one, each clip is a stretch where it plays: B over A', () => {
    const [a] = withMod(song(), [effect('reverse', 'beat', [1])], 0, 16);
    const [project] = withMod(a, [newScratch()], 4, 4, 'modB');
    expect(clips(project)).toEqual([
      { time: 0, end: 4 },
      { time: 4, end: 8 },
      { time: 8, end: 16 },
    ]);
  });
});
