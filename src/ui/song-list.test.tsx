// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, createLoop, createMod, createProject, setSlicing } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { clickLane } from '../test/timeline';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import { LOOP_MIME, MOD_MIME } from './SongView';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const take = { buffer: { duration: 1, numberOfChannels: 1, sampleRate: 44100, getChannelData: () => new Float32Array(1) } as unknown as AudioBuffer, triggers: [], tapes: [] } satisfies Take;

function services() {
  const player = {
    play: vi.fn(),
    replace: vi.fn(),
    queue: vi.fn(),
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
  const renderSong = vi.fn<(song: Project) => Promise<Take>>(() => Promise.resolve(take));
  const s: Services = {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong,
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
  return { services: s, player, renderSong };
}

const apply = (project: Project, ...commands: Command[]) => {
  const ctx = sequentialIds();
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
};

/** A sliced sample with its loop amen 1 (main, 1 bar), a fill Roll and a mod Wobble with two effects. */
function project(): Project {
  let p = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  p = apply(p, setSlicing(Object.keys(p.samples)[0]!, 1));
  return apply(
    p,
    createLoop('Roll', 'fill', 2),
    createMod('Wobble', [
      { target: 'ratchet', step: '1/16', lane: [{ v: 2 }] },
      { target: 'pitch', step: 'beat', lane: [{ v: 0 }], pitch: { values: 'semitones' } },
    ]),
  );
}

async function setup(p: Project) {
  const { services: s, player, renderSong } = services();
  const store: Store = createStore({ ...initialState(p), view: 'song' });
  render(<App store={store} services={s} />);
  await act(async () => {});
  return { store, player, renderSong };
}

const list = () => within(screen.getByRole('region', { name: 'List' }));
const shelf = () => within(screen.getByRole('region', { name: 'Loops and mods' }));
const shelfNames = () => shelf().queryAllByRole('button', { name: /^(amen 1|Roll|Wobble)$/ }).map((b) => b.textContent);
const ids = (store: Store) => {
  const present = store.getState().history.present;
  const loop = (name: string) => Object.values(present.loops).find((l) => l.name === name)!.id;
  return { amen: loop('amen 1'), roll: loop('Roll'), wobble: Object.values(present.mods)[0]!.id };
};

describe('The list in Song (Magnus beslut 2026-10-22: Listan och hyllan i Song, Song-v2)', () => {
  it('is a page like Loops: no heading, the list on the left with Main, Fill and Mods', async () => {
    await setup(project());
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    const groups = list().getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Main', 'Fill', 'Mods']);
    expect(screen.getByLabelText('Bars')).toBeTruthy();
  });

  it('has a row per loop and mod with its pin, name, length or number of effects, and ♪ when heard', async () => {
    const p = project();
    const heard = apply(p, addClip('main', Object.values(p.loops).find((l) => l.name === 'amen 1')!.id, 0, 16));
    await setup(heard);
    const main = within(list().getByRole('group', { name: 'Main' }));
    const amen = main.getByRole('button', { name: 'Hear amen 1' });
    expect(amen.textContent).toContain('1 bar');
    expect(within(amen).queryByLabelText('heard in the song')).not.toBeNull();
    expect(main.getByRole('button', { name: 'Unpin amen 1' }).getAttribute('aria-pressed')).toBe('true');
    const roll = within(list().getByRole('group', { name: 'Fill' })).getByRole('button', { name: 'Hear Roll' });
    expect(roll.textContent).toContain('2 bars');
    expect(within(roll).queryByLabelText('heard in the song')).toBeNull();
    const wobble = within(list().getByRole('group', { name: 'Mods' })).getByRole('button', { name: 'Hear Wobble' });
    expect(wobble.textContent).toContain('2 effects');
  });

  it('rows are not dragged: one drags from the shelf', async () => {
    await setup(project());
    for (const name of ['Hear amen 1', 'Hear Roll', 'Hear Wobble']) expect(list().getByRole('button', { name }).getAttribute('draggable')).not.toBe('true');
  });

  it('a click on a loop row plays it once and selects nothing', async () => {
    const { store, player, renderSong } = await setup(project());
    const { amen } = ids(store);
    const before = store.getState().selection;
    renderSong.mockClear();
    await act(async () => {
      fireEvent.click(list().getByRole('button', { name: 'Hear amen 1' }));
    });
    const song = renderSong.mock.calls.at(-1)![0];
    expect(song.song.clips.map((c) => [c.row, c.ref])).toEqual([['main', amen]]);
    expect(player.audition).toHaveBeenCalled();
    expect(store.getState().selection).toBe(before);
    expect(shelf().getByRole('button', { name: 'amen 1' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('a click on a mod row plays the mod once on its loop under Plays on', async () => {
    const { store, player, renderSong } = await setup(project());
    const { roll, wobble } = ids(store);
    store.dispatch({ type: 'select', selection: { previewLoop: roll } });
    renderSong.mockClear();
    await act(async () => {
      fireEvent.click(list().getByRole('button', { name: 'Hear Wobble' }));
    });
    const song = renderSong.mock.calls.at(-1)![0];
    expect(song.song.clips.map((c) => [c.row, c.ref])).toEqual([
      ['main', roll],
      ['modA', wobble],
    ]);
    expect(player.audition).toHaveBeenCalled();
  });
});

describe('The shelf Loops and mods (Magnus beslut 2026-10-22)', () => {
  it('holds every loop and mod from the start, in groups Main, Fill and Mods', async () => {
    await setup(project());
    expect(shelfNames()).toEqual(['amen 1', 'Roll', 'Wobble']);
    expect(shelf().getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Main', 'Fill', 'Mods']);
  });

  it('shows only the pinned: a pin taken away takes it off the shelf, and back on', async () => {
    await setup(project());
    fireEvent.click(list().getByRole('button', { name: 'Unpin Roll' }));
    expect(shelfNames()).toEqual(['amen 1', 'Wobble']);
    expect(list().getByRole('button', { name: 'Pin Roll' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(list().getByRole('button', { name: 'Unpin Wobble' }));
    expect(shelfNames()).toEqual(['amen 1']);
    fireEvent.click(list().getByRole('button', { name: 'Pin Roll' }));
    expect(shelfNames()).toEqual(['amen 1', 'Roll']);
  });

  it('a new loop or mod is on the shelf at once', async () => {
    const { store } = await setup(project());
    act(() => {
      store.dispatch({ type: 'run', command: createMod('Dive', []) });
      store.dispatch({ type: 'run', command: createLoop('Think', 'main', 1) });
    });
    expect(shelf().getByRole('button', { name: 'Dive' })).toBeTruthy();
    expect(shelf().getByRole('button', { name: 'Think' })).toBeTruthy();
  });

  it('the pins are not undone', async () => {
    const { store } = await setup(project());
    fireEvent.click(list().getByRole('button', { name: 'Unpin Roll' }));
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('asks for a pin when nothing is pinned', async () => {
    await setup(project());
    for (const name of ['Unpin amen 1', 'Unpin Roll', 'Unpin Wobble']) fireEvent.click(list().getByRole('button', { name }));
    expect(shelfNames()).toEqual([]);
    expect(shelf().getByText(/Pin a loop or mod in the list/)).toBeTruthy();
  });

  it('without loops or mods links to Loops and Mods, as before', async () => {
    await setup(createProject());
    expect(shelf().getByText(/No loops yet/)).toBeTruthy();
    expect(shelf().getByRole('button', { name: '← Loops' })).toBeTruthy();
    expect(shelf().getByRole('button', { name: '← Mods' })).toBeTruthy();
  });

  it('its chips are dragged onto lanes, or selected and placed with a click', async () => {
    const { store } = await setup(project());
    const { roll, wobble } = ids(store);
    const set = vi.fn();
    fireEvent.dragStart(shelf().getByRole('button', { name: 'Roll' }), { dataTransfer: { setData: set, effectAllowed: '' } });
    expect(set).toHaveBeenCalledWith(LOOP_MIME, roll);
    fireEvent.dragStart(shelf().getByRole('button', { name: 'Wobble' }), { dataTransfer: { setData: set, effectAllowed: '' } });
    expect(set).toHaveBeenCalledWith(MOD_MIME, wobble);
    fireEvent.click(shelf().getByRole('button', { name: 'Wobble' }));
    clickLane('Mod A', 0);
    expect(store.getState().history.present.song.clips.map((c) => [c.row, c.ref])).toEqual([['modA', wobble]]);
  });

  it('a selected chip that is unpinned places nothing', async () => {
    const { store } = await setup(project());
    fireEvent.click(shelf().getByRole('button', { name: 'Wobble' }));
    fireEvent.click(list().getByRole('button', { name: 'Unpin Wobble' }));
    clickLane('Mod A', 0);
    expect(store.getState().history.present.song.clips).toEqual([]);
  });
});
