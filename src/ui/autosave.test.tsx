// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../model';
import { App, SAVE_DEBOUNCE_MS } from './App';
import type { Take } from './playback';
import type { ProjectStorage } from './persist';
import type { Services } from './services';
import { createStore, initialState } from './store';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const services = (storage: ProjectStorage): Services => ({
  storage,
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
  download: vi.fn(),
  rng: () => () => 0,
});

describe('autosave', () => {
  it('never saves over the saved project when it could not be loaded', async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const storage: ProjectStorage = { load: () => Promise.reject(new Error('broken')), save };
    render(<App store={createStore(initialState(createProject()))} services={services(storage)} />);
    // Let the load settle and render, then let the autosave's debounce run out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/Could not load the saved project/)).toBeTruthy();
  });

  it('saves after a load that worked', async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    render(<App store={createStore(initialState(createProject()))} services={services({ load: () => Promise.resolve(null), save })} />);
    // Let the load settle and render, then let the autosave's debounce run out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    });
    expect(save).toHaveBeenCalled();
  });
});
