// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, addTrim, createProject, setBpm, setHitSource, setSlicing, updateSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { focusOn } from '../test/focus';
import type { Trigger } from '../engine';
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

  it('is in Samples the selected sample, trimmed, sliced or not; the song when there is none (Magnus beslut)', () => {
    expect(subjectOf(p, state(p, { view: 'samples' }))).toMatchObject({ key: `sample:${sample.id}`, once: false, kind: 'preview' });
    expect(subjectOf(p, state(p, { view: 'samples', sliceTarget: sample.id }))).toMatchObject({ key: `sample:${sample.id}`, kind: 'preview' });
    expect(subjectOf(createProject(), state(createProject(), { view: 'samples' }))?.key).toBe(SONG_KEY);
  });

  it('is in Pads always the matrix in focus in a loop, whatever is selected', () => {
    const sel = initialState(p).selection;
    const focus = { matrix: matrix.id, loopPins: [] };
    const looped = { key: `matrix:${matrix.id}`, once: false, kind: 'song' };
    expect(subjectOf(p, state(p, { view: 'pads', focus, selection: sel }))).toMatchObject(looped);
    expect(subjectOf(p, state(p, { view: 'pads', focus, selection: { ...sel, pad: matrix.pads[1]!, hit: memberOf(p, 1) } }))).toMatchObject(looped);
    expect(subjectOf(p, state(p, { view: 'pads', focus, selection: { ...sel, pad: matrix.pads[1]! } }))).toMatchObject(looped);
    // Nothing in focus: nothing to play.
    expect(subjectOf(p, state(p, { view: 'pads', selection: { ...sel, pad: matrix.pads[1]! } }))).toBeNull();
  });

  it('is in Mods nothing while there is no mod: Play stops (U18)', () => {
    expect(Object.keys(p.mods)).toHaveLength(0);
    expect(subjectOf(p, state(p, { view: 'mods' }))).toBeNull();
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
  let trigger: Trigger | null = null;
  const player = {
    play: vi.fn(() => void (playing = true)),
    replace: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(() => void (playing = false)),
    isPlaying: () => playing,
    currentTrigger: () => (playing ? trigger : null),
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
  return { services: s, player, end: () => void (playing = false), at: (seconds: number) => void (position = seconds), atTrigger: (t: Trigger) => void (trigger = t) };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });

/** The app as `patch` has it; Pads with the selection's matrix in focus, else the first. */
async function setup(project: Project, patch: Partial<AppState>) {
  const fake = services();
  const selected = focusOn(project, patch.selection ?? {});
  const focus = selected.matrix === null ? { matrix: Object.keys(project.matrices)[0] ?? null, loopPins: [] } : selected;
  const store: Store = createStore({ ...initialState(project), focus, ...patch });
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

    act(() => void store.dispatch({ type: 'view', view: 'loops' }));
    await settle();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.replace).not.toHaveBeenCalled();

    act(() => void store.dispatch({ type: 'run', command: setBpm(130) }));
    await settle();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.replace).toHaveBeenCalledTimes(1);
  });

  it('renders nothing anew for a change that is not heard in what plays (Claudes val)', async () => {
    const p = split();
    const { store, player, services } = await setup(p, { view: 'samples' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const renders = () => vi.mocked(services.renderPreview).mock.calls.length + vi.mocked(services.renderSong).mock.calls.length;
    const before = renders();
    // The sample plays as it is: the tempo and its name are not heard in it.
    act(() => void store.dispatch({ type: 'run', command: setBpm(130) }));
    act(() => void store.dispatch({ type: 'run', command: updateSample(sampleOf(p).id, { name: 'other' }) }));
    await settle();
    expect(renders()).toBe(before);
    expect(player.replace).not.toHaveBeenCalled();
  });

  it('a loop played over several passes lights the same step in Loops each pass', async () => {
    const p = split();
    const { atTrigger } = await setup(p, { view: 'loops' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    // Step 05 of the one-bar loop, in the second pass.
    atTrigger({ time: 2.5, bar: 1, step: 4 } as Trigger);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const lit = Array.from(document.querySelectorAll('.step.now'));
    expect(lit).toHaveLength(1);
    expect(lit[0]!.getAttribute('style')).toContain('grid-column: 6');
  });

  it('in Samples, Play plays the sample, its playhead in both the file and the sample (Magnus beslut)', async () => {
    const p = split();
    const { at } = await setup(p, { view: 'samples' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    // The sample is all of a 2 s file: 0.5 s is a quarter in.
    at(0.5);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const editor = screen.getByRole('region', { name: 'Sample' });
    expect([...editor.querySelectorAll<HTMLElement>('.playhead')].map((h) => h.style.left)).toEqual(['25%', '25%']);
  });

  it('with a hit selected in Pads still loops the matrix, and shows Stop until the player stops', async () => {
    const p = split();
    const { player, end } = await setup(p, { view: 'pads', selection: { ...initialState(p).selection, pad: matrixOf(p).pads[1]!, hit: memberOf(p, 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    // One button: Play is Stop while it plays.
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveProperty('disabled', false);
    // Stopped by the player, it shows Play again.
    await act(async () => {
      end();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('the grid in Matrices', () => {
  it('shows the pads of the matrix shown, and of another when it is shown', async () => {
    const p = split(addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
    const { store } = await setup(p, { view: 'pads' });
    const timeline = () => screen.getByRole('region', { name: 'Pads of the matrix' });
    expect(within(timeline()).getAllByRole('button', { name: /^Pad / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Pad amen 1 01', 'Pad amen 1 02', 'Pad amen 1 03', 'Pad amen 1 04']);
    const snare = Object.values(p.matrices).find((m) => m.name === 'snare 1')!;
    act(() => void store.dispatch({ type: 'focus', matrix: snare.id }));
    expect(within(timeline()).getAllByRole('button', { name: /^Pad / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Pad snare 1']);
  });

  it('shows a replaced slice as 04→02', async () => {
    const p0 = split();
    const p = split(setHitSource(memberOf(p0, 3), sampleOf(p0).id, 1));
    await setup(p, { view: 'pads' });
    const chip = screen.getByRole('button', { name: '1 04→02, amen 1 04' });
    // ♪: it is heard in the song.
    expect(chip.querySelector('.hit-label')?.textContent).toBe('1 04→02');
    expect(chip.className).toContain('replaced');
  });
});

describe('Clone matrix in Pads', () => {
  it('copies the matrix in focus and puts the copy in focus', async () => {
    const p = split();
    const matrix = matrixOf(p);
    const { store } = await setup(p, { view: 'pads', selection: { ...initialState(p).selection, matrix: matrix.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    const copy = Object.values(store.getState().history.present.matrices).find((m) => m.id !== matrix.id)!;
    expect(copy.name).toBe('amen 1 copy');
    expect(store.getState().selection).toMatchObject({ matrix: copy.id, pad: null, hit: null });
    expect(store.getState().focus.matrix).toBe(copy.id);
    expect(screen.getByRole('button', { name: /^Undo: new matrix amen 1 copy/ })).toBeTruthy();
  });
});

/** The open Delete dialog, its text, and Cancel or Delete in it. */
const deleteDialog = () => screen.getByRole('alertdialog');
const answer = (yes: boolean) => fireEvent.click(within(deleteDialog()).getByRole('button', { name: yes ? 'Delete' : 'Cancel' }));

describe('Delete matrix', () => {
  it('in Pads marks a matrix heard in the song, and asks before deleting it anyway; its loop stays', async () => {
    const p = split();
    const matrix = matrixOf(p);
    const { store } = await setup(p, { view: 'pads', selection: { ...initialState(p).selection, matrix: matrix.id } });
    fireEvent.click(screen.getByRole('button', { name: '♪ Song →' }));
    expect(store.getState().view).toBe('song');
    act(() => void store.dispatch({ type: 'view', view: 'pads' }));
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
    // No other matrix takes its place in focus (U15).
    expect(store.getState().focus.matrix).toBeNull();
  });
});

describe('Delete in Samples', () => {
  /** split with a second sample of the file, which nothing else uses. */
  const twoTrims = () => split(addTrim(sampleOf(split()).id));

  it('in Samples asks even for a sample nothing else uses, listing what goes with it', async () => {
    const { store } = await setup(twoTrims(), { view: 'samples' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete sample amen sample 2' }));
    const dialog = deleteDialog();
    expect(dialog.getAttribute('aria-label')).toBe('Delete amen sample 2?');
    expect(within(dialog).getByText('matrix amen 2')).toBeTruthy();
    expect(within(dialog).queryByText('Goes silent in')).toBeNull();
    answer(true);
    expect(Object.values(store.getState().history.present.matrices).map((m) => m.name)).toEqual(['amen 1']);
    expect(Object.values(store.getState().history.present.samples).map((s) => s.trim)).toEqual([1]);
  });

  it('a sample heard in the song lists where it goes silent', async () => {
    await setup(split(), { view: 'samples' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete sample amen sample 1' }));
    expect(within(deleteDialog()).getByText('Song')).toBeTruthy();
    expect(within(deleteDialog()).getByText('4 pads')).toBeTruthy();
  });

  it('Escape closes the dialog without deleting', async () => {
    const { store } = await setup(split(), { view: 'samples' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete sample amen sample 1' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(Object.keys(store.getState().history.present.samples)).toHaveLength(1);
  });

  it('Delete file in Samples takes every sample of the file, after asking', async () => {
    const { store } = await setup(twoTrims(), { view: 'samples' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete file amen.wav' }));
    answer(false);
    expect(Object.keys(store.getState().history.present.samples)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file amen.wav' }));
    expect(within(deleteDialog()).getByText('amen sample 1 (matrix amen 1, 4 pads, 4 hits)')).toBeTruthy();
    expect(within(deleteDialog()).getByText('amen sample 2 (matrix amen 2, 1 pad, 1 hit)')).toBeTruthy();
    answer(true);
    expect(store.getState().history.present.matrices).toEqual({});
    expect(store.getState().history.present.samples).toEqual({});
    expect(store.getState().history.present.audio).toEqual({});
  });
});

describe('the same controls everywhere, in Pads', () => {
  it('Play in the header plays the matrix, as Space does, with a hit selected too; the pad that plays lights up, pass after pass', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const { player, at } = await setup(p, { view: 'pads', selection: { ...initialState(p).selection, pad: matrixOf(p).pads[1]!, hit } });
    const grid = screen.getByRole('region', { name: 'Pads of the matrix' });
    const playingAt = async (seconds: number) => {
      at(seconds);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      return Array.from(grid.querySelectorAll<HTMLElement>('.pad-tile.playing')).map((t) => t.dataset.pad);
    };
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    // A bar of 2 s in four pads: 0.25 s is in pad 01, and so is 2.25 s, a pass later; 0.75 s in pad 02.
    expect(await playingAt(0.25)).toEqual([matrixOf(p).pads[0]]);
    expect(await playingAt(2.25)).toEqual([matrixOf(p).pads[0]]);
    expect(await playingAt(0.75)).toEqual([matrixOf(p).pads[1]]);
    expect(screen.getByRole('region', { name: 'Hit controls' }).querySelector('.playhead')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(player.stop).toHaveBeenCalled();
  });

  it('the region is set with handles, as in Trim: ←/→ moves an end by 1 ms, Shift by 10 ms', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const { store } = await setup(p, { view: 'pads', selection: { ...initialState(p).selection, pad: matrixOf(p).pads[1]!, hit } });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Start at 0 ms' }), { key: 'ArrowRight', shiftKey: true });
    // The slice is 0.5 s long: 10 ms is a 50th of it.
    expect(store.getState().history.present.hits[hit]!.region.start).toBeCloseTo(0.02);
    expect(screen.getByLabelText('Start ms')).toHaveProperty('value', '10');
  });

  it('Delete hit asks first, and takes it out of its pad', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const pad = matrixOf(p).pads[1]!;
    const { store } = await setup(p, { view: 'pads', selection: { ...initialState(p).selection, pad, hit } });
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

describe('rendering what Play plays', () => {
  it('says Rendering… in the header on every tab while it renders (Claudes val)', async () => {
    const p = split();
    const { store, services } = await setup(p, { view: 'loops' });
    let finish: (take: Take) => void = () => undefined;
    vi.mocked(services.renderSong).mockImplementation(() => new Promise<Take>((resolve) => (finish = resolve)));
    act(() => void store.dispatch({ type: 'run', command: setBpm(130) }));
    await settle();
    const indicator = screen.getByText('Rendering…');
    expect(indicator.closest('header')).not.toBeNull();
    expect(indicator.style.visibility).toBe('visible');
    await act(async () => finish({ buffer: { duration: 2 } as AudioBuffer, triggers: [], tapes: [] }));
    expect(screen.getByText('Rendering…').style.visibility).toBe('hidden');
  });

  it('cancels a render under way when a newer change comes; only the newest runs to the end', async () => {
    const p = split();
    const { store, services } = await setup(p, { view: 'loops' });
    const signals: AbortSignal[] = [];
    vi.mocked(services.renderSong).mockImplementation((_project, _rng, request) => {
      if (request?.signal !== undefined) signals.push(request.signal);
      return new Promise<Take>(() => undefined);
    });
    act(() => void store.dispatch({ type: 'run', command: setBpm(130) }));
    await settle();
    act(() => void store.dispatch({ type: 'run', command: setBpm(140) }));
    await settle();
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it('a change keeps the random picks, so it is the change that is heard; New take picks anew (Claudes val)', async () => {
    const p = split();
    const { store, services } = await setup(p, { view: 'song' });
    let fresh = 0;
    // Each fresh randomness counts on from its own number.
    (services as { rng: Services['rng'] }).rng = () => {
      const base = ++fresh;
      let i = 0;
      return () => (base * 10 + i++) / 1000;
    };
    const draws = () => {
      const rng = vi.mocked(services.renderSong).mock.lastCall![1];
      return [rng(), rng(), rng()];
    };
    act(() => void store.dispatch({ type: 'run', command: setBpm(130) }));
    await settle();
    const first = draws();
    act(() => void store.dispatch({ type: 'run', command: setBpm(140) }));
    await settle();
    expect(draws()).toEqual(first);
    fireEvent.click(screen.getByRole('button', { name: /New take/ }));
    await settle();
    expect(draws()).not.toEqual(first);
  });
});
