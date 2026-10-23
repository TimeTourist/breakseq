import { describe, expect, it } from 'vitest';
import type { Command, Id, LaneStep, ModEffect, ModTranceGate, Project, StepEffect } from '../model';
import { addClip, addSample, clearTranceGate, createLoop, createMod, createProject, newStepEffect, rerollMod, setBpm, setSongBars, setStep, stepDuration } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import type { Gate } from './trance-gate';
import { gateGain } from './trance-gate';

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

function withMod(project: Project, effects: readonly ModEffect[], start: number, length: number, row: 'modA' | 'modB' = 'modA'): [Project, Id] {
  const before = project;
  const made = run(project, createMod('M', effects));
  const id = Object.keys(made.mods).find((k) => !(k in before.mods))!;
  return [run(made, addClip(row, id, start, length)), id];
}

const gate = (values: readonly (number | LaneStep)[], settings: Partial<ModTranceGate> = {}, step: StepEffect['step'] = '1/16'): StepEffect => ({
  ...newStepEffect('tranceGate'),
  step,
  lane: values.map((v) => (typeof v === 'number' ? { v } : v)),
  tranceGate: { depth: '-inf', open: 50, smooth: 5, ...settings },
});

const gates = (project: Project): readonly Gate[] => generateTake(project).gates ?? [];
/** The level the gates leave at song time `t`. */
const level = (project: Project, t: number) => gates(project).reduce((g, x) => g * gateGain(x, t), 1);

describe('Trance gate (Magnus beslut 2026-10-23)', () => {
  it('Straight: each open 1/16 is heard for Open of its length, and closed after it at Depth −∞ (silent)', () => {
    const [project] = withMod(song(), [newStepEffect('tranceGate')], 0, 16);
    for (let k = 0; k < 16; k++) {
      expect(level(project, (k + 0.25) * STEP)).toBe(1);
      expect(level(project, (k + 0.85) * STEP)).toBe(0);
    }
  });

  it('a closed step is at Depth all through: −12 dB', () => {
    const [project] = withMod(song(), [gate([1, 0, 0, 1], { depth: -12 })], 0, 4);
    expect(level(project, 1.5 * STEP)).toBeCloseTo(10 ** (-12 / 20), 9);
    expect(level(project, 2.5 * STEP)).toBeCloseTo(10 ** (-12 / 20), 9);
    expect(level(project, 0.25 * STEP)).toBe(1);
  });

  it('Open 25, 75 and 100 % open that much of the step', () => {
    for (const open of [25, 75] as const) {
      const [project] = withMod(song(), [gate([1], { open, smooth: 1 })], 0, 4);
      expect(level(project, (open / 100 - 0.05) * STEP)).toBe(1);
      expect(level(project, (open / 100) * STEP + 0.002)).toBe(0);
    }
    const [whole] = withMod(song(), [gate([1, 0], { open: 100, smooth: 1 })], 0, 4);
    expect(level(whole, 0.99 * STEP)).toBe(1);
    expect(level(whole, 1.5 * STEP)).toBe(0);
  });

  it('every edge goes over Smooth ms: up from where an open step starts, down from where its open part ends', () => {
    const smooth = 0.02;
    const [project] = withMod(song(), [gate([0, 1], { smooth: 20 })], 0, 4);
    const opens = STEP;
    expect(level(project, opens)).toBeCloseTo(0, 9);
    expect(level(project, opens + smooth / 2)).toBeCloseTo(0.5, 9);
    expect(level(project, opens + smooth)).toBeCloseTo(1, 9);
    const closes = STEP * 1.5;
    expect(level(project, closes)).toBeCloseTo(1, 9);
    expect(level(project, closes + smooth / 4)).toBeCloseTo(0.75, 9);
    expect(level(project, closes + smooth)).toBeCloseTo(0, 9);
  });

  it('only under its clip: before and after it the level is 1, and it gets there by the clip’s end', () => {
    const [project] = withMod(song(), [gate([0])], 8, 4);
    expect(level(project, 8 * STEP - 1e-6)).toBe(1);
    expect(level(project, 10 * STEP)).toBe(0);
    expect(level(project, 12 * STEP)).toBe(1);
    expect(level(project, 30 * STEP)).toBe(1);
  });

  it('Clear: every step open and Open 100 %, so the level is 1 all through, as without the gate', () => {
    const [project] = withMod(song(), [clearTranceGate(gate([0, 1, { lo: 0, hi: 1, chance: 25 }, 0], { depth: -24, open: 25 }))], 0, 16);
    for (let t = 0; t < 16 * STEP; t += STEP / 7) expect(level(project, t)).toBe(1);
  });

  it('with Trance gate in A and B, B’s plays where they meet', () => {
    const [a] = withMod(song(), [gate([1], { open: 100 })], 0, 16);
    const [project] = withMod(a, [gate([0])], 4, 4, 'modB');
    expect(level(project, 2.5 * STEP)).toBe(1);
    expect(level(project, 5.5 * STEP)).toBe(0);
    expect(level(project, 10.5 * STEP)).toBe(1);
  });

  it('a 🎲 step is open by its chance, rolled from the seeds: the same every time, other after Reroll this mod', () => {
    const [project, id] = withMod(song(), [gate([{ lo: 0, hi: 1, chance: 50 }], { open: 100 })], 0, 64);
    const opens = (p: Project) => Array.from({ length: 64 }, (_, k) => level(p, (k + 0.5) * STEP));
    const first = opens(project);
    expect(new Set(first)).toEqual(new Set([0, 1]));
    expect(opens(project)).toEqual(first);
    expect(opens(run(project, rerollMod(id)))).not.toEqual(first);
  });

  it('a clip with Trance gate is a clip with an audio mod: the export cuts it as a piece of its own', () => {
    const [project] = withMod(song(), [gate([1])], 4, 8);
    expect((generateTake(project).audioClips ?? []).map((c) => [c.time / STEP, c.end / STEP])).toEqual([[4, 12]]);
  });

  it('is not an audio mod that splices: it only changes the level', () => {
    const [project] = withMod(song(), [gate([1, 0])], 0, 16);
    expect(generateTake(project).splices ?? []).toEqual([]);
  });
});
