import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, newProject, renameLoop } from '../model';
import { constantAudio, memoryFolder, sequentialIds } from '../test/fixtures';
import { comparable, listSnapshots, loadSnapshot, readManifest, saveSnapshot, writeManifest } from './project-folder';

const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const amen = () => run(newProject(), addSample({ name: 'amen.wav', audio: constantAudio(0.5, [0.25, -0.5]) }), createLoop('M1', 'main', 1));

describe('snapshots in a project folder', () => {
  it('a snapshot loads back as the same project, audio and all', async () => {
    const folder = memoryFolder();
    const project = amen();
    const info = await saveSnapshot(folder, project, 'basic Amen groove', new Date(2026, 9, 15, 19, 20));

    expect(info).toMatchObject({ file: 'snapshots/2026-10-15 19.20 basic Amen groove.json', name: 'basic Amen groove' });
    const loaded = await loadSnapshot(folder, info.file);
    expect(comparable(loaded)).toBe(comparable(project));
    const [id] = Object.keys(project.audio);
    expect(Array.from(loaded.audio[id!]!.channels[1]!.slice(0, 3))).toEqual([-0.5, -0.5, -0.5]);
    expect(folder.files.has(`audio/${id}.wav`)).toBe(true);
  });

  it('writes each audio once: a second snapshot only writes its own file', async () => {
    const folder = memoryFolder();
    const project = amen();
    await saveSnapshot(folder, project, 'one', new Date(2026, 9, 15, 19, 20));
    const before = folder.writes.length;
    await saveSnapshot(folder, run(project, renameLoop(Object.keys(project.loops)[0]!, 'Groove')), 'two', new Date(2026, 9, 15, 20, 30));
    expect(folder.writes.slice(before)).toEqual(['snapshots/2026-10-15 20.30 two.json']);
  });

  it('lists the newest first; the same name in the same minute gets its own file; saving to a file writes over it', async () => {
    const folder = memoryFolder();
    const project = amen();
    const at = new Date(2026, 9, 15, 20, 30);
    const a = await saveSnapshot(folder, project, 'Groove', new Date(2026, 9, 15, 19, 20));
    const b = await saveSnapshot(folder, project, 'Groove', at);
    const c = await saveSnapshot(folder, project, 'Groove', at);
    expect(c.file).toBe('snapshots/2026-10-15 20.30 Groove (2).json');
    const listed = (await listSnapshots(folder)).map((s) => s.file);
    expect(listed).toHaveLength(3);
    expect(listed.slice(0, 2).sort()).toEqual([b.file, c.file].sort());
    expect(listed[2]).toBe(a.file);

    await saveSnapshot(folder, run(project, renameLoop(Object.keys(project.loops)[0]!, 'Changed')), 'Groove', new Date(2026, 9, 15, 21, 0), a.file);
    expect((await listSnapshots(folder)).map((s) => s.file)[0]).toBe(a.file);
    expect(Object.values((await loadSnapshot(folder, a.file)).loops)[0]!.name).toBe('Changed');
  });

  it('a name that is not safe on disk still makes a file', async () => {
    const info = await saveSnapshot(memoryFolder(), amen(), 'a/b: c?', new Date(2026, 9, 15, 20, 30));
    expect(info.file).toBe('snapshots/2026-10-15 20.30 a-b- c-.json');
  });

  it('the manifest names the active snapshot', async () => {
    const folder = memoryFolder();
    expect(await readManifest(folder)).toBeNull();
    await writeManifest(folder, 'snapshots/x.json');
    expect(await readManifest(folder)).toMatchObject({ format: 'breakseq-project', active: 'snapshots/x.json' });
  });

  it('comparable changes with the project and ignores the audio data', () => {
    const project = amen();
    expect(comparable(project)).toBe(comparable({ ...project }));
    expect(comparable(run(project, renameLoop(Object.keys(project.loops)[0]!, 'X')))).not.toBe(comparable(project));
  });
});

describe('a snapshot from before Matrix', () => {
  it('is refused with a message', async () => {
    const folder = memoryFolder();
    const info = await saveSnapshot(folder, amen(), 'old', new Date(2026, 9, 15, 19, 20));
    const json = JSON.parse(new TextDecoder().decode(folder.files.get(info.file)!));
    delete json.project.matrices;
    folder.files.set(info.file, new TextEncoder().encode(JSON.stringify(json)));
    await expect(loadSnapshot(folder, info.file)).rejects.toThrow('This project was made before Matrix (phase 22). Open it in the tag fas-21-fore-matrix.');
  });
});
