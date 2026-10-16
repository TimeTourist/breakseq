import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, setBreak, setSongCell, sliceBreak } from '../model';
import { seededRng, sequentialIds } from '../test/fixtures';
import { ProjectFileError, readProjectFile, writeProjectFile } from './project-file';

// One id counter per file, so ids never repeat between calls.
const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

describe('project file', () => {
  it('writes and reads back the same project, with the audio bit for bit', () => {
    const rng = seededRng(3);
    const noise = () => Float32Array.from({ length: 4410 }, () => rng() * 2 - 1);
    let project = run(createProject(), addSample({ name: 'amen.wav', audio: { sampleRate: 48000, channels: [noise(), noise()] } }));
    const id = Object.keys(project.breaks)[0]!;
    project = run(project, setBreak(id, 1), sliceBreak(id, 1, 4), createLoop(null, 'fill', 1));
    project = run(project, setSongCell('main', 2, Object.values(project.loops)[0]!.id));

    const back = readProjectFile(writeProjectFile(project));

    expect(back).toEqual(project);
  });

  it('refuses files from a newer version, and files that are not projects', () => {
    const newer = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'breakseq', version: 99, project: {} })) });
    expect(() => readProjectFile(newer)).toThrow(/newer version/);
    expect(() => readProjectFile(strToU8('not a zip'))).toThrow(ProjectFileError);
    expect(() => readProjectFile(zipSync({ 'other.txt': strToU8('x') }))).toThrow(ProjectFileError);
  });
});
