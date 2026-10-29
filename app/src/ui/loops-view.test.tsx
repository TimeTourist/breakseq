// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, setSlicing, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { unpinAllBut } from '../test/focus';
import { App } from './App';
import type { Take } from './playback';
import type { Services } from './services';
import type { AppState, Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function services() {
  const buffer = { duration: 1, sampleRate: 100, numberOfChannels: 2, getChannelData: () => new Float32Array(100) } as unknown as AudioBuffer;
  const renderSong = vi.fn(() => Promise.resolve({ buffer, triggers: [], tapes: [] } satisfies Take));
  const s: Services = {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player: {
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
    },
    renderPreview: () => Promise.resolve({ buffer, triggers: [], tapes: [] }),
    renderSong,
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
  return { services: s, renderSong };
}

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** amen sliced in 16 (one step each) with its own loop "amen 1", and loops M1 (main) and F1 (fill), one bar each. */
function project() {
  const p = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  const sample = Object.values(p.samples)[0]!;
  const q = apply(p, setSlicing(sample.id, 1), createLoop('M1', 'main', 1), createLoop('F1', 'fill', 1));
  const loop = (name: string) => Object.values(q.loops).find((l) => l.name === name)!;
  const matrix = Object.values(q.matrices)[0]!;
  return { project: q, m1: loop('M1'), f1: loop('F1'), own: loop('amen 1'), matrix };
}

async function setup(p: Project, patch: Partial<AppState> = {}) {
  const fake = services();
  const store: Store = createStore({ ...initialState(p), view: 'loops', ...patch });
  render(<App store={store} services={fake.services} />);
  await act(async () => {});
  return { store, ...fake };
}

const present = (store: Store) => store.getState().history.present;
const list = () => screen.getByRole('region', { name: 'Loops' });
const step = (n: number) => screen.getByRole('button', { name: new RegExp(`^Bar 1, step ${n}:`) });
function drag(from: HTMLElement, to: HTMLElement) {
  const data = new Map<string, string>();
  const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'all', dropEffect: 'move' };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
  fireEvent.dragEnd(from, { dataTransfer });
}

describe('Loops: the list (Magnus beslut)', () => {
  it('groups the loops in Main and Fill, and has no Focus, Take from or + New matrix', async () => {
    const { project: p } = project();
    await setup(p);
    const main = within(within(list()).getByRole('group', { name: 'Main' }));
    expect(main.getAllByRole('button', { name: /^Loop / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Loop amen 1', 'Loop M1']);
    expect(within(within(list()).getByRole('group', { name: 'Fill' })).getAllByRole('button', { name: /^Loop / })).toHaveLength(1);
    expect(screen.queryByRole('combobox', { name: 'Matrix in focus' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ New matrix' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Swap/ })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('a loop dragged onto another goes before it, into the other group too, which changes its tag', async () => {
    const { project: p, m1, f1 } = project();
    const { store } = await setup(p);
    drag(within(list()).getByRole('button', { name: 'Loop M1' }), within(list()).getByRole('button', { name: 'Loop F1' }).parentElement!);
    expect(present(store).loops[m1.id]!.kind).toBe('fill');
    expect(Object.keys(present(store).loops).indexOf(m1.id)).toBe(Object.keys(present(store).loops).indexOf(f1.id) - 1);
    // On a group's row: last in it.
    drag(within(list()).getByRole('button', { name: 'Loop F1' }), within(within(list()).getByRole('group', { name: 'Main' })).getByText('Main').parentElement!);
    expect(present(store).loops[f1.id]!.kind).toBe('main');
    const order = Object.keys(present(store).loops);
    expect(order.indexOf(f1.id)).toBe(Object.values(present(store).loops).filter((l) => l.kind === 'main').length - 1);
    act(() => void store.dispatch({ type: 'undo' }));
    expect(present(store).loops[f1.id]!.kind).toBe('fill');
  });

  it('a click on a loop selects it and plays it once; a click on a matrix only plays it', async () => {
    const { project: p, f1, matrix } = project();
    const { store, renderSong, services: s } = await setup(p);
    await act(async () => void fireEvent.click(within(list()).getByRole('button', { name: 'Loop F1' })));
    expect(store.getState().selection.loop).toBe(f1.id);
    expect(renderSong).toHaveBeenCalled();
    expect(s.player.audition).toHaveBeenCalled();
    const before = store.getState().selection;
    await act(async () => void fireEvent.click(within(list()).getByRole('button', { name: `Hear ${matrix.name}` })));
    expect(store.getState().selection).toBe(before);
    expect(vi.mocked(s.player.audition)).toHaveBeenCalledTimes(2);
  });

  it('+ New loop makes a main loop and selects it', async () => {
    const { project: p } = project();
    const { store } = await setup(p);
    fireEvent.click(within(list()).getByRole('button', { name: '+ New loop' }));
    const made = Object.values(present(store).loops).at(-1)!;
    expect(made.kind).toBe('main');
    expect(store.getState().selection.loop).toBe(made.id);
  });
});

describe('Loops: the loop box', () => {
  it('Rename in place, Clone (the copy is selected), and the yellow frame on the box with no step selected', async () => {
    const { project: p, m1 } = project();
    const { store } = await setup(p, { selection: { ...initialState(p).selection, loop: m1.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename M1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Loop name' }), { target: { value: 'Groove' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Loop name' }), { key: 'Enter' });
    expect(present(store).loops[m1.id]!.name).toBe('Groove');
    const box = screen.getByRole('region', { name: 'Loop' });
    expect(box.className).toContain('current');
    fireEvent.click(step(3));
    expect(screen.getByRole('region', { name: 'Loop' }).className).not.toContain('current');
    // A click off the steps and controls selects the loop again.
    fireEvent.click(screen.getByRole('region', { name: 'Loop' }));
    expect(store.getState().selection.step).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    const copy = Object.values(present(store).loops).at(-1)!;
    expect(copy.name).toBe('Groove copy');
    expect(store.getState().selection.loop).toBe(copy.id);
  });

  it('Ctrl+C copies the selected steps, and Ctrl+V lays them out from the selected step over what is there', async () => {
    const { project: p, m1, matrix } = project();
    const base = apply(p, setStep(m1.id, 0, { padId: matrix.pads[0]! }), setStep(m1.id, 5, { padId: matrix.pads[5]! }), setStep(m1.id, 15, { padId: matrix.pads[7]! }));
    const { store } = await setup(base, { selection: { ...initialState(base).selection, loop: m1.id } });
    const pads = () => present(store).loops[m1.id]!.steps.map((s) => s.padId);
    fireEvent.click(step(1));
    fireEvent.click(step(2), { shiftKey: true });
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    fireEvent.click(step(5));
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    // Step 5 gets pad 01, step 6 (which had pad 06) the empty step 2.
    expect(pads().slice(4, 6)).toEqual([matrix.pads[0], null]);
    // Past the loop's end it is dropped.
    fireEvent.click(step(16));
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    expect(pads()).toHaveLength(16);
    expect(pads()[15]).toBe(matrix.pads[0]);
    expect(store.getState().history.past).toHaveLength(2);
  });

  it('a step dragged moves, Alt or not; the step shows its hit’s waveform', async () => {
    const { project: p, m1, matrix } = project();
    const base = apply(p, setStep(m1.id, 0, { padId: matrix.pads[0]! }));
    const { store } = await setup(base, { selection: { ...initialState(base).selection, loop: m1.id } });
    drag(step(1), step(9));
    expect(present(store).loops[m1.id]!.steps.map((s) => s.padId).filter(Boolean)).toEqual([matrix.pads[0]]);
    expect(present(store).loops[m1.id]!.steps[8]!.padId).toBe(matrix.pads[0]);
    expect(step(9).querySelector('.step-wave')).toBeTruthy();
  });

  it('a pad from the shelf of pinned matrices lands on a step, as a copy, by drag or by a pick and a click', async () => {
    const { project: p, m1, matrix } = project();
    const { store } = await setup(p, { selection: { ...initialState(p).selection, loop: m1.id }, focus: { matrix: null, loopUnpins: unpinAllBut(p, [matrix.id]) } });
    const shelf = within(screen.getByRole('region', { name: 'Pads to use' }));
    drag(shelf.getAllByRole('button', { name: /^Pad / })[2]!, step(4));
    expect(present(store).loops[m1.id]!.steps[3]!.padId).toBe(matrix.pads[2]);
    fireEvent.click(shelf.getAllByRole('button', { name: /^Pad / })[4]!);
    fireEvent.click(step(8));
    fireEvent.click(step(10));
    expect([7, 9].map((i) => present(store).loops[m1.id]!.steps[i]!.padId)).toEqual([matrix.pads[4], matrix.pads[4]]);
  });

  it('the selected step: what it plays, Ignore mods, and no Nudge', async () => {
    const { project: p, m1, matrix } = project();
    const base = apply(p, setStep(m1.id, 0, { padId: matrix.pads[0]! }));
    const { store } = await setup(base, { selection: { ...initialState(base).selection, loop: m1.id, step: 0 } });
    const panel = screen.getByRole('region', { name: 'Step' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Ignore mods' }));
    expect(present(store).loops[m1.id]!.steps[0]!.ignoreMods).toBe(true);
    expect(within(panel).queryByText(/Nudge/)).toBeNull();
    expect(screen.queryByText(/Nudge/)).toBeNull();
  });
});
