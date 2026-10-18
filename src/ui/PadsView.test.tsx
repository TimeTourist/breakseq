// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, copyHits, createMatrix, createProject, renameMatrix, setHitSource, setSlicing, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { AppState, Store } from './store';
import { createStore, initialState } from './store';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ctx = sequentialIds();

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** amen, one bar sliced 4, 2, 6 and 4 steps long, as "amen 1"; pad 02 has a second hit. */
function amen(...more: Command[]): Project {
  const p = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  const q = apply(p, setSlicing(Object.keys(p.samples)[0]!, 1, [0, 0.25, 0.375, 0.75]));
  const m = Object.values(q.matrices)[0]!;
  return apply(q, copyHits([q.pads[m.pads[3]!]!.members[0]!], m.pads[1]!), ...more);
}
const matrixNamed = (p: Project, name: string) => Object.values(p.matrices).find((m) => m.name === name)!;

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
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
  return { services: s, player };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });

/** Pads with `focus` in focus. */
async function setup(project: Project, focus: string | null, patch: Partial<AppState> = {}) {
  const fake = services();
  const store: Store = createStore({ ...initialState(project), view: 'pads', focus: { matrix: focus, takeFrom: [] }, ...patch });
  render(<App store={store} services={fake.services} />);
  await settle();
  return { store, ...fake };
}

const timeline = () => screen.getByRole('region', { name: 'Timeline' });
const columns = () => Array.from(timeline().querySelectorAll<HTMLElement>('.pad-column'));
const present = (store: Store) => store.getState().history.present;
/** The hit buttons of a pad column, top down. */
const hitsIn = (column: HTMLElement) => Array.from(column.querySelectorAll<HTMLButtonElement>('.pad-hits button'));

describe('Pads: the timeline', () => {
  it('pads lay out by their length with their hits downwards', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    await setup(p, m.id);
    const cols = columns();
    expect(cols).toHaveLength(4);
    const widths = cols.map((c) => parseFloat(c.style.width));
    const step = widths[0]! / 4;
    expect(widths.map((w) => Math.round(w / step))).toEqual([4, 2, 6, 4]);
    // Pad 02: its own hit first, marked, and the copy under it.
    const hits = hitsIn(cols[1]!);
    expect(hits.map((h) => h.textContent)).toEqual(['02', '02→04']);
    // The accessible name starts with what is shown, for voice control.
    expect(hits.map((h) => h.getAttribute('aria-label'))).toEqual([`02, ${p.hits[p.pads[m.pads[1]!]!.members[0]!]!.name}`, `02→04, ${p.hits[p.pads[m.pads[1]!]!.members[1]!]!.name}`]);
    expect(hits[0]!.className).toContain('first');
    expect(hits[1]!.className).not.toContain('first');
    expect(within(cols[1]!).getByRole('button', { name: 'Pad amen 1 02' }).textContent).toContain('02');
  });

  // The page itself not scrolling sideways at 400 px is checked in a real browser (happy-dom has no layout).
  it('fit zoom keeps 64 pads readable: each column at least 24 px with its number, hits hidden until the pad is selected', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    const p = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(16) }));
    const q = apply(p, sliceSample(Object.keys(p.samples)[0]!, 4));
    await setup(q, Object.values(q.matrices)[0]!.id);
    expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('true');
    const cols = columns();
    expect(cols).toHaveLength(64);
    // Every column has its number and is wide enough to read; the timeline scrolls in its own box.
    expect(cols.map((c) => c.querySelector('.pad-number')?.textContent)).toEqual(Array.from({ length: 64 }, (_, i) => String(i + 1).padStart(2, '0')));
    expect(Math.min(...cols.map((c) => parseFloat(c.style.width)))).toBeGreaterThanOrEqual(24);
    expect(timeline().className).toContain('timeline-scroll');
    // Too narrow for a hit's label: only the number and the first hit's waveform, until the pad is selected.
    expect(hitsIn(cols[6]!)).toHaveLength(0);
    fireEvent.click(within(cols[6]!).getByRole('button', { name: /^Pad / }));
    expect(hitsIn(columns()[6]!)).toHaveLength(1);
    // 1 bar: 16 steps per width.
    fireEvent.click(screen.getByRole('button', { name: '1 bar' }));
    expect(parseFloat(columns()[0]!.style.width)).toBe(25);
  });

  it('labels show 15→07 and →think 07', async () => {
    let p = amen(addSample({ name: 'think.wav', audio: constantAudio(2) }));
    const think = Object.values(p.samples).find((s) => s.name === 'think.wav')!;
    p = apply(p, sliceSample(think.id, 1));
    p = apply(p, renameMatrix(matrixNamed(p, 'think 1').id, 'think'));
    const m = matrixNamed(p, 'amen 1');
    const row = (i: number) => p.pads[m.pads[i]!]!;
    p = apply(p, setHitSource(row(3).members[0]!, m.sampleId!, 0), setHitSource(row(2).members[0]!, think.id, 6));
    await setup(p, m.id);
    const cols = columns();
    expect(hitsIn(cols[3]!)[0]!.textContent).toBe('04→01');
    expect(hitsIn(cols[2]!)[0]!.textContent).toBe('→think 07');
  });

  it('shortens long names in the middle, with the whole name in the title', async () => {
    const long = 'a-very-long-snare-name-from-a-sample-pack-001';
    const p = apply(amen(addSample({ name: `${long}.wav`, audio: constantAudio(0.2) })), createMatrix('Snares'));
    const snares = matrixNamed(p, 'Snares');
    const q = apply(p, copyHits([Object.values(p.hits).find((h) => h.name.startsWith(long))!.id], snares.pads[0]!));
    await setup(q, snares.id);
    const hit = hitsIn(columns()[0]!)[0]!;
    expect(hit.textContent).toContain('…');
    expect(hit.textContent!.startsWith('a-very')).toBe(true);
    const name = Object.values(q.hits).find((h) => h.name.startsWith(long))!.name;
    expect(hit.textContent!.endsWith(name.slice(-3))).toBe(true);
    expect(hit.getAttribute('title')).toContain(long);
  });
});

