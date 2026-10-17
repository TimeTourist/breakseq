// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, cloneBreak, createProject, setBpm, setBreak, setHitSource, setMarkers } from '../model';
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
  const id = Object.keys(p.breaks)[0]!;
  p = [setBreak(id, 1), setMarkers(id, [0, 0.25, 0.5, 0.75])].reduce(run, p);
  p = run(p, addClip('main', Object.keys(p.loops)[0]!, 0, 16));
  return more.reduce(run, p);
}

const brkOf = (p: Project) => Object.values(p.breaks)[0]!;
const memberOf = (p: Project, slot: number) => p.pads[brkOf(p).pads[slot]!]!.members[0]!;
const state = (p: Project, patch: Partial<AppState>): AppState => ({ ...initialState(p), ...patch });

describe('what Play plays', () => {
  const p = split();
  const brk = brkOf(p);

  it('is the trimmed sample in Import, looped for a break; the song with no Trim open', () => {
    expect(subjectOf(p, state(p, { view: 'import' }))?.key).toBe(SONG_KEY);
    expect(subjectOf(p, state(p, { view: 'import', sliceTarget: brk.id }))?.key).toBe(SONG_KEY);
    const s = subjectOf(p, state(p, { view: 'import', trimming: brk.id }));
    expect(s).toMatchObject({ key: `sample:${brk.sampleId}`, once: false, kind: 'preview' });
  });

  it('is the break as laid out in Slice', () => {
    expect(subjectOf(p, state(p, { view: 'slice' }))).toMatchObject({ key: `break:${brk.id}`, kind: 'song' });
  });

  it('is in Hits the open parent, the picked hit, or the pad as it picks; looped unless Once', () => {
    const sel = initialState(p).selection;
    expect(initialState(p).hitsLoop).toBe(true);
    expect(subjectOf(p, state(p, { view: 'hits', hitsLoop: false, selection: { ...sel, hit: brk.parent } }))?.key).toBe(`break:${brk.id}:true`);
    expect(subjectOf(p, state(p, { view: 'hits', hitsLoop: false, selection: { ...sel, pad: brk.pads[1]!, hit: memberOf(p, 1) } }))?.key).toBe(`hit:${memberOf(p, 1)}:true`);
    const pad = subjectOf(p, state(p, { view: 'hits', selection: { ...sel, pad: brk.pads[1]! } }));
    expect(pad).toMatchObject({ key: `pad:${brk.pads[1]}:false`, once: false });
  });

  it('is the song in Song and Project', () => {
    expect(subjectOf(p, state(p, { view: 'song' }))?.key).toBe(SONG_KEY);
    expect(subjectOf(p, state(p, { view: 'project' }))?.key).toBe(SONG_KEY);
  });
});

function services() {
  const take = (seconds: number): Take => ({ buffer: { duration: seconds } as AudioBuffer, triggers: [], tapes: [] });
  let playing = false;
  const player = {
    play: vi.fn(() => void (playing = true)),
    replace: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(() => void (playing = false)),
    isPlaying: () => playing,
    currentTrigger: () => null,
    currentPosition: () => null,
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
    download: vi.fn(),
    rng: () => () => 0,
  };
  return { services: s, player, end: () => void (playing = false) };
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
    const { player, end } = await setup(p, { view: 'hits', hitsLoop: false, selection: { ...initialState(p).selection, pad: brkOf(p).pads[1]!, hit: memberOf(p, 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, true);
    // Played out, it stops by itself.
    await act(async () => {
      end();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
  });
});

describe('the Hits list', () => {
  it('folds away a parent\'s pads', async () => {
    const p = split();
    await setup(p, { view: 'hits', unfolded: [brkOf(p).id] });
    const list = screen.getByLabelText('Breaks and pads');
    expect(within(list).getAllByRole('button', { name: /^Pad / }).length).toBeGreaterThan(0);
    fireEvent.click(within(list).getByRole('button', { name: /^Hide the pads of/ }));
    expect(within(list).queryAllByRole('button', { name: /^Pad amen/ })).toHaveLength(0);
    fireEvent.click(within(list).getByRole('button', { name: /^Show the pads of/ }));
    expect(within(list).getAllByRole('button', { name: /^Pad amen/ }).length).toBeGreaterThan(0);
  });

  it('starts folded, and collapses and expands every break at once', async () => {
    await setup(split(), { view: 'hits' });
    expect(within(screen.getByLabelText('Breaks and pads')).queryAllByRole('button', { name: /^Pad amen/ })).toHaveLength(0);
    fireEvent.click(within(screen.getByLabelText('Breaks and pads')).getByRole('button', { name: 'Expand all' }));
    const list = screen.getByLabelText('Breaks and pads');
    fireEvent.click(within(list).getByRole('button', { name: 'Collapse all' }));
    expect(within(list).queryAllByRole('button', { name: /^Pad amen/ })).toHaveLength(0);
    fireEvent.click(within(list).getByRole('button', { name: 'Expand all' }));
    expect(within(list).getAllByRole('button', { name: /^Pad amen/ }).length).toBeGreaterThan(0);
  });

  it('shows a replaced slice as 04→02', async () => {
    const p0 = split();
    const p = split(setHitSource(memberOf(p0, 3), brkOf(p0).id, 1));
    await setup(p, { view: 'hits', unfolded: [brkOf(p).id] });
    const chip = screen.getByTitle(/plays 02 instead/);
    expect(chip.textContent).toBe('04→02');
    expect(chip.className).toContain('replaced');
  });
});

describe('Clone break in Hits', () => {
  it('copies the open parent’s break and opens the copy', async () => {
    const p = split();
    const brk = brkOf(p);
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, hit: brk.parent } });
    fireEvent.click(screen.getByRole('button', { name: 'Clone break' }));
    const breaks = Object.values(store.getState().history.present.breaks);
    const copy = breaks.find((b) => b.id !== brk.id)!;
    expect(copy.name).toBe('amen copy');
    expect(store.getState().selection.hit).toBe(copy.parent);
    expect(screen.getByRole('button', { name: /^Undo: add break amen copy/ })).toBeTruthy();
  });
});

describe('Delete break', () => {
  it('in Hits says where the break is used, and asks before deleting it anyway', async () => {
    const p = split();
    const brk = brkOf(p);
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, hit: brk.parent } });
    expect(screen.getByRole('button', { name: 'Song' })).toBeTruthy();
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = confirm;
    fireEvent.click(screen.getByRole('button', { name: 'Delete break amen.wav' }));
    expect(store.getState().history.present.breaks[brk.id]).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete break amen.wav' }));
    expect(store.getState().history.present.breaks[brk.id]).toBeUndefined();
    expect(store.getState().history.present.song.clips).toEqual([]);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('in Import removes a break nothing else uses', async () => {
    const p = split(cloneBreak(brkOf(split()).id));
    const { store } = await setup(p, { view: 'import' });
    const confirm = vi.fn();
    window.confirm = confirm;
    fireEvent.click(screen.getByRole('button', { name: 'Delete break amen copy' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(Object.values(store.getState().history.present.breaks).map((b) => b.name)).toEqual(['amen.wav']);
  });
});
