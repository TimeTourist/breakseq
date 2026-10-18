// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, copyHits, createMatrix, createProject, ownMatrix, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Take } from './playback';
import { renumberQuestion } from './RenumberDialog';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const services = (): Services => ({
  storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
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

/** A 2 s sample sliced over one bar in four, and a matrix Snares whose pad has a copy of slice 02. */
function amenAndSnares(): Project {
  const ctx = sequentialIds();
  const run = (p: Project, c: Command) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  };
  let p = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  const sampleId = Object.keys(p.samples)[0]!;
  p = run(p, sliceSample(sampleId, 1, 4));
  p = run(p, createMatrix('Snares'));
  const amen = ownMatrix(p, sampleId)!;
  const snares = Object.values(p.matrices).find((m) => m.name === 'Snares')!;
  return run(p, copyHits([p.pads[amen.pads[1]!]!.members[0]!], snares.pads[0]!));
}

async function setup(project: Project): Promise<Store> {
  const store = createStore({ ...initialState(project), view: 'slice' });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const samples = (store: Store) => Object.values(present(store).samples);
const QUESTION = 'You use slice 02 in: pad amen 1 02 and pad Snares 01. Make a new trim and sample for this?';

describe('the renumber dialog', () => {
  it('asks in words which slices and pads, listing them as one says them', () => {
    const p = amenAndSnares();
    const pads = Object.values(p.pads).slice(0, 3).map((pad) => pad.id);
    expect(renumberQuestion(p, { slices: [6, 8], pads })).toBe('You use slice 07, 09 in: pad amen 1 01, pad amen 1 02 and pad amen 1 03. Make a new trim and sample for this?');
  });

  it('the renumber dialog offers New trim and Renumber', async () => {
    const store = await setup(amenAndSnares());
    const first = samples(store)[0]!;
    // A marker in slice 01 renumbers 02–04, and 02 is played by amen's row and the copy in Snares.
    fireEvent.click(screen.getByRole('button', { name: 'Play slice 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    const dialog = screen.getByRole('alertdialog', { name: QUESTION });
    expect(within(dialog).getByRole('button', { name: 'New trim' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Renumber' })).toBeTruthy();

    // Escape cancels: nothing changes.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(present(store).samples[first.id]!.markers).toHaveLength(4);

    // Renumber changes the sample itself.
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Renumber' }));
    expect(samples(store)).toHaveLength(1);
    expect(present(store).samples[first.id]!.markers).toHaveLength(5);

    // New trim leaves the sample as it was and moves amen's matrix to a new trim, which Slice shows.
    act(() => void store.dispatch({ type: 'undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play slice 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'New trim' }));
    expect(samples(store)).toHaveLength(2);
    expect(present(store).samples[first.id]!.markers).toHaveLength(4);
    const fresh = samples(store).find((s) => s.id !== first.id)!;
    expect(fresh).toMatchObject({ trim: 2 });
    expect(fresh.markers).toHaveLength(5);
    expect(Object.values(present(store).matrices).find((m) => m.name === 'amen 1')!.sampleId).toBe(fresh.id);
    expect(store.getState().sliceTarget).toBe(fresh.id);
  });

  it('asks before a grid or the bars renumber too, and not when a marker only moves', async () => {
    const store = await setup(amenAndSnares());
    fireEvent.click(screen.getByRole('button', { name: '1/8' }));
    expect(screen.getByRole('alertdialog', { name: /^You use slice 02/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.change(screen.getByLabelText('Bars in the sample'), { target: { value: '2' } });
    expect(screen.getByRole('alertdialog', { name: /^You use slice 02/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(samples(store)[0]).toMatchObject({ bars: 1 });

    const marker = screen.getByRole('button', { name: /^Marker 02 at/ });
    fireEvent.focus(marker);
    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(samples(store)[0]!.markers[1]! * 2).toBeCloseTo(0.501, 6);
  });
});
