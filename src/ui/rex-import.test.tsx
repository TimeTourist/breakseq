// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, matrixSequence, ownMatrix } from '../model';
import { App } from './App';
import type { Player } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

function services(): Services {
  const player: Player = {
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
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

async function setup(): Promise<Store> {
  const store = createStore({ ...initialState(createProject()), view: 'samples' });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const fixture = (name: string): File =>
  new File([new Uint8Array(readFileSync(join(import.meta.dirname, '../engine/fixtures/rex', name)))], name);
const browse = (file: File) => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
/** A file dropped anywhere on the page: here on a pad of the file list. */
const drop = (file: File) => fireEvent.drop(screen.getByRole('region', { name: 'Files' }), { dataTransfer: { files: [file], types: ['Files'] } });
const project = (store: Store) => store.getState().history.present;

describe('importing a REX2 file', () => {
  it('Browse: a sample already sliced at its slices, its matrix a pad per slice, and its loop, in one undo step', async () => {
    const store = await setup();
    browse(fixture('120Stereo.rx2'));
    await waitFor(() => expect(Object.keys(project(store).samples)).toHaveLength(1));
    const sample = Object.values(project(store).samples)[0]!;
    expect(sample).toMatchObject({ name: '120Stereo.rx2', bars: 1 });
    expect(sample.markers).toHaveLength(10);
    expect(sample.duration).toBeCloseTo(2, 9);
    const own = ownMatrix(project(store), sample.id)!;
    expect(own.pads).toHaveLength(10);
    expect(own.loop).not.toBeNull();
    expect(matrixSequence(project(store), own.id)).toHaveLength(10);
    // Its row shows it sliced: one bar at 120 BPM, and what it made.
    expect(within(screen.getByRole('region', { name: 'Files' })).getByText('10 slices')).toBeTruthy();
    expect(screen.getByText('= 120.00 BPM')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Where you are' }).textContent).toContain('1 loop →');
    expect(screen.queryByRole('alert')).toBeNull();
    // One step back takes all of it.
    act(() => store.dispatch({ type: 'undo' }));
    expect(project(store).samples).toEqual({});
    expect(project(store).loops).toEqual({});
  });

  it('drag: a mono file plays in both channels', async () => {
    const store = await setup();
    drop(fixture('120Mono.rx2'));
    await waitFor(() => expect(Object.keys(project(store).samples)).toHaveLength(1));
    const audio = Object.values(project(store).audio)[0]!;
    expect(audio.channels).toHaveLength(2);
    expect(audio.channels[0]).toEqual(audio.channels[1]);
  });

  it('a REX2 file renamed to something else is still read as one, by its header', async () => {
    const store = await setup();
    const bytes = await fixture('120Stereo.rx2').arrayBuffer();
    browse(new File([bytes], 'loop.wav'));
    await waitFor(() => expect(Object.keys(project(store).samples)).toHaveLength(1));
    expect(Object.values(project(store).samples)[0]).toMatchObject({ name: 'loop.wav', bars: 1 });
    expect(Object.values(project(store).samples)[0]!.markers).toHaveLength(10);
  });

  it('a damaged or unknown .rx2 shows an error and adds nothing', async () => {
    const store = await setup();
    browse(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], 'nope.rx2'));
    expect((await screen.findByRole('alert')).textContent).toBe('nope.rx2: Not a REX2 file');
    browse(fixture('ErrorCorrupt.rx2'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/^ErrorCorrupt\.rx2: .*REX2 file/));
    expect(project(store).samples).toEqual({});
  });
});
