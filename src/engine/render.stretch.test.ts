// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { Command, Hit, Project, StepEffect } from '../model';
import { addSample, createLoop, createMod, createProject, hitSeconds, hitStretch, setBpm, setMatrixConfig, setSlicing, setSongCell, setStep, updateHit } from '../model';
import { constantAudio, sequentialIds, withRng } from '../test/fixtures';
import { generateTriggers } from './generate';
import { renderTriggers } from './render';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** A one-bar sample of 2 s (120 BPM) in 16 slices, its M1 in a one-bar song at `bpm`. */
function amen(bpm: number) {
  const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  const id = Object.keys(start.samples)[0]!;
  const project = run(start, setSlicing(id, 1), setBpm(bpm));
  const slice = (n: number): Hit => Object.values(project.hits).find((h) => h.sampleId === id && h.slice === n)!;
  const m1 = Object.values(project.loops)[0]!;
  return { project: run(project, setSongCell('main', 0, m1.id)), slice, m1 };
}

/** The sample's matrix lays its stretch over all its slices: the macro. */
const macro = (project: Project, stretch: Partial<Hit['stretch']>) => {
  const matrix = Object.values(project.matrices)[0]!;
  return run(project, setMatrixConfig(matrix.id, { stretch: { ...matrix.config.stretch, ...stretch } }));
};

const stretched = (project: Project, hit: Hit, stretch: Partial<Hit['stretch']>) => run(project, updateHit(hit.id, { stretch: { ...hit.stretch, ...stretch } }));

describe('stretch on a hit', () => {
  it('Fit to tempo is the break tempo over the song tempo; Off and a one-shot are 1', () => {
    const { project, slice } = amen(150);
    expect(hitStretch(project, slice(0)).factor).toBe(1);
    const fit = stretched(project, slice(0), { mode: 'fit' });
    expect(hitStretch(fit, fit.hits[slice(0).id]!).factor).toBeCloseTo(120 / 150);
    const shot = run(createProject(), addSample({ name: 'snare.wav', audio: constantAudio(0.2) }), setBpm(150));
    const snare = Object.values(shot.hits)[0]!;
    const fitShot = stretched(shot, snare, { mode: 'fit' });
    expect(hitStretch(fitShot, fitShot.hits[snare.id]!).factor).toBe(1);
  });

  it("the matrix is a macro: its factor multiplies the slice's, and a slice takes its grain and grid", () => {
    const { project, slice } = amen(150);
    let p = macro(project, { mode: 'fit', grain: 60, from: 'hit' });
    p = stretched(p, slice(3), { mode: 'factor', factor: 2 });
    expect(hitStretch(p, p.hits[slice(3).id]!)).toEqual({ factor: 2 * (120 / 150), grain: 60, from: 'hit' });
    // A slice's own grain and grid win; with none anywhere, 30 ms from the break.
    expect(hitStretch(project, slice(3))).toEqual({ factor: 1, grain: 30, from: 'sample' });
    p = stretched(p, slice(3), { grain: 10, from: 'sample' });
    expect(hitStretch(p, p.hits[slice(3).id]!)).toMatchObject({ grain: 10, from: 'sample' });
  });

  it('a stretched hit lasts longer in Loops, at its own and its matrix stretch', () => {
    const { project, slice } = amen(120);
    expect(hitSeconds(macro(project, { mode: 'factor', factor: 2 }), slice(0))).toBeCloseTo(0.25);
  });

  it('triggers carry the stretch; unstretched ones none', () => {
    const { project } = amen(150);
    expect(generateTriggers(project, withRng(() => 0)).every((t) => t.stretch === null)).toBe(true);
    const fit = macro(project, { mode: 'fit' });
    expect(generateTriggers(fit, withRng(() => 0))[0]!.stretch).toEqual({ factor: 0.8, grain: 30, from: 'sample' });
  });
});

describe('the Stretch mod', () => {
  const withMod = (project: Project, effect: StepEffect, row: 'modA' | 'modB' = 'modA') => {
    const next = run(project, createMod('m', [effect]));
    const mod = Object.keys(next.mods).find((k) => !(k in project.mods))!;
    return run(next, setSongCell(row, 0, mod));
  };
  const effect = (value: number, combine: 'multiply' | 'replace', grain = 80): StepEffect => ({ target: 'stretch', step: '1/16', lane: [{ v: value }], stretch: { grain, combine } });

  it('Multiply times the hit stretch, Replace instead of it; the mod grain applies', () => {
    const { project } = amen(150);
    const fit = macro(project, { mode: 'fit' });
    expect(generateTriggers(withMod(fit, effect(2, 'multiply')), withRng(() => 0))[0]!.stretch).toEqual({ factor: 1.6, grain: 80, from: 'sample' });
    expect(generateTriggers(withMod(fit, effect(2, 'replace')), withRng(() => 0))[0]!.stretch).toEqual({ factor: 2, grain: 80, from: 'sample' });
  });

  it('B wins over A, and a factor of 1 is no stretch', () => {
    const { project } = amen(120);
    const both = withMod(withMod(project, effect(3, 'replace')), effect(1, 'replace'), 'modB');
    expect(generateTriggers(both, withRng(() => 0))[0]!.stretch).toBeNull();
  });

  it('a step that ignores mods keeps its own stretch', () => {
    const { project, m1 } = amen(120);
    const p = run(withMod(project, effect(2, 'replace')), setStep(m1.id, 0, { ignoreMods: true }));
    const [first, second] = generateTriggers(p, withRng(() => 0));
    expect(first!.stretch).toBeNull();
    expect(second!.stretch?.factor).toBe(2);
  });
});

describe('rendering a stretch', () => {
  const SAMPLE_RATE = 44100;
  /** A song with one 0.1 s one-shot on step 1, at constant level 0.5. */
  function shot(stretch: Partial<Hit['stretch']>, pitch = 0) {
    let project = run(createProject(), setBpm(60), addSample({ name: 's.wav', audio: constantAudio(0.1) }));
    const hit = Object.values(project.hits)[0]!;
    const pad = Object.values(project.pads)[0]!;
    project = run(project, updateHit(hit.id, { pitch, stretch: { ...hit.stretch, ...stretch } }), createLoop('L', 'main', 1));
    const loop = Object.values(project.loops)[0]!;
    return run(project, setStep(loop.id, 0, { padId: pad.id }), setSongCell('main', 0, loop.id));
  }
  const heard = async (project: Project) => {
    const data = (await renderTriggers(generateTriggers(project, withRng(() => 0)), project, SAMPLE_RATE)).getChannelData(0);
    return { data, last: data.findLastIndex((v) => Math.abs(v) > 1e-4) / SAMPLE_RATE };
  };

  it('a factor of 2 plays twice as long, at an even level', async () => {
    const { data, last } = await heard(shot({ mode: 'factor', factor: 2, from: 'hit' }));
    expect(last).toBeCloseTo(0.2, 2);
    // Grains of a steady sound add up to it: the level holds through the middle.
    for (const t of [0.03, 0.08, 0.13, 0.17]) expect(data[Math.round(t * SAMPLE_RATE)]).toBeCloseTo(0.5, 1);
  });

  it('twice as long and an octave up keeps the length', async () => {
    const { last } = await heard(shot({ mode: 'factor', factor: 2, from: 'hit' }, 12));
    expect(last).toBeCloseTo(0.1, 2);
  });
});
