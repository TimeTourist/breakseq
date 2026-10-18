// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, addTrim, createProject, setBpm, setHitSource, setSlicing } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { AppState, Store } from './store';
import { createStore, initialState } from './store';
import { SONG_KEY, subjectOf } from './subject';

afterEach(cleanup);

/** One bar of 2 s at 120 BPM in four slices, with M1 in the song. */
function split(...more: Command[]): Project {
  const ctx = sequentialIds();
  const run = (p: Project, c: Command) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  };
  let p = [addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(120)].reduce(run, createProject());
  const id = Object.keys(p.samples)[0]!;
  p = run(p, setSlicing(id, 1, [0, 0.25, 0.5, 0.75]));
  p = run(p, addClip('main', Object.keys(p.loops)[0]!, 0, 16));
  return more.reduce(run, p);
}

const matrixOf = (p: Project) => Object.values(p.matrices)[0]!;
const sampleOf = (p: Project) => Object.values(p.samples)[0]!;
const memberOf = (p: Project, row: number) => p.pads[matrixOf(p).pads[row]!]!.members[0]!;
const state = (p: Project, patch: Partial<AppState>): AppState => ({ ...initialState(p), ...patch });

describe('what Play plays', () => {
  const p = split();
  const matrix = matrixOf(p);
  const sample = sampleOf(p);

  it('is the trimmed sample in Import, looped for a break; the song with no Trim open', () => {
    expect(subjectOf(p, state(p, { view: 'import' }))?.key).toBe(SONG_KEY);
    expect(subjectOf(p, state(p, { view: 'import', sliceTarget: sample.id }))?.key).toBe(SONG_KEY);
    const s = subjectOf(p, state(p, { view: 'import', trimming: sample.id }));
    expect(s).toMatchObject({ key: `sample:${sample.id}`, once: false, kind: 'preview' });
  });

  it('is the sample’s own matrix as laid out in Slice', () => {
    expect(subjectOf(p, state(p, { view: 'slice' }))).toMatchObject({ key: `matrix:${matrix.id}`, kind: 'song' });
  });

  it('is in Hits the open matrix, the picked hit, or the pad as it picks; looped unless Once', () => {
    const sel = initialState(p).selection;
    expect(initialState(p).hitsLoop).toBe(true);
    expect(subjectOf(p, state(p, { view: 'hits', hitsLoop: false, selection: { ...sel, matrix: matrix.id } }))?.key).toBe(`matrix:${matrix.id}:true`);
    expect(subjectOf(p, state(p, { view: 'hits', hitsLoop: false, selection: { ...sel, pad: matrix.pads[1]!, hit: memberOf(p, 1) } }))?.key).toBe(`hit:${memberOf(p, 1)}:true`);
    const pad = subjectOf(p, state(p, { view: 'hits', selection: { ...sel, matrix: matrix.id, pad: matrix.pads[1]! } }));
    expect(pad).toMatchObject({ key: `pad:${matrix.pads[1]}:false`, once: false });
  });

  it('is the song in Song and Project', () => {
    expect(subjectOf(p, state(p, { view: 'song' }))?.key).toBe(SONG_KEY);
    expect(subjectOf(p, state(p, { view: 'project' }))?.key).toBe(SONG_KEY);
  });
});

function services() {
  const take = (seconds: number): Take => ({ buffer: { duration: seconds } as AudioBuffer, triggers: [], tapes: [] });
  let playing = false;
  let position: number | null = null;
  const player = {
    play: vi.fn(() => void (playing = true)),
    replace: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(() => void (playing = false)),
    isPlaying: () => playing,
    currentTrigger: () => null,
    currentPosition: () => (playing ? position : null),
    audition: vi.fn(),
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  } satisfies Player;
  const s: Services = {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: vi.fn(() => Promise.resolve(take(2))),
    renderPreview: vi.fn(() => Promise.resolve(take(0.5))),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
  return { services: s, player, end: () => void (playing = false), at: (seconds: number) => void (position = seconds) };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });

async function setup(project: Project, patch: Partial<AppState>) {
  const fake = services();
  const store: Store = createStore({ ...initialState(project), ...patch });
  render(<App store={store} services={fake.services} />);
  await settle();
  return { store, ...fake };
}

