// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, copyHits, createMatrix, setPadChoice, createProject, setSlicing } from '../model';
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

/** amen 1 and Snares, a matrix of two one-shots in one pad. */
function amenAndSnares(): Project {
  const p = apply(amen(), addSample({ name: 'snare_01.wav', audio: constantAudio(0.1) }), addSample({ name: 'snare_02.wav', audio: constantAudio(0.1) }), createMatrix('Snares'));
  const oneShots = Object.values(p.hits).filter((h) => h.name.startsWith('snare_')).map((h) => h.id);
  return apply(p, copyHits(oneShots, matrixNamed(p, 'Snares').pads[0]!));
}

/** Pad 02 of amen 1 on Round robin. */
function roundRobin(): Command {
  return (project, c) => setPadChoice(matrixNamed(project, 'amen 1').pads[1]!, 'roundRobin')(project, c);
}

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

/** Matrices with `shown` shown and nothing pinned. */
async function setup(project: Project, shown: string | null, patch: Partial<AppState> = {}, rng?: () => () => number) {
  const fake = services();
  if (rng !== undefined) Object.assign(fake.services, { rng });
  const store: Store = createStore({ ...initialState(project), view: 'pads', focus: { matrix: null, takeFrom: [], shown }, ...patch });
  render(<App store={store} services={fake.services} />);
  await settle();
  return { store, ...fake };
}

const present = (store: Store) => store.getState().history.present;
const list = () => screen.getByRole('region', { name: 'Matrices' });
const grid = () => screen.getByRole('region', { name: 'Pads of the matrix' });
const tiles = () => Array.from(grid().querySelectorAll<HTMLElement>('.pad-tile:not(.new-pad)'));
const newPadTile = () => grid().querySelector<HTMLElement>('.new-pad')!;
/** The hit chips of a pad's tile, top down. */
const hitsIn = (tile: HTMLElement) => Array.from(tile.querySelectorAll<HTMLButtonElement>('.pad-hits button'));
const crumbs = () => screen.getByRole('navigation', { name: 'Where you are' });

