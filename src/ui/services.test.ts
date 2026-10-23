// Web Audio in Node, with views that keep their buffers alive.
import '../test/web-audio';
import { describe, expect, it } from 'vitest';
import type { Command, Id, ModEffect, Project, StepEffect } from '../model';
import { addClip, addSample, createLoop, createMod, createProject, newScratch, newStepEffect, setBpm, setSongBars, setStep } from '../model';
import { midiPlan } from '../engine';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { renderers } from './services';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}
const withMod = (project: Project, effects: readonly ModEffect[], start: number, length: number, row: 'modA' | 'modB'): Project => {
  const made = run(project, createMod('M', effects));
  return run(made, addClip(row, Object.keys(made.mods).find((k) => !(k in project.mods))! as Id, start, length));
};

describe('the song take the exports get', () => {
  it('keeps what is heard, Scratch, the audio mods and where their clips are, so a Stutter and a Scratch are pieces of their own', async () => {
    let project = run(createProject(), setBpm(120), setSongBars(2), addSample({ name: 's', audio: constantAudio(0.05) }), createLoop(null, 'main', 1));
    const pad = Object.values(project.pads)[0]!.id;
    const loop = Object.values(project.loops)[0]!.id;
    project = run(project, ...[0, 4, 8, 12].map((i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 32));
    const roll: StepEffect = { ...newStepEffect('stutter'), step: '1/16', lane: [1, 2, 3, 3].map((v) => ({ v })) };
    project = withMod(withMod(project, [roll], 8, 8, 'modA'), [newScratch()], 20, 8, 'modB');

    const take = await renderers().renderSong(project);
    expect(take.audioClips).toEqual([
      { time: 1, end: 2 },
      { time: 2.5, end: 3.5 },
    ]);
    expect(take.splices?.length).toBeGreaterThan(0);
    expect(take.scratches?.length).toBeGreaterThan(0);
    expect(take.heard?.length).toBe(take.triggers.length);
    expect(midiPlan(project, take).pieces.filter((p) => p.kind === 'audio')).toHaveLength(2);
  });

  it('a clip with Trance gate is a piece of its own in the exports, and the take keeps its gates (Magnus beslut 2026-10-23)', async () => {
    let project = run(createProject(), setBpm(120), setSongBars(2), addSample({ name: 's', audio: constantAudio(0.05) }), createLoop(null, 'main', 1));
    const pad = Object.values(project.pads)[0]!.id;
    const loop = Object.values(project.loops)[0]!.id;
    project = run(project, ...[0, 4, 8, 12].map((i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 32));
    project = withMod(project, [newStepEffect('tranceGate')], 8, 8, 'modA');
    const take = await renderers().renderSong(project);
    expect(take.audioClips).toEqual([{ time: 1, end: 2 }]);
    expect(take.gates).toHaveLength(1);
    expect(midiPlan(project, take).pieces.filter((p) => p.kind === 'audio')).toHaveLength(1);
  });
});
