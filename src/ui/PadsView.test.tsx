// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, copyHits, createMatrix, setPadChoice, createProject, renameMatrix, setHitSource, setSlicing, sliceSample } from '../model';
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
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Create' }));
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

/** amen 1 with Snares, a matrix of two one-shots, taken from in Pads. */
function amenAndSnares(): Project {
  const p = apply(amen(), addSample({ name: 'snare_01.wav', audio: constantAudio(0.1) }), addSample({ name: 'snare_02.wav', audio: constantAudio(0.1) }), createMatrix('Snares'));
  const oneShots = Object.values(p.hits).filter((h) => h.name.startsWith('snare_')).map((h) => h.id);
  return apply(p, copyHits(oneShots, matrixNamed(p, 'Snares').pads[0]!));
}

/** Pads on amen 1 with Snares taken from. */
async function setupTaking(p: Project) {
  return setup(p, matrixNamed(p, 'amen 1').id, { focus: { matrix: matrixNamed(p, 'amen 1').id, takeFrom: [matrixNamed(p, 'Snares').id] } });
}

const shelf = () => screen.getByRole('region', { name: 'Take from shelf' });
/** The first hit of Snares on the shelf. */
const shelfSnare = () => within(within(shelf()).getByRole('group', { name: 'Snares' })).getAllByRole('button', { name: /snare_01/ })[0]!;

/** A browser's drag at the event level: the data set on drag start comes back on drop. `at` places the pointer. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (t: string, v: string) => void data.set(t, v),
    getData: (t: string) => data.get(t) ?? '',
    get types() {
      return [...data.keys()];
    },
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}
type Transfer = ReturnType<typeof dataTransfer>;
/** A dragover or drop at the pointer `at`: happy-dom has no DragEvent, so its plain event gets the pointer here. */
function dragAt(kind: 'dragOver' | 'drop', to: HTMLElement, transfer: Transfer, at: { clientX?: number; clientY?: number } = {}) {
  const event = createEvent[kind](to, { dataTransfer: transfer });
  for (const [key, value] of Object.entries(at)) Object.defineProperty(event, key, { value });
  fireEvent(to, event);
}
function drag(from: HTMLElement, to: HTMLElement, at: { clientX?: number; clientY?: number } = {}, check?: () => void) {
  const transfer = dataTransfer();
  fireEvent.dragStart(from, { dataTransfer: transfer });
  dragAt('dragOver', to, transfer, at);
  check?.();
  dragAt('drop', to, transfer, at);
  fireEvent.dragEnd(from, { dataTransfer: transfer });
}
/** Lays an element out at `rect`, which happy-dom does not. */
const place = (element: HTMLElement, rect: { left?: number; top?: number; width?: number; height?: number }) => {
  const { left = 0, top = 0, width = 0, height = 0 } = rect;
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
};