/** A browser's drag at the event level: the data set on drag start comes back on drop. */
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
type At = { clientX?: number; clientY?: number; shiftKey?: boolean };
/** A dragover or drop at the pointer `at`, with Shift or not: happy-dom has no DragEvent, so its plain event gets them here. */
function dragAt(kind: 'dragOver' | 'drop', to: HTMLElement, transfer: Transfer, at: At = {}) {
  const event = createEvent[kind](to, { dataTransfer: transfer });
  for (const [key, value] of Object.entries(at)) Object.defineProperty(event, key, { value });
  fireEvent(to, event);
}
function drag(from: HTMLElement, to: HTMLElement, at: At = {}, check?: () => void) {
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

describe('Matrices: the list (Magnus beslut)', () => {
  it('lists the matrices as a tree: the one shown unfolded with its pads, the others folded with how many pads', async () => {
    const p = amenAndSnares();
    await setup(p, matrixNamed(p, 'amen 1').id);
    const amenGroup = within(list()).getByRole('group', { name: 'amen 1' });
    expect(within(amenGroup).getByRole('button', { name: 'Pad amen 1 01' })).toBeTruthy();
    expect(within(amenGroup).getAllByRole('button', { name: /^Pad amen 1/ })).toHaveLength(4);
    const snares = within(list()).getByRole('group', { name: 'Snares' });
    expect(within(snares).queryByRole('button', { name: /^Pad Snares/ })).toBeNull();
    expect(snares.textContent).toContain('1 pad');
    // Several can be open at once.
    fireEvent.click(within(snares).getByRole('button', { name: 'Show the pads of Snares' }));
    expect(within(snares).getByRole('button', { name: 'Pad Snares 01' })).toBeTruthy();
    expect(within(amenGroup).getByRole('button', { name: 'Pad amen 1 01' })).toBeTruthy();
    fireEvent.click(within(list()).getByRole('button', { name: 'Collapse all' }));
    expect(within(list()).queryByRole('button', { name: /^Pad / })).toBeNull();
    fireEvent.click(within(list()).getByRole('button', { name: 'Expand all' }));
    // amen 1's four, Snares' one, and the one of each snare sample's own matrix.
    expect(within(list()).getAllByRole('button', { name: /^Pad / })).toHaveLength(7);
  });

  it('no Focus, no Take from, no + New matrix and no Play matrix: the list replaces them, and the page has no heading', async () => {
    const p = amenAndSnares();
    await setup(p, matrixNamed(p, 'amen 1').id);
    expect(screen.queryByRole('combobox', { name: 'Matrix in focus' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Take from' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ New matrix' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Play matrix/ })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('a click on a matrix shows it, with the matrix selected; the view shows the matrix whose row was clicked last', async () => {
    const p = amenAndSnares();
    const snares = matrixNamed(p, 'Snares');
    const { store } = await setup(p, matrixNamed(p, 'amen 1').id);
    fireEvent.click(within(list()).getByRole('button', { name: 'Matrix Snares' }));
    expect(store.getState().focus.shown).toBe(snares.id);
    expect(screen.getByRole('region', { name: 'Matrix controls' })).toBeTruthy();
    expect(tiles()).toHaveLength(1);
    // It unfolds too.
    expect(within(list()).getByRole('button', { name: 'Pad Snares 01' })).toBeTruthy();
  });

  it('a click on a pad selects and plays it; on a hit, the hit; the view follows its matrix', async () => {
    const p = amenAndSnares();
    const snares = matrixNamed(p, 'Snares');
    const snarePad = p.pads[snares.pads[0]!]!;
    const { store, player } = await setup(p, matrixNamed(p, 'amen 1').id);
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the pads of Snares' }));
    fireEvent.click(within(list()).getByRole('button', { name: 'Pad Snares 01' }));
    expect(store.getState().focus.shown).toBe(snares.id);
    expect(store.getState().selection).toMatchObject({ pad: snarePad.id, hit: null });
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), snarePad.members[0]);
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the hits of Snares 01' }));
    fireEvent.click(within(list()).getByRole('button', { name: /^Hit 2 / }));
    expect(store.getState().selection).toMatchObject({ pad: snarePad.id, hit: snarePad.members[1] });
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), snarePad.members[1]);
    expect(screen.getByRole('region', { name: 'Hit controls' })).toBeTruthy();
  });

  it('a pad with more than one hit folds its hits under ▸; a pad with one hit has no fold', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    await setup(p, m.id);
    const pad2 = within(list()).getByRole('button', { name: 'Pad amen 1 02' });
    expect(pad2.textContent).toContain('2 hits');
    expect(within(list()).queryByRole('button', { name: /^Hit 1 / })).toBeNull();
    expect(within(list()).queryByRole('button', { name: 'Show the hits of amen 1 01' })).toBeNull();
    expect(within(list()).getByRole('button', { name: 'Pad amen 1 01' }).textContent).toContain('1 hit · 01');
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the hits of amen 1 02' }));
    expect(within(list()).getAllByRole('button', { name: /^Hit \d / })).toHaveLength(2);
    fireEvent.click(within(list()).getByRole('button', { name: 'Hide the hits of amen 1 02' }));
    expect(within(list()).queryByRole('button', { name: /^Hit \d / })).toBeNull();
  });

  it('a matrix row dragged onto another goes before it, in one undo step', async () => {
    const p = apply(amenAndSnares(), createMatrix('Kit'));
    const { store } = await setup(p, matrixNamed(p, 'amen 1').id);
    const names = () => Object.values(present(store).matrices).map((m) => m.name);
    expect(names()).toEqual(['amen 1', 'snare_01 1', 'snare_02 1', 'Snares', 'Kit']);
    const row = (name: string) => within(list()).getByRole('group', { name }).querySelector<HTMLElement>('.matrix-tree-row')!;
    drag(row('Kit'), row('amen 1'), {}, () => expect(row('amen 1').className).toContain('drop-before'));
    expect(names()).toEqual(['Kit', 'amen 1', 'snare_01 1', 'snare_02 1', 'Snares']);
    expect(row('amen 1').className).not.toContain('drop-before');
    act(() => void store.dispatch({ type: 'undo' }));
    expect(names()).toEqual(['amen 1', 'snare_01 1', 'snare_02 1', 'Snares', 'Kit']);
    // A matrix row does not drop on the grid.
    const before = present(store);
    drag(row('Snares'), tiles()[0]!);
    expect(present(store)).toBe(before);
  });
});

