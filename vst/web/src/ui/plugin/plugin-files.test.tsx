// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../../model';
import { createLoop, createProject, newProject, renameLoop } from '../../model';
import { breakseqFolder, listSnapshots, loadSnapshot, readManifest, saveSnapshot, writeManifest } from '../../engine';
import { memoryFolder, sequentialIds } from '../../test/fixtures';
import { App } from '../App';
import type { FolderService } from '../folders';
import type { Player } from '../playback';
import type { Services } from '../services';
import type { Store } from '../store';
import { createStore, initialState } from '../store';
import type { Bridge } from './bridge';
import { base64ToBytes, bytesToBase64 } from './bridge';
import { pluginFiles } from './plugin-files';

afterEach(cleanup);

const ctx = sequentialIds();
function build(...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, newProject(ctx));
}

/**
 * The C++ side as far as .breakseq files go: a disk of base64 files, Windows'
 * dialogs answering with the paths in `answers` in turn, and the song's file.
 */
function fakeHost() {
  const disk = new Map<string, string>();
  const answers: string[] = [];
  const writes: string[] = [];
  let songFile: string | null = null;
  const name = (path: string) => path.split('\\').at(-1)!;
  const bridge: Bridge = {
    call: async (fn, ...params) => {
      const path = params[0] as string;
      switch (fn) {
        case 'openProjectFile': {
          const picked = answers.shift();
          if (picked === undefined || !disk.has(picked)) return null;
          songFile = picked;
          return { path: picked, name: name(picked), data: disk.get(picked) };
        }
        case 'newProjectFile': {
          const picked = answers.shift();
          return picked === undefined ? null : { path: picked, name: name(picked) };
        }
        case 'projectFile':
          return songFile === null ? null : { path: songFile, name: name(songFile) };
        case 'readProjectFile':
          return disk.get(path) ?? null;
        case 'writeProjectFile':
          disk.set(path, params[1] as string);
          writes.push(path);
          songFile = path;
          return true;
        default:
          return null;
      }
    },
    on: () => () => {},
  };
  /** A file on the fake disk as a folder, to look into. */
  const open = (path: string) => breakseqFolder(name(path), base64ToBytes(disk.get(path)!), async () => undefined);
  return { bridge, disk, answers, writes, open, songFile: () => songFile };
}

function services(folders: FolderService): Services {
  const player = {
    play: vi.fn(),
    replace: vi.fn(),
    queue: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    currentPosition: () => null,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  } satisfies Player;
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: vi.fn(() => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] })),
    download: vi.fn(),
    rng: () => () => 0,
    folders,
  };
}

const oldFolders = (...folders: ReturnType<typeof memoryFolder>[]): FolderService => ({ supported: true, pick: async () => folders.shift() ?? null, remembered: async () => null });

async function setup(project: Project, host: ReturnType<typeof fakeHost>, legacy = oldFolders()): Promise<Store> {
  const store = createStore({ ...initialState(project), view: 'project' });
  render(<App store={store} services={services(pluginFiles(host.bridge, legacy))} />);
  await act(async () => {});
  return store;
}

const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};
const answer = async (label: string) => {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
  });
};
const present = (store: Store) => store.getState().history.present;
const rename = async (store: Store, name: string) => {
  await act(async () => {
    store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, name) });
  });
};
const snapshots = () => screen.getByRole('region', { name: 'Snapshots' });

