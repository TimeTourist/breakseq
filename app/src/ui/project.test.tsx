// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, renameLoop, setBpm } from '../model';
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
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
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
/** Answers Are you sure?, which every Load asks with unsaved changes (Magnus beslut). */
const sure = async (label: 'Yes, load' | 'Cancel') => {
  const dialog = screen.getByRole('alertdialog', { name: 'Are you sure?' });
  expect(dialog.textContent).toContain('Changes since last save are lost.');
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
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
  it('New snapshot looks off while it is off (no project folder), and primary once there is one (U17)', async () => {
    const folder = memoryFolder('Amen');
    await setup(build(createLoop('basic', 'main', 1)), [folder]);
    const button = () => screen.getByRole('button', { name: 'New snapshot' });
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(button().classList.contains('primary')).toBe(false);
    await click('New');
    await answer('Keep the current work');
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    expect(button().classList.contains('primary')).toBe(true);
  });

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

  it('a new snapshot becomes active and leaves the old one; loading the old one asks Are you sure?, and Yes brings it back with a fresh undo', async () => {
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
    await sure('Yes, load');

    expect(loopName(store)).toBe('basic');
    expect(store.getState().history.past).toHaveLength(0);
    // The newer snapshot is untouched.
    const hek = (await listSnapshots(folder)).find((s) => s.name === 'Hek-tick Amen groove')!;
    expect(new TextDecoder().decode((await folder.read(hek.file))!)).toContain('Hek-tick');
    expect(new TextDecoder().decode((await folder.read(hek.file))!)).not.toContain('Unsaved');
  });

  it('Load on the active snapshot, on Project or in the header, goes back to it as saved after Are you sure?', async () => {
    const folder = memoryFolder('Amen');
    const store = await setup(build(createLoop('basic', 'main', 1)), [folder]);
    await click('New');
    await answer('Keep the current work');
    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, 'Unsaved') });
    });
    await click('Load Start');
    await sure('Yes, load');
    expect(loopName(store)).toBe('basic');
    expect(store.getState().history.past).toHaveLength(0);
    // The header's Load: off with nothing changed, as Save is.
    const headerLoad = () => screen.getByRole('button', { name: 'Load' });
    expect(headerLoad()).toHaveProperty('disabled', true);
    expect(headerLoad().title).toBe('Load the active snapshot as last saved');
    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, 'Again') });
    });
    expect(headerLoad()).toHaveProperty('disabled', false);
    await click('Load');
    await sure('Cancel');
    expect(loopName(store)).toBe('Again');
    await click('Load');
    await sure('Yes, load');
    expect(loopName(store)).toBe('basic');
    expect(headerLoad()).toHaveProperty('disabled', true);
  });

  it('with no unsaved changes a snapshot loads straight away, without asking', async () => {
    const folder = memoryFolder('Amen');
    const store = await setup(build(createLoop('basic', 'main', 1)), [folder]);
    await click('New');
    await answer('Keep the current work');
    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(present(store).loops)[0]!, 'Kept') });
    });
    await click('New snapshot');
    fireEvent.change(screen.getByRole('textbox', { name: 'New snapshot name' }), { target: { value: 'Second' } });
    await click('Keep');
    await click('Load Start');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(loopName(store)).toBe('basic');
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

  it('is the sixth tab: key 6 opens it', async () => {
    const store = createStore({ ...initialState(createProject()), view: 'samples' });
    render(<App store={store} services={services([])} />);
    await act(async () => {});
    fireEvent.keyDown(window, { key: '6' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Project');
  });
});

describe('a snapshot played from Project', () => {
  it('plays whole, without the song loop region, and a change to the project does not swap the song in (Claudes val)', async () => {
    const folder = memoryFolder('Amen');
    const s = services([folder]);
    let playing = false;
    const player = { ...s.player, play: vi.fn(() => void (playing = true)), isPlaying: () => playing } satisfies Player;
    const store = createStore({ ...initialState(build(createLoop('basic', 'main', 1))), view: 'project' });
    render(<App store={store} services={{ ...s, player }} />);
    await act(async () => {});
    await click('New');
    await answer('Keep the current work');

    await click('Play Start');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(vi.mocked(player.setLoop).mock.lastCall).toEqual([null]);

    // A change that is heard in the song: the song renders anew, but the snapshot plays on.
    await act(async () => {
      store.dispatch({ type: 'run', command: setBpm(150) });
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.replace).not.toHaveBeenCalled();
  });

  it('follows Loop in the header: off, it plays once; switched on while it plays, it starts again looped (Magnus beslut)', async () => {
    const folder = memoryFolder('Amen');
    const s = services([folder]);
    let playing = false;
    const player = { ...s.player, play: vi.fn(() => void (playing = true)), isPlaying: () => playing } satisfies Player;
    const store = createStore({ ...initialState(build(createLoop('basic', 'main', 1))), view: 'project', loop: false });
    render(<App store={store} services={{ ...s, player }} />);
    await act(async () => {});
    await click('New');
    await answer('Keep the current work');

    await click('Play Start');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(vi.mocked(player.play).mock.lastCall?.slice(1)).toEqual([0, true]);

    await act(async () => {
      store.dispatch({ type: 'loop', on: true });
    });
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(vi.mocked(player.play).mock.lastCall?.slice(1)).toEqual([0, false]);
  });
});
