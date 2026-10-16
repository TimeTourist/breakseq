// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { createLoop, createProject, renameLoop } from '../model';
import { saveSnapshot, writeManifest } from '../engine';
import { memoryFolder, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { FolderService } from './folders';
import type { Player, Take } from './playback';
import type { Services } from './services';
import { createStore, initialState } from './store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ctx = sequentialIds();
function build(...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
}

/** A take that remembers the loop name of the project it was rendered from. */
type NamedTake = Take & { readonly loop: string | undefined };

function makeServices(folder: ReturnType<typeof memoryFolder> | null) {
  const folders: FolderService = { supported: true, pick: async () => folder, remembered: async () => null };
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
  const renderSong = vi.fn(
    (project: Project): Promise<Take> =>
      Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [], loop: Object.values(project.loops)[0]?.name } as NamedTake),
  );
  const exportWav = vi.fn();
  const exportMidi = vi.fn<(project: Project, take: Take) => Promise<number>>(() => Promise.resolve(23));
  const services: Services = { storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() }, player, renderSong, renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }), exportWav, exportMidi, download: vi.fn(), rng: () => () => 0, folders };
  return { services, player, exportWav, exportMidi };
}

async function setup(project: Project, folder: ReturnType<typeof memoryFolder> | null) {
  const { services, player, exportWav, exportMidi } = makeServices(folder);
  const store = createStore({ ...initialState(project), view: 'project' });
  render(<App store={store} services={services} />);
  // Let the first render of the song finish (it waits a short debounce).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  return { store, player, exportWav, exportMidi };
}

const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};
const loopOf = (take: unknown) => (take as NamedTake).loop;

describe('export in Project', () => {
  it('the header has Save and New snapshot instead of Export, off without a project folder', async () => {
    await setup(build(createLoop('M1', 'main', 1)), null);
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('button', { name: 'Export WAV' })).toBeNull();
    expect(within(header).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    expect(within(header).getByRole('button', { name: 'New snapshot' }).hasAttribute('disabled')).toBe(true);
  });

  it('New snapshot asks for a name below the header, and Escape closes it without saving', async () => {
    const folder = memoryFolder('Amen');
    const info = await saveSnapshot(folder, build(createLoop('Old groove', 'main', 1)), 'Old', new Date('2026-10-15T10:00:00Z'));
    await writeManifest(folder, info.file);
    await setup(build(createLoop('M1', 'main', 1)), folder);
    await click('Open');
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard the work' }));
    });
    await click('New snapshot');
    const name = screen.getByRole('textbox', { name: 'New snapshot name' });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'New snapshot name' })).toBeNull();
    expect((await folder.list('snapshots')).length).toBe(1);
  });

  it('Export MIDI + slices exports the song as it is and says how many sounds; a song that does not fit says why', async () => {
    const { exportMidi } = await setup(build(createLoop('M1', 'main', 1)), null);
    await click('Export MIDI + slices');
    expect(exportMidi).toHaveBeenCalledTimes(1);
    expect(loopOf(exportMidi.mock.calls[0]![1])).toBe('M1');
    expect(screen.getByRole('status').textContent).toBe('Saved a MIDI file and a WAV with 23 sounds.');

    exportMidi.mockRejectedValueOnce(new Error('The song has 93 different sounds'));
    await click('Export MIDI + slices');
    expect(screen.getByRole('alert').textContent).toContain('93 different sounds');
  });

  it('Export WAV in Project exports the song as it is now', async () => {
    const { exportWav } = await setup(build(createLoop('M1', 'main', 1)), null);
    await click('Export WAV');
    expect(exportWav).toHaveBeenCalledTimes(1);
    expect(loopOf(exportWav.mock.calls[0]![0])).toBe('M1');
  });

  it('a snapshot plays and exports from its file, and the work that is open stays as it is', async () => {
    // While playing, the playhead is polled every frame; here frames never come.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const folder = memoryFolder('Amen');
    const old = build(createLoop('Old groove', 'main', 1));
    const info = await saveSnapshot(folder, old, 'Old', new Date('2026-10-15T10:00:00Z'));
    await writeManifest(folder, info.file);
    const { store, player, exportWav } = await setup(build(createLoop('Current', 'main', 1)), folder);
    // Open the folder; the work open now is in no snapshot, so it asks first.
    await click('Open');
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard the work' }));
    });
    // Open loaded "Old"; change the work so it differs from every snapshot.
    await act(async () => {
      store.dispatch({ type: 'run', command: renameLoop(Object.keys(store.getState().history.present.loops)[0]!, 'Work') });
    });

    await click('Play Old');
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(loopOf(player.play.mock.calls[0]![0])).toBe('Old groove');
    // It plays until Stop, as the song does.
    expect(screen.getByRole('button', { name: 'Stop' }).hasAttribute('disabled')).toBe(false);
    await click('Stop');

    await click('Export Old');
    expect(loopOf(exportWav.mock.calls[0]![0])).toBe('Old groove');
    expect(exportWav.mock.calls[0]![1]).toBe('Old');

    expect(Object.values(store.getState().history.present.loops)[0]!.name).toBe('Work');
  });
});
