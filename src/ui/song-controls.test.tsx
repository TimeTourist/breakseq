// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, createProject, setBpm, setBreak, setSongLoop } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);
beforeEach(() => {
  // happy-dom keeps no pointer capture; the ruler only drags while it has it.
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => true;
});

const take = { buffer: { duration: 16 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take;

function services() {
  const player = {
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
  } satisfies Player;
  const s: Services = {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: vi.fn(() => Promise.resolve(take)),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
  return { services: s, player };
}

/** 8 bars at 120 BPM (a step is 1/8 s), with M1 laid out over bar 1. */
function song(...more: Command[]): Project {
  const ctx = sequentialIds();
  const run = (p: Project, c: Command) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  };
  let project = [addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(120)].reduce(run, createProject());
  project = run(project, setBreak(Object.keys(project.breaks)[0]!, 1));
  project = run(project, addClip('main', Object.keys(project.loops)[0]!, 0, 16));
  return more.reduce(run, project);
}

async function setup(project: Project) {
  const { services: s, player } = services();
  const store: Store = createStore({ ...initialState(project), view: 'song' });
  render(<App store={store} services={s} />);
  // Renders after a debounce.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
  return { store, player };
}

const ruler = () => screen.getByLabelText(/^Ruler/);
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });
const clips = (store: Store) => store.getState().history.present.song.clips.map((c) => [c.row, c.start, c.length]);

describe('Song transport', () => {
  it('a click in the ruler sets where Play starts', async () => {
    const { store, player } = await setup(song());
    fireEvent.pointerDown(ruler(), { clientX: 325, pointerId: 1 });
    fireEvent.pointerUp(ruler(), { clientX: 325, pointerId: 1 });
    expect(store.getState().songCursor).toBe(32);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenCalledWith(take, 4);
  });

  it('a click while playing jumps there', async () => {
    const { player } = await setup(song());
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.pointerDown(ruler(), { clientX: 165, pointerId: 1 });
    fireEvent.pointerUp(ruler(), { clientX: 165, pointerId: 1 });
    expect(player.seek).toHaveBeenCalledWith(2);
  });

  it('a drag in the ruler marks a loop, which plays over and over until turned off', async () => {
    const { store, player } = await setup(song());
    fireEvent.pointerDown(ruler(), { clientX: 160, pointerId: 1 });
    fireEvent.pointerMove(ruler(), { clientX: 320, pointerId: 1 });
    fireEvent.pointerUp(ruler(), { clientX: 320, pointerId: 1 });
    expect(store.getState().history.present.song.loop).toEqual({ start: 16, end: 32, on: true });
    expect(player.setLoop).toHaveBeenLastCalledWith({ start: 2, end: 4 });
    // Marking it was one undo step, and the cursor stayed.
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().songCursor).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /^Loop 2\.1\.1 – 3\.1\.1/ }));
    expect(store.getState().history.present.song.loop?.on).toBe(false);
    expect(player.setLoop).toHaveBeenLastCalledWith(null);
  });

  it('the loop has a handle at each end, dragged like Trim\'s, keeping it off when off', async () => {
    const { store } = await setup(song(setSongLoop(16, 32, false)));
    const end = screen.getByRole('button', { name: 'Loop end at 3.1.1' });
    fireEvent.pointerDown(end, { clientX: 320, pointerId: 1 });
    fireEvent.pointerMove(end, { clientX: 480, pointerId: 1 });
    fireEvent.pointerMove(end, { clientX: 640, pointerId: 1 });
    fireEvent.pointerUp(end, { clientX: 640, pointerId: 1 });
    expect(store.getState().history.present.song.loop).toEqual({ start: 16, end: 64, on: false });
    expect(store.getState().history.past).toHaveLength(1);
    // The start can't pass the end; the cursor stays where it was.
    const start = screen.getByRole('button', { name: 'Loop start at 2.1.1' });
    fireEvent.pointerDown(start, { clientX: 160, pointerId: 2 });
    fireEvent.pointerMove(start, { clientX: 900, pointerId: 2 });
    fireEvent.pointerUp(start, { clientX: 900, pointerId: 2 });
    expect(store.getState().history.present.song.loop).toEqual({ start: 63, end: 64, on: false });
    expect(store.getState().songCursor).toBe(0);
  });

  it('a loop handle moves a step with ←/→, a beat with Shift', async () => {
    const { store } = await setup(song(setSongLoop(16, 32)));
    const start = screen.getByRole('button', { name: 'Loop start at 2.1.1' });
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Loop start at 1.4.4' }), { key: 'ArrowRight', shiftKey: true });
    expect(store.getState().history.present.song.loop).toEqual({ start: 19, end: 32, on: true });
  });

  it('a marked loop is no reason for a new take', async () => {
    const { services: s } = services();
    const store = createStore({ ...initialState(song()), view: 'song' });
    render(<App store={store} services={s} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    act(() => void store.dispatch({ type: 'run', command: setSongLoop(0, 16) }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(s.renderSong).toHaveBeenCalledTimes(1);
  });

  it('Space plays and stops, but not while typing', async () => {
    const { player } = await setup(song());
    press(' ');
    expect(player.play).toHaveBeenCalledTimes(1);
    press(' ');
    expect(player.stop).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('Tempo in BPM'), { key: ' ' });
    expect(player.play).toHaveBeenCalledTimes(1);
  });
});

describe('copying clips', () => {
  it('Ctrl+D puts a copy right after the selected clip, and again after that', async () => {
    const { store } = await setup(song());
    fireEvent.click(screen.getByRole('button', { name: /^M1, 1\.1\.1/ }));
    press('d', { ctrlKey: true });
    press('d', { ctrlKey: true });
    expect(clips(store)).toEqual([
      ['main', 0, 16],
      ['main', 16, 16],
      ['main', 32, 16],
    ]);
  });

  it('Ctrl+C and Ctrl+V paste at the cursor, after the clip is gone too', async () => {
    const { store } = await setup(song());
    const m1 = screen.getByRole('button', { name: /^M1, 1\.1\.1/ });
    fireEvent.click(m1);
    press('c', { ctrlKey: true });
    fireEvent.keyDown(m1, { key: 'Delete' });
    fireEvent.pointerDown(ruler(), { clientX: 485, pointerId: 1 });
    fireEvent.pointerUp(ruler(), { clientX: 485, pointerId: 1 });
    press('v', { ctrlKey: true });
    expect(clips(store)).toEqual([['main', 48, 16]]);
  });

  it('a drag with Ctrl copies the clip', async () => {
    const { store } = await setup(song());
    const id = store.getState().history.present.song.clips[0]!.id;
    const lane = screen.getByLabelText('Main lane');
    const data = { types: ['application/x-breakseq-clip'], getData: () => JSON.stringify({ id, grab: 0 }), effectAllowed: 'copyMove', dropEffect: 'none' };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: data, clientX: 645, ctrlKey: true });
    act(() => void lane.dispatchEvent(drop));
    expect(clips(store)).toEqual([
      ['main', 0, 16],
      ['main', 64, 16],
    ]);
  });
});