describe('Matrices: the matrix box', () => {
  it('shows the pads in a grid that wraps downward, with each hit under its pad; Fit 8 a row, 1 bar 4', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    await setup(p, m.id);
    expect(tiles().map((t) => t.dataset.pad)).toEqual(m.pads);
    expect(hitsIn(tiles()[1]!)).toHaveLength(2);
    expect(hitsIn(tiles()[1]!)[0]!.textContent).toMatch(/^1\s*02/);
    expect(grid().style.gridTemplateColumns).toBe('repeat(8, minmax(0, 1fr))');
    fireEvent.click(screen.getByRole('button', { name: '1 bar' }));
    expect(grid().style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    // Its header: the kind, Rename, + Pad, Clone, Delete, its size and the zoom.
    const box = screen.getByRole('region', { name: 'Matrix' });
    expect(box.textContent).toContain('break');
    expect(box.textContent).toContain('4 pads · 16 steps');
  });

  it('a click in the box off a pad, a hit or a control selects the matrix; a control does not', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[1]!, hit: null } });
    expect(screen.getByRole('region', { name: 'Pad controls' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1 bar' }));
    expect(store.getState().selection.pad).toBe(m.pads[1]);
    fireEvent.click(grid());
    expect(store.getState().selection).toMatchObject({ matrix: m.id, pad: null, hit: null });
    expect(screen.getByRole('region', { name: 'Matrix controls' })).toBeTruthy();
    expect(within(crumbs()).getByText('amen 1')).toBeTruthy();
    expect(crumbs().textContent).not.toContain('pad 02');
  });

  it('Rename turns into a field in place: Enter saves, Esc cancels, and an empty name changes nothing', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: 'Rename amen 1' }));
    const field = screen.getByRole('textbox', { name: 'Matrix name' });
    fireEvent.change(field, { target: { value: 'Breakbeat' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(present(store).matrices[m.id]!.name).toBe('amen 1');
    fireEvent.click(screen.getByRole('button', { name: 'Rename amen 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Matrix name' }), { target: { value: ' ' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Matrix name' }), { key: 'Enter' });
    expect(present(store).matrices[m.id]!.name).toBe('amen 1');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename amen 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Matrix name' }), { target: { value: 'Breakbeat' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Matrix name' }), { key: 'Enter' });
    expect(present(store).matrices[m.id]!.name).toBe('Breakbeat');
    expect(screen.queryByRole('textbox', { name: 'Matrix name' })).toBeNull();
  });

  it('+ Pad adds an empty pad and selects it; Clone shows the copy; Delete asks first', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: '+ Pad' }));
    const added = present(store).matrices[m.id]!.pads.at(-1)!;
    expect(store.getState().selection.pad).toBe(added);
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    const clone = matrixNamed(present(store), 'amen 1 copy');
    expect(store.getState().focus.shown).toBe(clone.id);
    expect(within(list()).getByRole('button', { name: 'Matrix amen 1 copy' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete matrix amen 1 copy' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete amen 1 copy?' })).getByRole('button', { name: 'Delete' }));
    expect(present(store).matrices[clone.id]).toBeUndefined();
  });
});

