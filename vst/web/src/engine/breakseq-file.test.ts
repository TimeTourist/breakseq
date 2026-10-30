import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, newProject } from '../model';
import { constantAudio, memoryFolder, sequentialIds } from '../test/fixtures';
import { breakseqFolder, readBreakseqFile } from './breakseq-file';
import { comparable, copyProject, listSnapshots, loadSnapshot, readManifest, saveSnapshot, writeManifest } from './project-folder';
import { ProjectFileError } from './project-file';

const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const amen = () => run(newProject(), addSample({ name: 'amen.wav', audio: constantAudio(0.5, [0.25, -0.5]) }), createLoop('M1', 'main', 1));

/** A .breakseq that keeps what it writes, as the disk would. */
function disk() {
  const written: Uint8Array[] = [];
  return { written, persist: async (bytes: Uint8Array) => void written.push(bytes) };
}

describe('a project in one .breakseq file', () => {
  it('snapshots go in and come back out of the file, audio and all', async () => {
    const d = disk();
    const file = breakseqFolder('crazy-amen.breakseq', null, d.persist);
    const project = amen();
    const info = await saveSnapshot(file, project, 'Start', new Date(2026, 9, 30, 21, 15));
    await writeManifest(file, info.file);
    await file.flush?.();

    const opened = breakseqFolder('crazy-amen.breakseq', d.written.at(-1)!, d.persist);
    expect((await readManifest(opened))?.active).toBe(info.file);
    expect((await listSnapshots(opened)).map((s) => s.name)).toEqual(['Start']);
    expect(comparable(await loadSnapshot(opened, info.file))).toBe(comparable(project));
  });

  it('is written once per flush, not per file, and not at all with nothing new', async () => {
    const d = disk();
    const file = breakseqFolder('a.breakseq', null, d.persist);
    await saveSnapshot(file, amen(), 'Start', new Date());
    await writeManifest(file, null);
    expect(d.written).toHaveLength(0);
    await file.flush?.();
    await file.flush?.();
    expect(d.written).toHaveLength(1);
  });

  it('keeps the audio as it is and packs the JSON', async () => {
    const d = disk();
    const file = breakseqFolder('a.breakseq', null, d.persist);
    await saveSnapshot(file, amen(), 'Start', new Date());
    await writeManifest(file, null);
    await file.flush?.();
    const entries = unzipSync(d.written[0]!);
    expect(Object.keys(entries).some((p) => p.startsWith('audio/') && p.endsWith('.wav'))).toBe(true);
    expect(Object.keys(entries)).toContain('breakseq.json');
  });

  it('a file that is not a project is refused', () => {
    expect(() => readBreakseqFile(new Uint8Array([1, 2, 3]), 'notes.txt')).toThrow(ProjectFileError);
    expect(() => breakseqFolder('empty.breakseq', emptyZip(), async () => undefined)).toThrow('“empty.breakseq” is not a Breakseq project');
  });

  it('lists the files at the top as well as in a directory', async () => {
    const file = breakseqFolder('a.breakseq', null, async () => undefined);
    await writeManifest(file, null);
    await saveSnapshot(file, amen(), 'Start', new Date());
    expect(await file.list('')).toEqual(['breakseq.json']);
    expect(await file.list('snapshots')).toHaveLength(1);
  });
});

describe('copying a project', () => {
  it('an old folder becomes a .breakseq with every snapshot and the same one active', async () => {
    const folder = memoryFolder('Crazy Amen');
    const first = await saveSnapshot(folder, amen(), 'Start', new Date(2026, 9, 1, 10, 0));
    await saveSnapshot(folder, amen(), 'Later', new Date(2026, 9, 2, 10, 0));
    await writeManifest(folder, first.file);

    const d = disk();
    const file = breakseqFolder('crazy-amen.breakseq', null, d.persist);
    await copyProject(folder, file);
    await file.flush?.();

    expect(d.written).toHaveLength(1);
    const opened = breakseqFolder('crazy-amen.breakseq', d.written[0]!, d.persist);
    expect((await readManifest(opened))?.active).toBe(first.file);
    expect((await listSnapshots(opened)).map((s) => s.name)).toEqual(['Later', 'Start']);
    expect(comparable(await loadSnapshot(opened, first.file))).toBe(comparable(await loadSnapshot(folder, first.file)));
  });

  it('a folder without a project is refused', async () => {
    await expect(copyProject(memoryFolder('Empty'), breakseqFolder('a.breakseq', null, async () => undefined))).rejects.toThrow('“Empty” is not a Breakseq project');
  });
});

/** A zip with nothing in it. */
function emptyZip(): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]);
}