describe('Pads: the Take from shelf and drag', () => {
  it('a drag near the top or bottom of the window scrolls the page, so a timeline scrolled out of view comes back', async () => {
    await setupTaking(amenAndSnares());
    place(document.querySelector<HTMLElement>('.header')!, { top: 0, width: 1000, height: 70 });
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const transfer = dataTransfer();
    fireEvent.dragStart(shelfSnare(), { dataTransfer: transfer });
    dragAt('dragOver', shelf(), transfer, { clientY: 72 });
    expect(scrollBy).toHaveBeenLastCalledWith({ top: expect.any(Number) as number });
    expect((scrollBy.mock.lastCall![0] as ScrollToOptions).top).toBeLessThan(0);
    dragAt('dragOver', shelf(), transfer, { clientY: window.innerHeight - 2 });
    expect((scrollBy.mock.lastCall![0] as ScrollToOptions).top).toBeGreaterThan(0);
    scrollBy.mockClear();
    dragAt('dragOver', shelf(), transfer, { clientY: 400 });
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.dragEnd(shelfSnare(), { dataTransfer: transfer });
  });

  it('shows each matrix taken from with all hits and its hits', async () => {
    await setupTaking(amenAndSnares());
    const group = within(shelf()).getByRole('group', { name: 'Snares' });
    expect(within(group).getByRole('button', { name: 'All hits of Snares' })).toBeTruthy();
    expect(within(group).getAllByRole('button', { name: /snare_0/ })).toHaveLength(2);
  });

  it('dropping on a pad adds copies last', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setupTaking(p);
    const column = columns()[2]!;
    drag(shelfSnare(), column, {}, () => expect(column.dataset.drop).toBe('add'));
    expect(column.dataset.drop).toBeUndefined();
    const pad = present(store).pads[m.pads[2]!]!;
    expect(pad.members).toHaveLength(2);
    expect(pad.members[0]).toBe(p.pads[m.pads[2]!]!.members[0]);
    expect(present(store).hits[pad.members[1]!]!.name).toMatch(/^snare_01/);
    // A pad on Top with more than one hit turns Round robin, in the same undo step.
    expect(pad.choice).toBe('roundRobin');
    expect(store.getState().history.past).toHaveLength(1);
  });

  it('dropping all hits of a matrix on a pad adds a copy of each', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setupTaking(p);
    drag(within(shelf()).getByRole('button', { name: 'All hits of Snares' }), columns()[2]!);
    expect(present(store).pads[m.pads[2]!]!.members.slice(1).map((h) => present(store).hits[h]!.name)).toEqual(['snare_01 1', 'snare_02 1']);
  });

  it('dropping on a hit replaces it', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setupTaking(p);
    const [first, second] = p.pads[m.pads[1]!]!.members as [string, string];
    const chip = hitsIn(columns()[1]!)[0]!;
    drag(shelfSnare(), chip, {}, () => {
      expect(chip.dataset.drop).toBe('replace');
      expect(columns()[1]!.dataset.drop).toBeUndefined();
    });
    const members = present(store).pads[m.pads[1]!]!.members;
    expect(members).toHaveLength(2);
    expect(present(store).hits[members[0]!]!.name).toMatch(/^snare_01/);
    expect(members[1]).toBe(second);
    expect(present(store).hits[first]).toBeUndefined();
  });

  it('dropping between hits moves within the pad, also to first', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    const [first, second] = p.pads[m.pads[1]!]!.members as [string, string];
    const [top, bottom] = hitsIn(columns()[1]!) as [HTMLButtonElement, HTMLButtonElement];
    place(top, { top: 100, height: 30 });
    // On the top edge of the first hit: before it, shown as a line.
    drag(bottom, top, { clientY: 102 }, () => {
      expect(top.closest('li')!.className).toContain('insert-before');
      expect(top.dataset.drop).toBeUndefined();
    });
    expect(present(store).pads[m.pads[1]!]!.members).toEqual([second, first]);
    expect(store.getState().history.past).toHaveLength(1);
    // And back below it.
    const [nowTop, nowBottom] = hitsIn(columns()[1]!) as [HTMLButtonElement, HTMLButtonElement];
    place(nowBottom, { top: 130, height: 30 });
    drag(nowTop, nowBottom, { clientY: 158 });
    expect(present(store).pads[m.pads[1]!]!.members).toEqual([first, second]);
  });

  it('a hit dropped on the empty part of its own pad moves last, not a copy', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    const [first, second] = p.pads[m.pads[1]!]!.members as [string, string];
    drag(hitsIn(columns()[1]!)[0]!, columns()[1]!);
    expect(present(store).pads[m.pads[1]!]!.members).toEqual([second, first]);
  });

  it('a drag that ends without a drop leaves no mark', async () => {
    await setupTaking(amenAndSnares());
    const transfer = dataTransfer();
    fireEvent.dragStart(shelfSnare(), { dataTransfer: transfer });
    dragAt('dragOver', columns()[2]!, transfer);
    expect(columns()[2]!.dataset.drop).toBe('add');
    fireEvent.dragEnd(shelfSnare(), { dataTransfer: transfer });
    expect(columns()[2]!.dataset.drop).toBeUndefined();
    // A new drag starts with no mark from the last one.
    fireEvent.dragStart(shelfSnare(), { dataTransfer: transfer });
    expect(columns()[2]!.dataset.drop).toBeUndefined();
    fireEvent.dragEnd(shelfSnare(), { dataTransfer: transfer });
  });

  it('dragging from another pad copies, also on its own matrix', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    const fromPad = p.pads[m.pads[0]!]!.members[0]!;
    drag(hitsIn(columns()[0]!)[0]!, columns()[3]!);
    const after = present(store);
    expect(after.pads[m.pads[0]!]!.members).toEqual([fromPad]);
    const copy = after.hits[after.pads[m.pads[3]!]!.members[1]!]!;
    expect(copy.id).not.toBe(fromPad);
    expect(copy.slice).toBe(p.hits[fromPad]!.slice);
  });

  it('drag near the edge scrolls the timeline and the shelf', async () => {
    await setupTaking(amenAndSnares());
    const box = timeline();
    place(box, { left: 0, width: 400, top: 0, height: 200 });
    const transfer = dataTransfer();
    fireEvent.dragStart(shelfSnare(), { dataTransfer: transfer });
    dragAt('dragOver', columns()[0]!, transfer, { clientX: 398, clientY: 50 });
    expect(box.scrollLeft).toBeGreaterThan(0);
    const right = box.scrollLeft;
    dragAt('dragOver', columns()[0]!, transfer, { clientX: 200, clientY: 50 });
    expect(box.scrollLeft).toBe(right);
    dragAt('dragOver', columns()[0]!, transfer, { clientX: 2, clientY: 50 });
    expect(box.scrollLeft).toBeLessThan(right);

    place(shelf(), { left: 0, width: 400, top: 300, height: 120 });
    dragAt('dragOver', shelfSnare(), transfer, { clientX: 200, clientY: 418 });
    expect(shelf().scrollTop).toBeGreaterThan(0);
    fireEvent.dragEnd(shelfSnare(), { dataTransfer: transfer });
  });
});

