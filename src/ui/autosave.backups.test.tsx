// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../model';
import { addSample, createProject } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App, SAVE_DEBOUNCE_MS } from './App';
import type { BackupInfo, BackupStorage } from './backups';
import { BACKUP_EVERY_MS } from './backups';
import type { Take } from './playback';
import type { ProjectStorage } from './persist';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Backups in memory; `kept` is every project added, in order. */
function memoryBackups(): BackupStorage & { readonly kept: Project[] } {
  const items: (BackupInfo & { project: Project })[] = [];
  const kept: Project[] = [];
  return {
    kept,
    list: () => Promise.resolve([...items].sort((a, b) => b.at - a.at).map(({ id, at, summary }) => ({ id, at, summary }))),
    add: (project, summary, at) => {
      kept.push(project);
      items.push({ id: `b-${items.length + 1}`, at, summary, project });
      return Promise.resolve();
    },
    restore: (id) => Promise.resolve(items.find((b) => b.id === id)!.project),
  };
}

const services = (storage: ProjectStorage, backups: BackupStorage): Services => ({
  storage,
  backups,
  player: {
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
  },
  renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
  renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
  exportWav: vi.fn(),
  exportMidi: vi.fn(),
  exportRex: vi.fn(),
  download: vi.fn(),
  rng: () => () => 0,
});

const amen = () => {
  const result = addSample({ name: 'Amen', audio: constantAudio(0.01) })(createProject(), sequentialIds());
  if (!result.ok) throw new Error('addSample failed');
  return result.project;
};

const settle = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** A change to the project, as any command makes. */
const change = (store: Store, bpm: number) => act(() => void store.dispatch({ type: 'run', command: (p) => ({ ok: true, project: { ...p, song: { ...p.song, bpm } } }) }));

describe('an autosave from before Matrix', () => {
  it('says it was kept as a backup, dismissably, and lists that backup at once', async () => {
    vi.useFakeTimers();
    const backups = memoryBackups();
    let aside = false;
    const storage: ProjectStorage = {
      // As indexedDbStorage does: the old autosave becomes a backup during the load.
      load: async () => {
        await backups.add(amen(), { snapshot: null, samples: 1, loops: 0, clips: 0 }, Date.now());
        aside = true;
        return null;
      },
      save: () => Promise.resolve(),
      setAside: () => aside,
    };
    const store = createStore(initialState());
    render(<App store={store} services={services(storage, backups)} />);
    await settle();
    expect(screen.getByRole('status').textContent).toContain('Your project from before Matrix was kept as a backup in Project.');
    act(() => void store.dispatch({ type: 'view', view: 'project' }));
    expect(screen.getAllByRole('group', { name: /^Backup / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nothing when no autosave was set aside', async () => {
    vi.useFakeTimers();
    render(<App store={createStore(initialState())} services={services({ load: () => Promise.resolve(null), save: () => Promise.resolve() }, memoryBackups())} />);
    await settle();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('autosave backups', () => {
  it('keeps the project as loaded, before anything changes it', async () => {
    vi.useFakeTimers();
    const saved = amen();
    const backups = memoryBackups();
    render(<App store={createStore(initialState())} services={services({ load: () => Promise.resolve(saved), save: () => Promise.resolve() }, backups)} />);
    await settle();
    expect(backups.kept).toEqual([saved]);
  });

  it('keeps one more at most every BACKUP_EVERY_MS while the project changes', async () => {
    vi.useFakeTimers();
    const backups = memoryBackups();
    const store = createStore(initialState());
    render(<App store={store} services={services({ load: () => Promise.resolve(amen()), save: () => Promise.resolve() }, backups)} />);
    await settle();
    change(store, 150);
    await settle(SAVE_DEBOUNCE_MS * 2);
    expect(backups.kept).toHaveLength(1);

    await settle(BACKUP_EVERY_MS);
    change(store, 160);
    await settle(SAVE_DEBOUNCE_MS * 2);
    expect(backups.kept.map((p) => p.song.bpm)).toEqual([amen().song.bpm, 160]);
  });

  it('restores a backup with a new undo history, after keeping the work as one', async () => {
    vi.useFakeTimers();
    const saved = amen();
    const backups = memoryBackups();
    const store = createStore(initialState());
    render(<App store={store} services={services({ load: () => Promise.resolve(saved), save: () => Promise.resolve() }, backups)} />);
    await settle();
    change(store, 150);
    act(() => void store.dispatch({ type: 'view', view: 'project' }));

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await settle();

    expect(store.getState().history.present).toEqual(saved);
    expect(store.getState().history.past).toHaveLength(0);
    // The work with 150 BPM is a backup now, so the restore can be undone.
    expect(backups.kept.at(-1)!.song.bpm).toBe(150);
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(2);
  });

  it('lists the backups when the load failed, and a restore turns autosave on', async () => {
    vi.useFakeTimers();
    const backups = memoryBackups();
    const old = amen();
    await backups.add(old, { snapshot: 'Hek-tick', samples: 1, loops: 2, clips: 3 }, Date.now());
    const save = vi.fn(() => Promise.resolve());
    const store = createStore(initialState());
    render(<App store={store} services={services({ load: () => Promise.reject(new Error('broken')), save }, backups)} />);
    await settle();
    act(() => void store.dispatch({ type: 'view', view: 'project' }));

    const row = screen.getByRole('group', { name: /^Backup / });
    expect(row.textContent).toContain('Hek-tick');
    expect(row.textContent).toContain('1 sample · 2 loops · 3 clips');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await settle(SAVE_DEBOUNCE_MS * 2);

    expect(store.getState().history.present).toEqual(old);
    // The empty project that stood in for the one that failed is not kept.
    expect(backups.kept).toEqual([old]);
    expect(save).toHaveBeenCalledWith(old);
  });
});