describe('projects as .breakseq files in the plugin', () => {
  it('New names a file, which is written once when the project starts, and the song keeps it', async () => {
    const host = fakeHost();
    host.answers.push('C:\\Music\\crazy-amen.breakseq');
    await setup(build(createLoop('basic', 'main', 1)), host);
    expect(screen.getByText(/A project is a \.breakseq file/)).toBeTruthy();

    await click('New');
    expect(host.writes).toEqual([]);
    await answer('Keep the current work');

    expect(host.writes).toEqual(['C:\\Music\\crazy-amen.breakseq']);
    expect(host.songFile()).toBe('C:\\Music\\crazy-amen.breakseq');
    expect(screen.getByText('In “crazy-amen.breakseq”.')).toBeTruthy();
    expect((await listSnapshots(host.open('C:\\Music\\crazy-amen.breakseq'))).map((s) => s.name)).toEqual(['Start']);
  });

  it('Save and New snapshot write the file; the song opens it again with its snapshots', async () => {
    const host = fakeHost();
    host.answers.push('C:\\Music\\crazy-amen.breakseq');
    const store = await setup(build(createLoop('basic', 'main', 1)), host);
    await click('New');
    await answer('Keep the current work');

    await rename(store, 'Hek-tick');
    await click('New snapshot');
    fireEvent.change(screen.getByRole('textbox', { name: 'New snapshot name' }), { target: { value: 'Hek-tick' } });
    await click('Keep');
    await rename(store, 'Saved');
    await click('Save');
    expect(host.writes).toHaveLength(3);

    // The song is opened again: the work comes from the song, the file from where the song says.
    cleanup();
    const again = await setup(present(store), host);
    expect(screen.getByText('In “crazy-amen.breakseq”.')).toBeTruthy();
    expect(within(snapshots()).queryByText('changed')).toBeNull();
    expect(within(snapshots()).getByText('Start')).toBeTruthy();
    expect(Object.values(present(again).loops)[0]?.name).toBe('Saved');
  });

  it('Save as… puts every snapshot and the work in a new file and goes on there; the first file is as it was', async () => {
    const host = fakeHost();
    host.answers.push('C:\\Music\\crazy-amen.breakseq', 'C:\\Music\\crazy-amen-2.breakseq');
    const store = await setup(build(createLoop('basic', 'main', 1)), host);
    await click('New');
    await answer('Keep the current work');
    await rename(store, 'Changed');

    await click('Save as…');

    expect(screen.getByText('In “crazy-amen-2.breakseq”.')).toBeTruthy();
    expect(within(snapshots()).queryByText('changed')).toBeNull();
    const second = host.open('C:\\Music\\crazy-amen-2.breakseq');
    const active = (await readManifest(second))!.active!;
    expect(Object.values((await loadSnapshot(second, active)).loops)[0]?.name).toBe('Changed');
    const first = host.open('C:\\Music\\crazy-amen.breakseq');
    expect(Object.values((await loadSnapshot(first, (await readManifest(first))!.active!)).loops)[0]?.name).toBe('basic');
    expect(host.songFile()).toBe('C:\\Music\\crazy-amen-2.breakseq');
  });

  it('Open opens a .breakseq at its active snapshot', async () => {
    const host = fakeHost();
    const file = breakseqFolder('groove.breakseq', null, async (bytes) => void host.disk.set('C:\\groove.breakseq', bytesToBase64(bytes)));
    const info = await saveSnapshot(file, build(createLoop('groove', 'main', 1)), 'Start', new Date());
    await writeManifest(file, info.file);
    await file.flush?.();
    host.answers.push('C:\\groove.breakseq');

    const store = await setup(createProject(), host);
    await click('Open');
    expect(Object.values(present(store).loops)[0]?.name).toBe('groove');
    expect(screen.getByText('In “groove.breakseq”.')).toBeTruthy();
  });

  it('Import folder… makes an old project folder into a new .breakseq and opens it; the folder is not touched', async () => {
    const folder = memoryFolder('Crazy Amen');
    const info = await saveSnapshot(folder, build(createLoop('old', 'main', 1)), 'Start', new Date());
    await writeManifest(folder, info.file);
    const before = [...folder.files.keys()];
    const host = fakeHost();
    host.answers.push('C:\\Music\\crazy-amen.breakseq');

    const store = await setup(createProject(), host, oldFolders(folder));
    await click('Import folder…');

    expect(Object.values(present(store).loops)[0]?.name).toBe('old');
    expect(screen.getByText('In “crazy-amen.breakseq”.')).toBeTruthy();
    expect((await listSnapshots(host.open('C:\\Music\\crazy-amen.breakseq'))).map((s) => s.name)).toEqual(['Start']);
    expect([...folder.files.keys()]).toEqual(before);
  });

  it('a file that is not a project says so', async () => {
    const host = fakeHost();
    host.disk.set('C:\\notes.breakseq', bytesToBase64(new Uint8Array([1, 2, 3])));
    host.answers.push('C:\\notes.breakseq');
    await setup(createProject(), host);
    await click('Open');
    expect(screen.getByRole('alert').textContent).toBe('“notes.breakseq” is not a Breakseq project');
  });
});
