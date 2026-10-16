// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, renameLoop } from '../model';
import { listSnapshots, readManifest, saveSnapshot, writeManifest } from '../engine';
import { constantAudio, memoryFolder, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { FolderService } from './folders';
import type { Player } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();
function build(...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
}

/** Services whose folder picker hands out `folders` in turn. */
function services(folders: ReturnType<typeof memoryFolder>[]): Services {
  const queue = [...folders];
  const folderService: FolderService = { supported: true, pick: async () => queue.shift() ?? null, remembered: async () => null };
  const player = {
    play: vi.fn(),
    replace: vi.fn(),
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
    renderSong: vi.fn(),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
    folders: folderService,
  };
}

async function setup(project: Project, folders: ReturnType<typeof memoryFolder>[]): Promise<Store> {
  const store = createStore({ ...initialState(project), view: 'project' });
  render(<App store={store} services={services(folders)} />);
  await act(async () => {});
  return store;
}

/** Clicks and lets the folder work finish. */
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
const loopName = (store: Store) => Object.values(present(store).loops)[0]?.name;
const snapshots = () => screen.getByRole('region', { name: 'Snapshots' });

describe('Project', () => {
  it('New keeps the work as "Start"; a change shows changed, and Save clears it', async () => {
    const folder = memoryFolder('Amen');
    const store = await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(0.2) }), createLoop('M1', 'main', 1)), [folder]);

    await click('New');
    await answer('Keep the current work');
    expect(within(snapshots()).getByText('Start')).toBeTruthy();
    expect(within(snapshots()).getByText('active')).toBeTruthy();
    expect(within(snapshots()).queryByText('changed')).toBeNull();
    expect((await readManifest(folder))?.active).toMatch(/^snapshots\/.* Start\.json$/);

    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, 'Groove') });
    });
    expect(within(snapshots()).getByText('changed')).toBeTruthy();

    await click('Save');
    expect(within(snapshots()).queryByText('changed')).toBeNull();
    expect((await listSnapshots(folder)).map((s) => s.name)).toEqual(['Start']);
  });

  it('a new snapshot becomes active and leaves the old one; loading the old one asks first, and Discard brings it back with a fresh undo', async () => {
    const folder = memoryFolder('Amen');
    const store = await setup(build(createLoop('basic', 'main', 1)), [folder]);
    await click('New');
    await answer('Keep the current work');

    // A change, kept as a new snapshot.
    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, 'Hek-tick') });
    });
    // New snapshot in the header asks for a name.
    await click('New snapshot');
    fireEvent.change(screen.getByRole('textbox', { name: 'New snapshot name' }), { target: { value: 'Hek-tick Amen groove' } });
    await click('Keep');
    expect((await listSnapshots(folder)).map((s) => s.name).sort()).toEqual(['Hek-tick Amen groove', 'Start']);
    const activeRow = within(snapshots()).getByText('active').closest('.snapshot-row')!;
    expect(activeRow.textContent).toContain('Hek-tick Amen groove');

    // Another change, not saved: loading Start asks.
    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, 'Unsaved') });
    });
    await click('Load Start');
    expect(screen.getByRole('dialog').textContent).toContain('not in “Hek-tick Amen groove”');
    await answer('Discard changes');

    expect(loopName(store)).toBe('basic');
    expect(store.getState().history.past).toHaveLength(0);
    // The newer snapshot is untouched.
    const hek = (await listSnapshots(folder)).find((s) => s.name === 'Hek-tick Amen groove')!;
    expect(new TextDecoder().decode((await folder.read(hek.file))!)).toContain('Hek-tick');
    expect(new TextDecoder().decode((await folder.read(hek.file))!)).not.toContain('Unsaved');
  });

  it('Save first, then load: the changes go into the active snapshot before the other one loads', async () => {
    const folder = memoryFolder('Amen');
    const store = await setup(build(createLoop('basic', 'main', 1)), [folder]);
    await click('New');
    await answer('Keep the current work');
    // New snapshot in the header asks for a name.
    await click('New snapshot');
    fireEvent.change(screen.getByRole('textbox', { name: 'New snapshot name' }), { target: { value: 'Second' } });
    await click('Keep');
    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, 'Kept') });
    });
    await click('Load Start');
    await answer('Save first');
    expect(loopName(store)).toBe('basic');
    const second = (await listSnapshots(folder)).find((s) => s.name === 'Second')!;
    expect(new TextDecoder().decode((await folder.read(second.file))!)).toContain('Kept');
  });

  it('Open loads the active snapshot of a folder that has a project', async () => {
    const folder = memoryFolder('Old');
    const old = build(createLoop('From disk', 'main', 1));
    const info = await saveSnapshot(folder, old, 'Saved earlier', new Date(2026, 9, 15, 19, 20));
    await writeManifest(folder, info.file);

    const store = await setup(createProject(), [folder]);
    await click('Open');
    expect(loopName(store)).toBe('From disk');
    expect(within(snapshots()).getByText('Saved earlier')).toBeTruthy();
  });

  it('New in a folder that already has a project says to use Open', async () => {
    const folder = memoryFolder('Old');
    await writeManifest(folder, null);
    await setup(createProject(), [folder]);
    await click('New');
    expect(screen.getByRole('alert').textContent).toBe('“Old” already has a project: use Open');
  });

  it('is the seventh view: key 7 opens it', async () => {
    const store = createStore({ ...initialState(createProject()), view: 'import' });
    render(<App store={store} services={services([])} />);
    await act(async () => {});
    fireEvent.keyDown(window, { key: '7' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Project');
  });
});