describe('Play in each view', () => {
  it('starts what a new view shows straight away, and swaps in edits of the same seamlessly', async () => {
    const p = split();
    const { store, player } = await setup(p, { view: 'song' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenCalledTimes(1);

    act(() => void store.dispatch({ type: 'view', view: 'slice' }));
    await settle();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.replace).not.toHaveBeenCalled();

    act(() => void store.dispatch({ type: 'run', command: setBpm(130) }));
    await settle();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.replace).toHaveBeenCalledTimes(1);
  });

  it('plays a hit once in Hits with Once, and loops it with Loop', async () => {
    const p = split();
    const { player, end } = await setup(p, { view: 'hits', hitsLoop: false, selection: { ...initialState(p).selection, pad: matrixOf(p).pads[1]!, hit: memberOf(p, 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, true);
    // One button: Play is Stop while it plays.
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveProperty('disabled', false);
    // Played out, it stops by itself.
    await act(async () => {
      end();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
  });
});

describe('the Hits list', () => {
  it('folds away a break\'s pads', async () => {
    const p = split();
    await setup(p, { view: 'hits', unfolded: [matrixOf(p).id] });
    const list = screen.getByLabelText('Matrices and pads');
    expect(within(list).getAllByRole('button', { name: /^Pad / }).length).toBeGreaterThan(0);
    fireEvent.click(within(list).getByRole('button', { name: /^Hide the pads of/ }));
    expect(within(list).queryAllByRole('button', { name: /^Pad amen/ })).toHaveLength(0);
    fireEvent.click(within(list).getByRole('button', { name: /^Show the pads of/ }));
    expect(within(list).getAllByRole('button', { name: /^Pad amen/ }).length).toBeGreaterThan(0);
  });

  it('starts folded, and collapses and expands every break at once', async () => {
    await setup(split(), { view: 'hits' });
    expect(within(screen.getByLabelText('Matrices and pads')).queryAllByRole('button', { name: /^Pad amen/ })).toHaveLength(0);
    fireEvent.click(within(screen.getByLabelText('Matrices and pads')).getByRole('button', { name: 'Expand all' }));
    const list = screen.getByLabelText('Matrices and pads');
    fireEvent.click(within(list).getByRole('button', { name: 'Collapse all' }));
    expect(within(list).queryAllByRole('button', { name: /^Pad amen/ })).toHaveLength(0);
    fireEvent.click(within(list).getByRole('button', { name: 'Expand all' }));
    expect(within(list).getAllByRole('button', { name: /^Pad amen/ }).length).toBeGreaterThan(0);
  });

  it('shows a replaced slice as 04→02', async () => {
    const p0 = split();
    const p = split(setHitSource(memberOf(p0, 3), sampleOf(p0).id, 1));
    await setup(p, { view: 'hits', unfolded: [matrixOf(p).id] });
    const chip = screen.getByTitle(/plays 02 instead/);
    expect(chip.textContent).toBe('04→02');
    expect(chip.className).toContain('replaced');
  });
});

describe('Clone matrix in Hits', () => {
  it('copies the open matrix and opens the copy', async () => {
    const p = split();
    const matrix = matrixOf(p);
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, matrix: matrix.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Clone matrix' }));
    const copy = Object.values(store.getState().history.present.matrices).find((m) => m.id !== matrix.id)!;
    expect(copy.name).toBe('amen 1 copy');
    expect(store.getState().selection).toMatchObject({ matrix: copy.id, pad: null, hit: null });
    expect(screen.getByRole('button', { name: /^Undo: add matrix amen 1 copy/ })).toBeTruthy();
  });
});

/** The open Delete dialog, its text, and Cancel or Delete in it. */
const deleteDialog = () => screen.getByRole('alertdialog');
const answer = (yes: boolean) => fireEvent.click(within(deleteDialog()).getByRole('button', { name: yes ? 'Delete' : 'Cancel' }));

describe('Delete matrix', () => {
  it('in Hits marks a matrix heard in the song, and asks before deleting it anyway; its loop stays', async () => {
    const p = split();
    const matrix = matrixOf(p);
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, matrix: matrix.id } });
    fireEvent.click(screen.getByRole('button', { name: '♪ Song' }));
    expect(store.getState().view).toBe('song');
    act(() => void store.dispatch({ type: 'view', view: 'hits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete matrix amen 1' }));
    expect(within(deleteDialog()).getByText('Song')).toBeTruthy();
    expect(within(deleteDialog()).getByText('4 pads')).toBeTruthy();
    answer(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(store.getState().history.present.matrices[matrix.id]).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete matrix amen 1' }));
    answer(true);
    expect(store.getState().history.present.matrices[matrix.id]).toBeUndefined();
    expect(store.getState().history.present.loops[matrix.loop!]).toBeDefined();
  });
});

describe('Delete in Import', () => {
  /** split with a second trim of the file, which nothing else uses. */
  const twoTrims = () => split(addTrim(sampleOf(split()).id));

  it('in Import asks even for a trim nothing else uses, listing what goes with it', async () => {
    const { store } = await setup(twoTrims(), { view: 'import' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete trim amen trim 2' }));
    const dialog = deleteDialog();
    expect(dialog.getAttribute('aria-label')).toBe('Delete amen trim 2?');
    expect(within(dialog).getByText('matrix amen 2')).toBeTruthy();
    expect(within(dialog).queryByText('Goes silent in')).toBeNull();
    answer(true);
    expect(Object.values(store.getState().history.present.matrices).map((m) => m.name)).toEqual(['amen 1']);
    expect(Object.values(store.getState().history.present.samples).map((s) => s.trim)).toEqual([1]);
  });

  it('a trim heard in the song lists where it goes silent', async () => {
    await setup(split(), { view: 'import' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete trim amen trim 1' }));
    expect(within(deleteDialog()).getByText('Song')).toBeTruthy();
    expect(within(deleteDialog()).getByText('4 pads')).toBeTruthy();
  });

  it('Escape closes the dialog without deleting', async () => {
    const { store } = await setup(split(), { view: 'import' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete trim amen trim 1' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(Object.keys(store.getState().history.present.samples)).toHaveLength(1);
  });

  it('Delete file in Import takes every trim of the file, after asking', async () => {
    const { store } = await setup(twoTrims(), { view: 'import' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete file amen.wav' }));
    answer(false);
    expect(Object.keys(store.getState().history.present.samples)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file amen.wav' }));
    expect(within(deleteDialog()).getByText('amen trim 1 (matrix amen 1, 4 pads, 4 hits)')).toBeTruthy();
    expect(within(deleteDialog()).getByText('amen trim 2 (matrix amen 2, 1 pad, 1 hit)')).toBeTruthy();
    answer(true);
    expect(store.getState().history.present.matrices).toEqual({});
    expect(store.getState().history.present.samples).toEqual({});
    expect(store.getState().history.present.audio).toEqual({});
  });
});

describe('the same controls everywhere, in Hits', () => {
  it('▶ next to the picked hit plays what Space plays, and its playhead runs through the region', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const { store, player, at } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, pad: matrixOf(p).pads[1]!, hit } });
    act(() => void store.dispatch({ type: 'run', command: (q) => ({ ok: true, project: { ...q, hits: { ...q.hits, [hit]: { ...q.hits[hit]!, region: { start: 0.2, end: 0.6 } } } } }) }));
    await settle();
    const hitPanel = screen.getByRole('region', { name: 'Hit' });
    expect(within(hitPanel).getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed')).not.toBeNull();
    // Halfway through the 0.5 s take is halfway through the region.
    at(0.25);
    fireEvent.click(within(hitPanel).getByRole('button', { name: 'Play hit' }));
    expect(player.play).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect((hitPanel.querySelector('.playhead') as HTMLElement | null)?.style.left).toBe('40%');
    fireEvent.click(within(hitPanel).getByRole('button', { name: 'Stop hit' }));
    expect(player.stop).toHaveBeenCalled();
  });

  it('the region is set with handles, as in Trim: ←/→ moves an end by 1 ms, Shift by 10 ms', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, pad: matrixOf(p).pads[1]!, hit } });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Start at 0 ms' }), { key: 'ArrowRight', shiftKey: true });
    // The slice is 0.5 s long: 10 ms is a 50th of it.
    expect(store.getState().history.present.hits[hit]!.region.start).toBeCloseTo(0.02);
    expect(screen.getByLabelText('Start ms')).toHaveProperty('value', '10');
  });

  it('Delete hit asks first, and takes it out of its pad', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const pad = matrixOf(p).pads[1]!;
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, pad, hit } });
    fireEvent.click(screen.getByRole('button', { name: `Delete hit ${p.hits[hit]!.name}` }));
    expect(deleteDialog().getAttribute('aria-label')).toBe(`Delete ${p.hits[hit]!.name}?`);
    answer(false);
    expect(store.getState().history.present.hits[hit]).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: `Delete hit ${p.hits[hit]!.name}` }));
    answer(true);
    expect(store.getState().history.present.hits[hit]).toBeUndefined();
    expect(store.getState().history.present.pads[pad]!.members).toEqual([]);
  });
});