describe('Matrices: drag and drop (Magnus beslut)', () => {
  it('a pad dragged from the list onto a pad adds copies of its hits last; the target says Copy', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const snarePad = p.pads[matrixNamed(p, 'Snares').pads[0]!]!;
    const { store } = await setup(p, m.id);
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the pads of Snares' }));
    const tile = tiles()[2]!;
    drag(within(list()).getByRole('button', { name: 'Pad Snares 01' }), tile, {}, () => expect(tile.dataset.drop).toBe('Copy'));
    expect(tile.dataset.drop).toBeUndefined();
    const pad = present(store).pads[m.pads[2]!]!;
    expect(pad.members).toHaveLength(3);
    expect(pad.members.slice(1).map((h) => present(store).hits[h]!.name)).toEqual(snarePad.members.map((h) => p.hits[h]!.name));
    // The originals stay; a pad on Top with more than one hit turns Round robin, in one undo step.
    expect(present(store).pads[snarePad.id]!.members).toEqual(snarePad.members);
    expect(pad.choice).toBe('roundRobin');
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().selection.pad).toBe(m.pads[2]);
  });

  it('a hit dragged from the list onto a hit of a pad is added to that pad as a copy', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const snarePad = p.pads[matrixNamed(p, 'Snares').pads[0]!]!;
    const { store } = await setup(p, m.id);
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the pads of Snares' }));
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the hits of Snares 01' }));
    drag(within(list()).getByRole('button', { name: /^Hit 2 / }), hitsIn(tiles()[0]!)[0]!);
    const pad = present(store).pads[m.pads[0]!]!;
    expect(pad.members).toHaveLength(2);
    expect(present(store).hits[pad.members[1]!]!.name).toBe(p.hits[snarePad.members[1]!]!.name);
    expect(pad.members[1]).not.toBe(snarePad.members[1]);
  });

  it('a hit dragged in the grid to another pad is always copied, Shift or not; the target says Copy', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    const [first, second] = p.pads[m.pads[1]!]!.members as [string, string];
    drag(hitsIn(tiles()[1]!)[1]!, tiles()[0]!, {}, () => expect(tiles()[0]!.dataset.drop).toBe('Copy'));
    drag(hitsIn(tiles()[1]!)[1]!, tiles()[3]!, { shiftKey: true }, () => expect(tiles()[3]!.dataset.drop).toBe('Copy'));
    expect(present(store).pads[m.pads[1]!]!.members).toEqual([first, second]);
    expect(present(store).pads[m.pads[0]!]!.members).toHaveLength(2);
    expect(present(store).pads[m.pads[3]!]!.members).toHaveLength(2);
    expect(store.getState().selection).toMatchObject({ pad: m.pads[3], hit: null });
  });

  it('within its pad a hit dragged up or down reorders, always as a move, with a line where it goes', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    const [first, second] = p.pads[m.pads[1]!]!.members as [string, string];
    const [top, bottom] = hitsIn(tiles()[1]!) as [HTMLButtonElement, HTMLButtonElement];
    place(top, { top: 100, height: 30 });
    drag(bottom, top, { clientY: 105 }, () => {
      expect(top.closest('li')!.className).toContain('insert-before');
      expect(tiles()[1]!.dataset.drop).toBeUndefined();
    });
    expect(present(store).pads[m.pads[1]!]!.members).toEqual([second, first]);
    expect(store.getState().history.past).toHaveLength(1);
    const [nowTop, nowBottom] = hitsIn(tiles()[1]!) as [HTMLButtonElement, HTMLButtonElement];
    place(nowBottom, { top: 130, height: 30 });
    drag(nowTop, nowBottom, { clientY: 158 });
    expect(present(store).pads[m.pads[1]!]!.members).toEqual([first, second]);
  });

  it('dropped on the place after the pads it makes a new pad with copies', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the pads of Snares' }));
    drag(within(list()).getByRole('button', { name: 'Pad Snares 01' }), newPadTile(), {}, () => expect(newPadTile().textContent).toBe('Copy: a new pad'));
    const pads = present(store).matrices[m.id]!.pads;
    expect(pads).toHaveLength(5);
    expect(present(store).pads[pads[4]!]!.members).toHaveLength(2);
    expect(store.getState().selection.pad).toBe(pads[4]);
    drag(hitsIn(tiles()[1]!)[1]!, newPadTile(), { shiftKey: true });
    expect(present(store).matrices[m.id]!.pads).toHaveLength(6);
    expect(present(store).pads[m.pads[1]!]!.members).toHaveLength(2);
  });

  /** Lays the grid out as `perRow` tiles of 100 px a row, with 6 px gaps, which happy-dom does not. */
  const layOut = (perRow: number) =>
    tiles().forEach((t, i) => place(t, { left: (i % perRow) * 106, top: Math.floor(i / perRow) * 106, width: 100, height: 100 }));
  const head = (i: number) => tiles()[i]!.querySelector<HTMLElement>('.pad-head')!;

  it('a pad dragged by its number beside another moves there, with its hits, and a line shows where; at the end of a row too', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    layOut(2);
    const hits = (id: string) => present(store).pads[id]!.members;
    const before = m.pads.map(hits);
    // The right quarter of pad 01, the end of the first row: pad 04 lands after it.
    drag(head(3), tiles()[0]!, { clientX: 90, clientY: 50 }, () => {
      const line = tiles()[0]!.querySelector('.pad-insert.after');
      expect(line?.textContent).toBe('Move pad here');
      expect(tiles()[0]!.dataset.drop).toBeUndefined();
    });
    expect(present(store).matrices[m.id]!.pads).toEqual([m.pads[0], m.pads[3], m.pads[1], m.pads[2]]);
    expect([0, 3, 1, 2].map((i) => hits(m.pads[i]!))).toEqual([0, 3, 1, 2].map((i) => before[i]));
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().selection.pad).toBe(m.pads[3]);
    // The gap at the start of the second row (left of the pad there): pad 01 goes before it.
    layOut(2);
    drag(head(0), screen.getByRole('region', { name: 'Pads of the matrix' }), { clientX: 2, clientY: 150 });
    expect(present(store).matrices[m.id]!.pads).toEqual([m.pads[3], m.pads[0], m.pads[1], m.pads[2]]);
  });

  it('a pad dropped on the middle of another copies its hits last into it; on itself nothing', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    layOut(4);
    drag(head(0), tiles()[0]!, { clientX: 50, clientY: 50 }, () => expect(tiles()[0]!.dataset.drop).toBeUndefined());
    expect(store.getState().history.past).toHaveLength(0);
    drag(head(1), tiles()[2]!, { clientX: 262, clientY: 50 }, () => expect(tiles()[2]!.dataset.drop).toBe('Copy 2 hits into 03'));
    expect(present(store).pads[m.pads[2]!]!.members).toHaveLength(3);
    expect(present(store).pads[m.pads[1]!]!.members).toEqual(p.pads[m.pads[1]!]!.members);
    expect(present(store).matrices[m.id]!.pads).toEqual(m.pads);
    // On the new pad's place: a copy of it, last.
    drag(head(1), newPadTile());
    const pads = present(store).matrices[m.id]!.pads;
    expect(pads).toHaveLength(5);
    expect(present(store).pads[pads[4]!]!.members).toHaveLength(2);
  });

  it('a drag that ends without a drop leaves no mark', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    await setup(p, m.id);
    const transfer = dataTransfer();
    const chip = hitsIn(tiles()[1]!)[1]!;
    fireEvent.dragStart(chip, { dataTransfer: transfer });
    dragAt('dragOver', tiles()[2]!, transfer);
    expect(tiles()[2]!.dataset.drop).toBe('Copy');
    fireEvent.dragEnd(chip, { dataTransfer: transfer });
    expect(tiles()[2]!.dataset.drop).toBeUndefined();
    expect(newPadTile().textContent).toBe('+ drop here for a new pad');
  });

  it('a drag near the top or bottom of the window scrolls the page', async () => {
    const p = amen();
    await setup(p, matrixNamed(p, 'amen 1').id);
    place(document.querySelector<HTMLElement>('.header')!, { top: 0, width: 1000, height: 70 });
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const transfer = dataTransfer();
    const chip = hitsIn(tiles()[0]!)[0]!;
    fireEvent.dragStart(chip, { dataTransfer: transfer });
    dragAt('dragOver', grid(), transfer, { clientY: 72 });
    expect((scrollBy.mock.lastCall![0] as ScrollToOptions).top).toBeLessThan(0);
    dragAt('dragOver', grid(), transfer, { clientY: window.innerHeight - 2 });
    expect((scrollBy.mock.lastCall![0] as ScrollToOptions).top).toBeGreaterThan(0);
    fireEvent.dragEnd(chip, { dataTransfer: transfer });
  });
});

