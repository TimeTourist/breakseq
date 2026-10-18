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
  it('the bars ask once, when committed: typing "16" does not ask at "1"', async () => {
    const store = await setup(amenAndSnares());
    const bars = screen.getByLabelText('Bars in the sample');
    fireEvent.change(bars, { target: { value: '1' } });
    fireEvent.change(bars, { target: { value: '16' } });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(samples(store)[0]).toMatchObject({ bars: 1 });
    fireEvent.blur(bars);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Renumber' }));
    expect(samples(store)[0]).toMatchObject({ bars: 16 });
    expect(samples(store)[0]!.markers).toHaveLength(64);
  });

  it('cancelling leaves the view as it was: the grid and the selected slice', async () => {
    await setup(amenAndSnares());
    fireEvent.click(screen.getByRole('button', { name: 'Play slice 03' }));
    fireEvent.click(screen.getByRole('button', { name: '1/8' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '1/4' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Slice 03' })).toBeTruthy();
  });

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

  it('a trim with no matrix of its own offers only Renumber', async () => {
    // Two copies of slice 02 in Snares: they stay on the old trim when amen's matrix moves to a new one.
    const base = amenAndSnares();
    const snares = Object.values(base.matrices).find((m) => m.name === 'Snares')!;
    const original = Object.values(base.hits).find((h) => h.slice === 1 && ownMatrix(base, h.sampleId) !== undefined)!;
    const more = copyHits([original.id], snares.pads[0]!)(base, sequentialIds());
    if (!more.ok) throw new Error('copy failed');
    const store = await setup(more.project);
    const first = samples(store)[0]!;
    fireEvent.click(screen.getByRole('button', { name: 'Play slice 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'New trim' }));
    // The old trim stays in Slice, with no matrix; go back to it.
    act(() => void store.dispatch({ type: 'sliceTarget', sampleId: first.id }));
    expect(ownMatrix(present(store), first.id)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Play slice 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).queryByRole('button', { name: 'New trim' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Renumber' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(samples(store)).toHaveLength(2);
  });

  it('asks before a grid or the bars renumber too, and not when a marker only moves', async () => {
    const store = await setup(amenAndSnares());
    fireEvent.click(screen.getByRole('button', { name: '1/8' }));
    expect(screen.getByRole('alertdialog', { name: /^You use slice 02/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    const bars = screen.getByLabelText('Bars in the sample');
    fireEvent.change(bars, { target: { value: '2' } });
    fireEvent.keyDown(bars, { key: 'Enter' });
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