/** A tap with a finger: the pointer down says it is touch, then the click. */
const tap = (element: HTMLElement) => {
  fireEvent.pointerDown(element, { pointerType: 'touch' });
  fireEvent.click(element);
};

describe('Pads: tap to place', () => {
  it('a mouse click on a shelf hit plays it without picking it', async () => {
    const { player } = await setupTaking(amenAndSnares());
    fireEvent.pointerDown(shelfSnare(), { pointerType: 'mouse' });
    fireEvent.click(shelfSnare());
    expect(player.playHit).toHaveBeenCalledTimes(1);
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('false');
    // Nor does Enter on it, which clicks with no pointer.
    fireEvent.click(shelfSnare());
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('status', { name: 'Picked' })).toBeNull();
  });

  it('Escape in a dialog is the dialog’s: the pick stays', async () => {
    const p = amenAndSnares();
    await setupTaking(p);
    fireEvent.click(hitsIn(columns()[1]!)[1]!);
    tap(shelfSnare());
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('true');
  });

  it('tap a hit then a pad adds it', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const { store, player } = await setupTaking(p);
    tap(shelfSnare());
    // A click plays it, and picks it.
    expect(player.playHit).toHaveBeenCalledTimes(1);
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status', { name: 'Picked' }).textContent).toMatch(/snare_01/);
    fireEvent.click(within(timeline()).getByRole('button', { name: 'Pad amen 1 03' }));
    expect(present(store).pads[m.pads[2]!]!.members).toHaveLength(2);
    // Placed once: the pick is gone, and the next tap on a pad selects it.
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('status', { name: 'Picked' })).toBeNull();
    fireEvent.click(within(timeline()).getByRole('button', { name: 'Pad amen 1 03' }));
    expect(store.getState().selection.pad).toBe(m.pads[2]);
    expect(present(store).pads[m.pads[2]!]!.members).toHaveLength(2);
  });

  it('tap a hit then a hit replaces it; all hits then a pad adds them all', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setupTaking(p);
    tap(shelfSnare());
    fireEvent.click(hitsIn(columns()[1]!)[0]!);
    expect(present(store).hits[present(store).pads[m.pads[1]!]!.members[0]!]!.name).toMatch(/^snare_01/);
    tap(within(shelf()).getByRole('button', { name: 'All hits of Snares' }));
    fireEvent.click(columns()[3]!);
    expect(present(store).pads[m.pads[3]!]!.members).toHaveLength(3);
  });

  it('Escape, a new tap on the picked hit, or a tap elsewhere cancels', async () => {
    const p = amenAndSnares();
    const { store } = await setupTaking(p);
    const before = present(store);
    tap(shelfSnare());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('false');
    tap(shelfSnare());
    tap(shelfSnare());
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('false');
    tap(shelfSnare());
    fireEvent.click(screen.getByRole('region', { name: 'Matrix' }));
    expect(shelfSnare().getAttribute('aria-pressed')).toBe('false');
    expect(present(store)).toBe(before);
  });
});

