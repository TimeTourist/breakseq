import { describe, expect, it } from 'vitest';
import type { Command, Id, ModEffect, Project, ScratchEffect } from '../model';
import { SCRATCH_PRESETS, addClip, addSample, clearScratch, createLoop, createMod, createProject, newScratch, setBpm, setScratchLength, setSongBars, setStep, stepDuration } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Splice } from './audio-mods';
import { sourceAt } from './audio-mods';
import { generateTake } from './generate';
import { scratchCells } from './mod-pass';

const ctx = sequentialIds();
const STEP = stepDuration(120);

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

function song(): Project {
  const project = run(createProject(), setBpm(120), setSongBars(4), addSample({ name: 'k', audio: constantAudio(0.05) }), createLoop(null, 'main', 1));
  const pad = Object.values(project.pads)[0]!.id;
  const loop = Object.values(project.loops)[0]!.id;
  return run(project, ...Array.from({ length: 16 }, (_, i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 64));
}

function withMod(project: Project, effects: readonly ModEffect[], start: number, length: number, row: 'modA' | 'modB' = 'modA'): Project {
  const before = project;
  const made = run(project, createMod('M', effects));
  const id = Object.keys(made.mods).find((k) => !(k in before.mods))! as Id;
  return run(made, addClip(row, id, start, length));
}

/** A splice in steps: where it is heard, where in what is heard it reads at its start and end, and its gain. */
const inSteps = (s: Splice) => ({
  at: +(s.time / STEP).toFixed(6),
  length: +(s.length / STEP).toFixed(6),
  from: +(sourceAt(s, 0) / STEP).toFixed(6),
  to: +(sourceAt(s, 1) / STEP).toFixed(6),
  gain: s.gain,
});
const scratches = (project: Project) => (generateTake(project).scratches ?? []).map(inSteps);
const preset = (name: string): ScratchEffect => SCRATCH_PRESETS.find((p) => p.name === name)!.draw(newScratch());

describe('Scratch as splices of what is heard', () => {
  it('Baby plays backwards on every other step, from the recording at the clip’s start', () => {
    const s = scratches(withMod(song(), [preset('Baby')], 16, 16));
    // 8 steps of 1/16 over a clip of 16 steps: the movement twice.
    expect(s).toHaveLength(16);
    // 1 bar recorded from step 16: the needle at 0.1 is 1.6 steps in.
    expect(s[0]).toEqual({ at: 16, length: 1, from: 17.6, to: 20, gain: 1 });
    expect(s[1]).toEqual({ at: 17, length: 1, from: 20, to: 17.6, gain: 1 });
    s.slice(0, 7).forEach((x, j) => expect(x.to > x.from).toBe(j % 2 === 0));
    // The last step carries on forward (to 0.4), then the needle jumps back to the first point: no stroke.
    expect(s[7]).toEqual({ at: 23, length: 1, from: 20, to: 22.4, gain: 1 });
    expect(s[8]!.from).toBe(17.6);
  });

  it('Chirp is silent where the fader is closed', () => {
    const s = scratches(withMod(song(), [preset('Chirp')], 16, 8));
    // Every other cell is split open–closed: two splices, the second silent.
    expect(s.map((x) => [x.at, x.length, x.gain])).toEqual([
      [16, 1, 1],
      [17, 0.5, 1],
      [17.5, 0.5, 0],
      [18, 1, 1],
      [19, 0.5, 1],
      [19.5, 0.5, 0],
      [20, 1, 1],
      [21, 0.5, 1],
      [21.5, 0.5, 0],
      [22, 1, 1],
      [23, 0.5, 1],
      [23.5, 0.5, 0],
    ]);
    // A half reads where the whole step would have: the curve goes on through it.
    expect(s[1]!.to).toBeCloseTo(s[2]!.from, 9);
  });

  it('a held step is silent', () => {
    const held: ScratchEffect = { ...newScratch(), points: [0.2, 0.2, 0.4, 0.5], fader: [[true], [true], [true], [true]] };
    expect(scratches(withMod(song(), [held], 0, 4)).map((x) => x.gain)).toEqual([0, 1, 1, 1]);
  });

  it('Clear reads what is heard just where it is, at 1×', () => {
    const cleared = clearScratch(setScratchLength(newScratch(), 16));
    const s = scratches(withMod(song(), [cleared], 16, 16));
    s.forEach((x, j) => expect(x).toEqual({ at: 16 + j, length: 1, from: 16 + j, to: 17 + j, gain: 1 }));
  });

  it('the needle lane counts from the clip’s content, the recording from where the clip starts on the timeline', () => {
    const project = withMod(song(), [preset('Baby')], 16, 16);
    const clip = project.song.clips.find((c) => c.row === 'modA')!;
    const trimmed = { ...project, song: { ...project.song, clips: project.song.clips.map((c) => (c.id === clip.id ? { ...c, start: 18, length: 14, offset: 2 } : c)) } };
    const s = scratches(trimmed);
    // The clip starts at the movement's step 3 (0.1 → 0.25), and records from step 18.
    expect(s[0]).toEqual({ at: 18, length: 1, from: 19.6, to: 22, gain: 1 });
  });

  it('records 1 beat, 2 beats, 1 bar or 2 bars', () => {
    const s = scratches(withMod(song(), [{ ...preset('Baby'), record: 4 }], 16, 1));
    expect(s[0]).toEqual({ at: 16, length: 1, from: 16.4, to: 17, gain: 1 });
  });

  it('with Scratch in both rows B wins; it plays only under its clip', () => {
    let project = withMod(song(), [preset('Baby')], 16, 16);
    project = withMod(project, [clearScratch(setScratchLength(newScratch(), 16))], 20, 4, 'modB');
    const s = scratches(project);
    expect(s.filter((x) => x.at >= 20 && x.at < 24).every((x) => x.from === x.at)).toBe(true);
    expect(s.filter((x) => x.at < 20)).toHaveLength(4);
    expect(Math.min(...s.map((x) => x.at))).toBe(16);
    expect(Math.max(...s.map((x) => x.at + x.length))).toBe(32);
  });

  it('a take without Scratch has none, and Scratch leaves the triggers for the playhead', () => {
    expect(generateTake(song()).scratches).toEqual([]);
    const project = withMod(song(), [preset('Baby')], 16, 16);
    expect(generateTake(project).triggers).toHaveLength(generateTake(song()).triggers.length);
  });
});

describe('the preview row (scratchCells)', () => {
  it('shows each step of the loop: forward, backward or held, and the fader, looping with the movement', () => {
    const cells = scratchCells(preset('Chirp'), 16);
    expect(cells.slice(0, 4).map((c) => c.motion)).toEqual(['forward', 'forward', 'backward', 'backward']);
    expect(cells[0]!.fader).toEqual([true]);
    expect(cells[1]!.fader).toEqual([true, false]);
    expect(cells.map((c) => c.restart)).toEqual(Array.from({ length: 16 }, (_, i) => i % 8 === 0));
    expect(cells[9]!.scratchStep).toBe(1);
    expect(cells[0]!.speed).toBeCloseTo(1.28);
  });

  it('with steps of a beat a split cell shows its half on each 1/16', () => {
    const cells = scratchCells({ ...preset('Transformer'), step: 'beat' }, 8);
    expect(cells.map((c) => c.fader)).toEqual([[true], [true], [false], [false], [true], [true], [false], [false]]);
  });
});
