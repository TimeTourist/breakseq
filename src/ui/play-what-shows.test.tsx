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
    expect(copy.name).toBe('amen 1 copy');
    expect(store.getState().selection.hit).toBe(copy.parent);
    expect(screen.getByRole('button', { name: /^Undo: add break amen 1 copy/ })).toBeTruthy();
  });
});

describe('Delete break', () => {
  it('in Hits marks a break heard in the song, and asks before deleting it anyway', async () => {
    const p = split();
    const brk = brkOf(p);
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, hit: brk.parent } });
    fireEvent.click(screen.getByRole('button', { name: '♪ Song' }));
    expect(store.getState().view).toBe('song');
    act(() => void store.dispatch({ type: 'view', view: 'hits' }));
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = confirm;
    fireEvent.click(screen.getByRole('button', { name: 'Delete break amen 1' }));
    expect(store.getState().history.present.breaks[brk.id]).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete break amen 1' }));
    expect(store.getState().history.present.breaks[brk.id]).toBeUndefined();
    expect(store.getState().history.present.song.clips).toEqual([]);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('in Import asks even for a break nothing else uses, listing what goes with it', async () => {
    const p = split(cloneBreak(brkOf(split()).id));
    const { store } = await setup(p, { view: 'import' });
    const confirm = vi.fn().mockReturnValue(true);
    window.confirm = confirm;
    fireEvent.click(screen.getByRole('button', { name: 'Delete break amen 1 copy' }));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/^Delete amen 1 copy\?\nGoes with it: \d+ pads, \d+ hits, loop amen 1 copy\./);
    expect(confirm.mock.calls[0]?.[0]).not.toMatch(/Goes silent/);
    expect(Object.values(store.getState().history.present.breaks).map((b) => b.name)).toEqual(['amen 1']);
  });

  it('Delete file in Import takes every trim of the file, after asking', async () => {
    const p = split(cloneBreak(brkOf(split()).id));
    const { store } = await setup(p, { view: 'import' });
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = confirm;
    fireEvent.click(screen.getByRole('button', { name: 'Delete file amen.wav' }));
    expect(Object.keys(store.getState().history.present.breaks)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file amen.wav' }));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/^Delete amen\.wav\?\nGoes with it: break amen 1 \(16 pads, 17 hits, loop amen 1\), break amen 1 copy \(/);
    expect(store.getState().history.present.breaks).toEqual({});
    expect(store.getState().history.present.audio).toEqual({});
  });
});

describe('the same controls everywhere, in Hits', () => {
  it('▶ next to the picked hit plays what Space plays, and its playhead runs through the region', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const { store, player, at } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, pad: brkOf(p).pads[1]!, hit } });
    act(() => void store.dispatch({ type: 'run', command: (q) => ({ ok: true, project: { ...q, hits: { ...q.hits, [hit]: { ...q.hits[hit]!, region: { start: 0.2, end: 0.6 } } } } }) }));
    await settle();
    const hitPanel = screen.getByRole('region', { name: 'Hit' });
    expect(within(hitPanel).getByRole('group', { name: 'Play mode' })).toBeTruthy();
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
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, pad: brkOf(p).pads[1]!, hit } });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Start at 0 ms' }), { key: 'ArrowRight', shiftKey: true });
    // The slice is 0.5 s long: 10 ms is a 50th of it.
    expect(store.getState().history.present.hits[hit]!.region.start).toBeCloseTo(0.02);
    expect(screen.getByLabelText('Start ms')).toHaveProperty('value', '10');
  });

  it('Delete hit asks first, naming where the hit is used, and takes it out of there', async () => {
    const p = split();
    const hit = memberOf(p, 1);
    const pad = brkOf(p).pads[1]!;
    const { store } = await setup(p, { view: 'hits', selection: { ...initialState(p).selection, pad, hit } });
    window.confirm = vi.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: `Delete hit ${p.hits[hit]!.name}` }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(`pad ${p.pads[pad]!.name}`));
    expect(store.getState().history.present.hits[hit]).toBeDefined();
    window.confirm = vi.fn(() => true);
    fireEvent.click(screen.getByRole('button', { name: `Delete hit ${p.hits[hit]!.name}` }));
    expect(store.getState().history.present.hits[hit]).toBeUndefined();
    expect(store.getState().history.present.pads[pad]!.members).toEqual([]);
  });
});