describe('Matrices: the controls under the box', () => {
  it('a pad: Rename, ←, →, Delete, Pad plays and how many hits on one row, and its sound always shown', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[1]!, hit: null } });
    const panel = screen.getByRole('region', { name: 'Pad controls' });
    const head = panel.querySelector<HTMLElement>('.box-head')!;
    for (const name of ['Rename amen 1 02', 'Move amen 1 02 left', 'Move amen 1 02 right', 'Delete pad amen 1 02', 'Round robin']) expect(within(head).getByRole('button', { name })).toBeTruthy();
    expect(head.textContent).toContain('2 hits');
    fireEvent.click(within(head).getByRole('button', { name: 'Random' }));
    expect(present(store).pads[m.pads[1]!]!.choice).toBe('random');
    // Pad sound is there without unfolding anything; no list of hits, no + Hit.
    expect(within(panel).getByRole('group', { name: 'Pad sound' })).toBeTruthy();
    expect(within(panel).getAllByRole('slider').length).toBeGreaterThan(0);
    expect(screen.queryByRole('list', { name: 'Hits in this pad' })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search hits' })).toBeNull();
    expect(screen.queryByText(/▸ Pad sound/)).toBeNull();
    fireEvent.click(within(head).getByRole('button', { name: 'Move amen 1 02 right' }));
    expect(present(store).matrices[m.id]!.pads[2]).toBe(m.pads[1]);
  });

  it('a hit: Rename, Replace…, Variant and Delete on one row, what it plays, and its sound always shown', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const hit = p.pads[m.pads[1]!]!.members[0]!;
    const { store } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[1]!, hit } });
    const panel = screen.getByRole('region', { name: 'Hit controls' });
    expect(panel.textContent).toContain('plays slice 02 of amen sample 1');
    expect(within(panel).getByRole('group', { name: 'Hit sound' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: `Rename ${p.hits[hit]!.name}` }));
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Hit name' }), { target: { value: 'ghost' } });
    fireEvent.keyDown(within(panel).getByRole('textbox', { name: 'Hit name' }), { key: 'Enter' });
    expect(present(store).hits[hit]!.name).toBe('ghost');
    // The link row says what is selected: the matrix, then the pad and the hit.
    expect(crumbs().textContent).toContain('amen 1');
    expect(crumbs().textContent).toContain('pad 02 · hit 1');
  });

  it('the matrix: its sound, laid over every pad', async () => {
    const p = amen();
    await setup(p, matrixNamed(p, 'amen 1').id);
    expect(within(screen.getByRole('region', { name: 'Matrix controls' })).getByRole('group', { name: 'Matrix sound' })).toBeTruthy();
  });

  it('only the controls that act now: Cutoff and Resonance with a filter type', async () => {
    const p = amen();
    await setup(p, matrixNamed(p, 'amen 1').id);
    const filter = screen.getByRole('group', { name: 'Filter' });
    expect(within(filter).queryByRole('slider', { name: /^Cutoff/ })).toBeNull();
    fireEvent.click(within(within(filter).getByRole('group', { name: 'Filter type' })).getByRole('button', { name: 'Low-pass' }));
    expect(within(screen.getByRole('group', { name: 'Filter' })).getByRole('slider', { name: /^Cutoff/ })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Filter' })).getByRole('slider', { name: /^Resonance/ })).toBeTruthy();
  });
});