describe('Pads: the focus bar', () => {
  it('chooses the matrix in focus and those taken from, and makes a new matrix: Matrix 1', async () => {
    const p = amen(createMatrix('Snares'));
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.change(screen.getByRole('combobox', { name: 'Matrix in focus' }), { target: { value: matrixNamed(p, 'Snares').id } });
    expect(store.getState().focus.matrix).toBe(matrixNamed(p, 'Snares').id);
    const take = within(screen.getByRole('group', { name: 'Take from' })).getByRole('button', { name: 'amen 1' });
    fireEvent.click(take);
    expect(store.getState().focus.takeFrom).toEqual([m.id]);
    expect(take.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '+ New matrix' }));
    const made = matrixNamed(present(store), 'Matrix 1');
    expect(made).toBeTruthy();
    expect(store.getState().focus.matrix).toBe(made.id);
  });

  it('without focus asks for a matrix, and without matrices links to Samples', async () => {
    const p = amen();
    const { store } = await setup(p, null);
    expect(screen.getByText(/Choose a matrix to work on/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Matrix in focus' }), { target: { value: matrixNamed(p, 'amen 1').id } });
    expect(store.getState().focus.matrix).toBe(matrixNamed(p, 'amen 1').id);
    cleanup();

    const empty = await setup(createProject(), null);
    fireEvent.click(screen.getByRole('button', { name: '← Samples' }));
    expect(empty.store.getState().view).toBe('samples');
  });
});

