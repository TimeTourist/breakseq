import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBreak, setMarkers } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { hitSteps, padSteps } from './labels';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

describe('how many steps a hit takes when placed', () => {
  it('a slice: from where it lands on its break’s grid to where the next one does', () => {
    const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(start.breaks)[0]!;
    const project = run(start, setBreak(id, 1), setMarkers(id, [0, 0.125, 0.25]));
    const pads = project.breaks[id]!.pads.slice(0, 3).map((p) => project.pads[p]!);
    expect(pads.map((p) => padSteps(project, p))).toEqual([2, 2, 12]);
  });

  it('a one-shot: its sound in the song’s tempo, rounded up', () => {
    const project = run(createProject(), addSample({ name: 'kick.wav', audio: constantAudio(0.2) }));
    const hit = Object.values(project.hits)[0]!;
    expect(hitSteps(project, hit)).toBe(Math.ceil(0.2 / (60 / project.song.bpm / 4) - 1e-9));
  });
});