describe('Matrices: Play', () => {
  it('the header’s Play and Space play the matrix shown in a loop, whatever is selected', async () => {
    const p = amen(roundRobin());
    const m = matrixNamed(p, 'amen 1');
    const { store, player, services: s } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(s.renderSong).toHaveBeenCalled();
    // Pad 02 has two hits on Round robin: two passes, so both are heard.
    expect(vi.mocked(s.renderSong).mock.lastCall![0].song.bars).toBe(2);
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    act(() => void store.dispatch({ type: 'select', selection: { pad: m.pads[1]!, hit: p.pads[m.pads[1]!]!.members[1]! } }));
    await settle();
    fireEvent.keyDown(window, { key: ' ' });
    expect(player.play).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    expect(s.renderPreview).not.toHaveBeenCalled();
  });

  it('a click on a pad’s number plays it one pick: Round robin on per click, Random from the rng', async () => {
    const p = amen(roundRobin());
    const m = matrixNamed(p, 'amen 1');
    const { store, player } = await setup(p, m.id, {}, () => () => 0.9);
    const [first, second] = p.pads[m.pads[1]!]!.members as [string, string];
    const padHead = () => within(grid()).getByRole('button', { name: 'Pad amen 1 02' });
    const played = () => player.playHit.mock.calls.map((c) => c[1]);
    fireEvent.click(padHead());
    fireEvent.click(padHead());
    fireEvent.click(padHead());
    expect(played()).toEqual([first, second, first]);
    act(() => void store.dispatch({ type: 'run', command: setPadChoice(m.pads[1]!, 'random') }));
    fireEvent.click(padHead());
    expect(played().at(-1)).toBe(second);
  });

  it('while it plays, a click on a hit auditions it once on top', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { player } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(hitsIn(tiles()[1]!)[1]!);
    await settle();
    expect(player.playHit).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Hit controls' })).toBeTruthy();
  });

  it('another matrix shown plays whole, straight away', async () => {
    const p = apply(amen(), addSample({ name: 'kick.wav', audio: constantAudio(0.1) }));
    const m = matrixNamed(p, 'amen 1');
    const { player, services: s } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.play).toHaveBeenCalledTimes(1);
    fireEvent.click(within(list()).getByRole('button', { name: 'Matrix kick 1' }));
    await settle();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(vi.mocked(s.renderSong).mock.lastCall![0].song.clips).toHaveLength(1);
  });
});