describe('Pads: keys', () => {
  it('arrow keys move the selection and play', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store, player } = await setup(p, m.id);
    const pad2 = p.pads[m.pads[1]!]!;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(store.getState().selection).toMatchObject({ pad: m.pads[0], hit: null });
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), p.pads[m.pads[0]!]!.members[0]);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(store.getState().selection).toMatchObject({ pad: pad2.id, hit: pad2.members[1] });
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), pad2.members[1]);
    expect(player.playHit).toHaveBeenCalledTimes(4);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(store.getState().selection).toMatchObject({ pad: pad2.id, hit: pad2.members[0] });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(store.getState().selection).toMatchObject({ pad: m.pads[0], hit: null });
    // At an end nothing changes or plays.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(player.playHit).toHaveBeenCalledTimes(6);
    // Enter selects the matrix.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Matrix controls' })).toBeTruthy();
  });

  it('a step onto a pad plays it as it picks', async () => {
    const p = amen(setPadChoiceCmd());
    const m = matrixNamed(p, 'amen 1');
    const { player } = await setup(p, m.id);
    const pad2 = p.pads[m.pads[1]!]!;
    expect(pad2.choice).toBe('roundRobin');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), pad2.members[0]);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    // Round robin: the next hit this time.
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), pad2.members[1]);
  });

  it('keys stay out of fields and sliders', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.keyDown(screen.getByLabelText('Matrix name'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getAllByRole('slider')[0]!, { key: 'ArrowRight' });
    expect(store.getState().selection.pad).toBeNull();
  });

  it('Delete asks as the Delete button does', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    const hit = p.hits[p.pads[m.pads[1]!]!.members[1]!]!;
    fireEvent.click(hitsIn(columns()[1]!)[1]!);
    fireEvent.keyDown(window, { key: 'Delete' });
    const dialog = screen.getByRole('alertdialog', { name: `Delete ${hit.name}?` });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(present(store).hits[hit.id]).toBeUndefined();
    // The pad, then the matrix, ask the same.
    fireEvent.click(within(timeline()).getByRole('button', { name: 'Pad amen 1 03' }));
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete amen 1 03?' })).getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(screen.getByRole('alertdialog', { name: 'Delete amen 1?' })).toBeTruthy();
  });
});

describe('Pads: Play while the focus changes', () => {
  it('a new matrix in focus plays whole, and what was held goes', async () => {
    const p = apply(amen(), addSample({ name: 'kick.wav', audio: constantAudio(0.1) }));
    const m = matrixNamed(p, 'amen 1');
    const { store, services: s } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[1]!, hit: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(s.renderPreview).toHaveBeenCalledTimes(1);
    const kick = Object.values(p.matrices).find((x) => x.name !== 'amen 1')!;
    fireEvent.change(screen.getByRole('combobox', { name: 'Matrix in focus' }), { target: { value: kick.id } });
    await settle();
    // Back on amen 1: the matrix plays, not the pad held from before.
    fireEvent.change(screen.getByRole('combobox', { name: 'Matrix in focus' }), { target: { value: m.id } });
    await settle();
    expect(s.renderPreview).toHaveBeenCalledTimes(1);
    expect(s.renderSong).toHaveBeenCalled();
    expect(store.getState().selection.pad).toBe(m.pads[1]);
  });
});

/** Pad 02 of amen 1 on Round robin. */
function setPadChoiceCmd(): Command {
  return (project, c) => {
    const m = Object.values(project.matrices).find((x) => x.name === 'amen 1')!;
    return setPadChoice(m.pads[1]!, 'roundRobin')(project, c);
  };
}