describe('Pads: the controls', () => {
  it('selecting a hit, a pad or the matrix shows its controls', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store, player } = await setup(p, m.id);
    // The matrix at first: its config.
    expect(screen.getByRole('region', { name: 'Matrix controls' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pad amen 1 02' }));
    const pad = screen.getByRole('region', { name: 'Pad controls' });
    expect(within(pad).getByRole('group', { name: 'Pad plays' })).toBeTruthy();
    expect(within(pad).getByRole('button', { name: /Pad sound/ })).toBeTruthy();
    expect(within(pad).getByRole('button', { name: 'Delete pad amen 1 02' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Matrix controls' })).toBeNull();

    const hit = hitsIn(columns()[1]!)[1]!;
    fireEvent.click(hit);
    // A click plays it.
    expect(player.playHit).toHaveBeenCalledTimes(1);
    const controls = screen.getByRole('region', { name: 'Hit controls' });
    expect(within(controls).getByRole('button', { name: 'Replace…' })).toBeTruthy();
    expect(within(controls).getByRole('button', { name: 'Variant' })).toBeTruthy();
    expect(within(controls).getByRole('group', { name: 'Direction' })).toBeTruthy();
    expect(within(controls).getAllByRole('button', { name: /^(Start|End) at/ })).toHaveLength(2);
    expect(hit.getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Matrix amen 1' }));
    expect(screen.getByRole('region', { name: 'Matrix controls' })).toBeTruthy();
    expect(store.getState().selection).toMatchObject({ matrix: m.id, pad: null, hit: null });
  });

  it('the pad’s choice is on the pad', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: '1 bar' }));
    fireEvent.change(within(columns()[1]!).getByRole('combobox', { name: 'How amen 1 02 picks' }), { target: { value: 'roundRobin' } });
    expect(present(store).pads[m.pads[1]!]!.choice).toBe('roundRobin');
  });

  it('a pad moves left and right in the timeline, not past its ends', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[0]! } });
    const name = p.pads[m.pads[0]!]!.name;
    expect(screen.getByRole('button', { name: `Move ${name} left` })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: `Move ${name} right` }));
    expect(present(store).matrices[m.id]!.pads.slice(0, 2)).toEqual([m.pads[1], m.pads[0]]);
    // Still selected, now in row 02.
    const moved = present(store).pads[m.pads[0]!]!;
    fireEvent.click(screen.getByRole('button', { name: `Move ${moved.name} left` }));
    expect(present(store).matrices[m.id]!.pads).toEqual(m.pads);
    const last = present(store).pads[m.pads[3]!]!;
    act(() => void store.dispatch({ type: 'select', selection: { pad: last.id, hit: null } }));
    expect(screen.getByRole('button', { name: `Move ${last.name} right` })).toHaveProperty('disabled', true);
  });

  it('deleting a hit asks first', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const hitId = p.pads[m.pads[1]!]!.members[1]!;
    const { store } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[1]!, hit: hitId } });
    const name = p.hits[hitId]!.name;
    fireEvent.click(screen.getByRole('button', { name: `Delete hit ${name}` }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(present(store).hits[hitId]).toBeDefined();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(present(store).hits[hitId]).toBeUndefined();
  });

  it('the matrix row renames, clones, adds a pad and deletes the matrix, leaving no other in focus', async () => {
    const p = amen(createMatrix('Snares'));
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: '+ Pad' }));
    expect(present(store).matrices[m.id]!.pads).toHaveLength(5);
    expect(columns()).toHaveLength(5);
    expect(columns()[4]!.className).toContain('empty');

    fireEvent.change(screen.getByRole('textbox', { name: 'Matrix name' }), { target: { value: 'think' } });
    expect(present(store).matrices[m.id]!.name).toBe('think');

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    const clone = matrixNamed(present(store), 'think copy');
    expect(store.getState().focus.matrix).toBe(clone.id);

    fireEvent.click(screen.getByRole('button', { name: 'Delete matrix think copy' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(store.getState().focus.matrix).toBeNull();
    expect(screen.getByText(/Choose a matrix to work on/)).toBeTruthy();
  });

  it('← Samples opens the matrix’s trim in Samples', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: '← Samples' }));
    expect(store.getState()).toMatchObject({ view: 'samples', sliceTarget: m.sampleId });
  });
});

describe('Pads: Play', () => {
  it('the header plays the selection', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store, player, services: s } = await setup(p, m.id);
    // The matrix, in a loop.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(s.renderSong).toHaveBeenCalled();
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    // A pad, as it picks, in a loop.
    act(() => void store.dispatch({ type: 'select', selection: { pad: m.pads[1]!, hit: null } }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(s.renderPreview).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    // A hit, once.
    act(() => void store.dispatch({ type: 'select', selection: { pad: m.pads[1]!, hit: p.pads[m.pads[1]!]!.members[1]! } }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(s.renderPreview).toHaveBeenCalledTimes(2);
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, true);
    // The focus bar's ▶ is the same Play.
    expect(screen.getByRole('button', { name: 'Stop hit' })).toBeTruthy();
  });

  it('while it plays, a click on a hit auditions it once on top, and the groove keeps its take', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { player, services: s } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenCalledTimes(1);
    fireEvent.click(hitsIn(columns()[1]!)[1]!);
    await settle();
    expect(player.playHit).toHaveBeenCalledTimes(1);
    expect(player.stopAudition).toHaveBeenCalledTimes(1); // only by the first Play
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.replace).not.toHaveBeenCalled();
    expect(s.renderPreview).not.toHaveBeenCalled();
    // The hit is selected for its controls; stopped, Play plays it.
    expect(screen.getByRole('region', { name: 'Hit controls' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, true);
  });
});