describe('Matrices: keys', () => {
  it('arrow keys move the selection and play; Enter selects the matrix', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store, player } = await setup(p, m.id);
    const pad2 = p.pads[m.pads[1]!]!;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(store.getState().selection).toMatchObject({ pad: m.pads[0], hit: null });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(store.getState().selection).toMatchObject({ pad: pad2.id, hit: pad2.members[1] });
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), pad2.members[1]);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Matrix controls' })).toBeTruthy();
  });

  it('keys step from the focused pad or hit, and focus follows the selection (roving tabindex)', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[0]!, hit: null } });
    const tabbable = () => Array.from(grid().querySelectorAll<HTMLElement>('.pad-head, .hit-chip')).filter((b) => b.tabIndex === 0);
    expect(tabbable()).toEqual([within(grid()).getByRole('button', { name: 'Pad amen 1 01' })]);
    const pad3 = within(grid()).getByRole('button', { name: 'Pad amen 1 03' });
    pad3.focus();
    fireEvent.keyDown(pad3, { key: 'ArrowRight' });
    expect(store.getState().selection).toMatchObject({ pad: m.pads[3], hit: null });
    await act(async () => {});
    expect(document.activeElement).toBe(within(grid()).getByRole('button', { name: 'Pad amen 1 04' }));
  });

  it('keys stay out of fields and sliders', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    fireEvent.click(screen.getByRole('button', { name: 'Rename amen 1' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Matrix name' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getAllByRole('slider')[0]!, { key: 'ArrowRight' });
    expect(store.getState().selection.pad).toBeNull();
  });

  it('Delete asks as the Delete button does', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    const hit = p.hits[p.pads[m.pads[1]!]!.members[1]!]!;
    fireEvent.click(hitsIn(tiles()[1]!)[1]!);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.click(within(screen.getByRole('alertdialog', { name: `Delete ${hit.name}?` })).getByRole('button', { name: 'Delete' }));
    expect(present(store).hits[hit.id]).toBeUndefined();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(screen.getByRole('alertdialog', { name: 'Delete amen 1?' })).toBeTruthy();
  });
});

describe('Matrices: no matrices', () => {
  it('without matrices links to Samples', async () => {
    const { store } = await setup(createProject(), null);
    fireEvent.click(screen.getByRole('button', { name: '← Samples' }));
    expect(store.getState().view).toBe('samples');
  });

  it('with none shown, the first matrix is', async () => {
    const p = amenAndSnares();
    const { store } = await setup(p, null);
    expect(store.getState().focus.shown).toBe(matrixNamed(p, 'amen 1').id);
    expect(tiles()).toHaveLength(4);
  });
});

describe('Matrices: the pin (Magnus beslut)', () => {
  it('every matrix row has a pin; one at a time: another moves it, the pinned one unpins', async () => {
    const p = amenAndSnares();
    const amenId = matrixNamed(p, 'amen 1').id;
    const snaresId = matrixNamed(p, 'Snares').id;
    const { store } = await setup(p, amenId);
    expect(within(list()).getAllByRole('button', { name: /^Pin / })).toHaveLength(Object.keys(p.matrices).length);
    expect(within(list()).getByRole('button', { name: 'Pin amen 1' }).title).toBe('Pin: keep this matrix in view; clicks elsewhere only play');
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin amen 1' }));
    expect(store.getState().focus.matrix).toBe(amenId);
    expect(within(list()).getByRole('button', { name: 'Unpin amen 1' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Snares' }));
    expect(store.getState().focus.matrix).toBe(snaresId);
    expect(tiles()).toHaveLength(1);
    expect(within(list()).getByRole('button', { name: 'Pin amen 1' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(list()).getByRole('button', { name: 'Unpin Snares' }));
    expect(store.getState().focus.matrix).toBeNull();
    // Unpinned, the view stays where it was.
    expect(tiles()).toHaveLength(1);
  });

  it('pinned, a click on another matrix’s pad or hit only plays it, and its row only folds; dragging from it still copies', async () => {
    const p = amenAndSnares();
    const m = matrixNamed(p, 'amen 1');
    const snarePad = p.pads[matrixNamed(p, 'Snares').pads[0]!]!;
    const { store, player } = await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[1]!, hit: null } });
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin amen 1' }));
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the pads of Snares' }));
    fireEvent.click(within(list()).getByRole('button', { name: 'Pad Snares 01' }));
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), snarePad.members[0]);
    expect(matrixShown(store)).toBe(m.id);
    expect(store.getState().selection.pad).toBe(m.pads[1]);
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the hits of Snares 01' }));
    fireEvent.click(within(list()).getByRole('button', { name: /^Hit 2 / }));
    expect(player.playHit).toHaveBeenLastCalledWith(expect.anything(), snarePad.members[1]);
    expect(store.getState().selection.pad).toBe(m.pads[1]);
    fireEvent.click(within(list()).getByRole('button', { name: 'Matrix Snares' }));
    expect(matrixShown(store)).toBe(m.id);
    expect(within(list()).queryByRole('button', { name: 'Pad Snares 01' })).toBeNull();
    fireEvent.click(within(list()).getByRole('button', { name: 'Show the pads of Snares' }));
    drag(within(list()).getByRole('button', { name: 'Pad Snares 01' }), tiles()[2]!);
    expect(present(store).pads[m.pads[2]!]!.members).toHaveLength(3);
    // Its own pads select as before.
    fireEvent.click(within(list()).getByRole('button', { name: 'Pad amen 1 04' }));
    expect(store.getState().selection.pad).toBe(m.pads[3]);
  });

  it('the pin is the matrix in focus in Loops, and is not undone', async () => {
    const p = amenAndSnares();
    const snaresId = matrixNamed(p, 'Snares').id;
    const { store } = await setup(p, matrixNamed(p, 'amen 1').id);
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Snares' }));
    act(() => void store.dispatch({ type: 'view', view: 'loops' }));
    await settle();
    expect((screen.getByRole('combobox', { name: 'Matrix in focus' }) as HTMLSelectElement).value).toBe(snaresId);
    fireEvent.change(screen.getByRole('combobox', { name: 'Matrix in focus' }), { target: { value: matrixNamed(p, 'amen 1').id } });
    act(() => void store.dispatch({ type: 'view', view: 'pads' }));
    await settle();
    expect(within(list()).getByRole('button', { name: 'Unpin amen 1' })).toBeTruthy();
    expect(store.getState().history.past).toHaveLength(0);
  });
});

describe('Matrices: yellow frames what is selected, and only that (Magnus beslut)', () => {
  const framed = () => Array.from(document.querySelectorAll('.pad-tile.current, .matrix-box.current, .hit-chip[aria-current="true"]')).map((e) => e.className.split(' ')[0]);

  it('a hit: only its chip; a pad: only its tile; the matrix: only the box', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    const { store } = await setup(p, m.id);
    expect(framed()).toEqual(['panel']);
    act(() => void store.dispatch({ type: 'select', selection: { pad: m.pads[1]!, hit: null } }));
    expect(framed()).toEqual(['pad-tile']);
    act(() => void store.dispatch({ type: 'select', selection: { pad: m.pads[1]!, hit: p.pads[m.pads[1]!]!.members[1]! } }));
    expect(framed()).toEqual(['hit-chip']);
  });

  it('the hit’s region is set on a slim waveform, as Trim’s overview', async () => {
    const p = amen();
    const m = matrixNamed(p, 'amen 1');
    await setup(p, m.id, { selection: { ...initialState(p).selection, pad: m.pads[1]!, hit: p.pads[m.pads[1]!]!.members[0]! } });
    const panel = screen.getByRole('region', { name: 'Hit controls' });
    const wave = panel.querySelector<HTMLElement>('.trim-wave.overview')!;
    expect(wave).toBeTruthy();
    expect(within(wave).getByRole('button', { name: /^Start at/ })).toBeTruthy();
  });
});

const matrixShown = (store: Store) => store.getState().focus.matrix ?? store.getState().focus.shown;
