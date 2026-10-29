import { describe, expect, it } from 'vitest';
import { createLoop, createMatrix, createMod, createProject, remove } from '../model';
import { createStore, initialState, loopPinned, matrixInView, songPinned } from './store';

/** A store whose project has two matrices; returns their ids. */
function twoMatrices() {
  const store = createStore(initialState(createProject()));
  store.dispatch({ type: 'run', command: createMatrix('Snares') });
  store.dispatch({ type: 'run', command: createMatrix('Kicks') });
  const [a, b] = Object.keys(store.getState().history.present.matrices);
  return { store, a: a!, b: b! };
}

describe('focus', () => {
  it('starts with no focus matrix and nothing unpinned in Loops', () => {
    expect(createStore().getState().focus).toEqual({ matrix: null, loopUnpins: [] });
  });

  it('is set and cleared by the focus action', () => {
    const { store, a } = twoMatrices();
    store.dispatch({ type: 'focus', matrix: a });
    expect(store.getState().focus.matrix).toBe(a);
    store.dispatch({ type: 'focus', matrix: null });
    expect(store.getState().focus.matrix).toBeNull();
  });

  it('on a removed matrix becomes none', () => {
    const { store, a } = twoMatrices();
    store.dispatch({ type: 'focus', matrix: a });
    store.dispatch({ type: 'run', command: remove('matrix', a) });
    expect(store.getState().focus.matrix).toBeNull();
    // Undoing the removal does not bring it back.
    store.dispatch({ type: 'undo' });
    expect(store.getState().focus.matrix).toBeNull();
  });

  it('on a matrix that an undo makes disappear becomes none', () => {
    const { store, b } = twoMatrices();
    store.dispatch({ type: 'focus', matrix: b });
    store.dispatch({ type: 'undo' });
    expect(store.getState().focus.matrix).toBeNull();
  });

  it('is cleared when another project is loaded', () => {
    const { store, a } = twoMatrices();
    store.dispatch({ type: 'focus', matrix: a });
    store.dispatch({ type: 'load', project: createProject() });
    expect(store.getState().focus).toEqual({ matrix: null, loopUnpins: [], shown: null, songUnpins: [] });
  });
});

describe('the pins in Loops (Magnus beslut: several, apart from the Matrices pin)', () => {
  it('pins every matrix from the start, also a new one (Magnus beslut 2026-10-22)', () => {
    const { store, a, b } = twoMatrices();
    expect(loopPinned(store.getState().focus, a)).toBe(true);
    expect(loopPinned(store.getState().focus, b)).toBe(true);
    store.dispatch({ type: 'run', command: createMatrix('Hats') });
    const c = Object.keys(store.getState().history.present.matrices).find((id) => id !== a && id !== b)!;
    expect(loopPinned(store.getState().focus, c)).toBe(true);
  });

  it('unpins and pins matrices again, each once', () => {
    const { store, a, b } = twoMatrices();
    store.dispatch({ type: 'loopPin', matrix: a, on: false });
    store.dispatch({ type: 'loopPin', matrix: a, on: false });
    store.dispatch({ type: 'loopPin', matrix: b, on: false });
    expect(store.getState().focus.loopUnpins).toEqual([a, b]);
    expect(loopPinned(store.getState().focus, a)).toBe(false);
    store.dispatch({ type: 'loopPin', matrix: a, on: true });
    expect(store.getState().focus.loopUnpins).toEqual([b]);
    expect(loopPinned(store.getState().focus, a)).toBe(true);
  });

  it('drops removed matrices', () => {
    const { store, a, b } = twoMatrices();
    store.dispatch({ type: 'loopPin', matrix: a, on: false });
    store.dispatch({ type: 'loopPin', matrix: b, on: false });
    store.dispatch({ type: 'run', command: remove('matrix', a) });
    expect(store.getState().focus.loopUnpins).toEqual([b]);
  });

  it('pins everything again after Load, since the pins are not saved', () => {
    const { store, a } = twoMatrices();
    store.dispatch({ type: 'loopPin', matrix: a, on: false });
    store.dispatch({ type: 'load', project: store.getState().history.present });
    expect(loopPinned(store.getState().focus, a)).toBe(true);
  });

  it('is view state: not in the undo history', () => {
    const { store, a } = twoMatrices();
    const before = store.getState().history;
    store.dispatch({ type: 'focus', matrix: a });
    store.dispatch({ type: 'loopPin', matrix: a, on: false });
    expect(store.getState().history).toBe(before);
  });
});

describe('the pin and the matrix shown (Magnus beslut)', () => {
  it('shows a matrix; a pin keeps the view and moves when a link shows another; unpinned, the view stays', () => {
    const { store, a, b } = twoMatrices();
    store.dispatch({ type: 'show', matrix: a });
    expect(store.getState().focus).toMatchObject({ matrix: null, shown: a });
    store.dispatch({ type: 'focus', matrix: b });
    expect(matrixInView(store.getState().focus)).toBe(b);
    store.dispatch({ type: 'show', matrix: a });
    expect(store.getState().focus).toMatchObject({ matrix: a, shown: a });
    store.dispatch({ type: 'focus', matrix: null });
    expect(store.getState().focus).toMatchObject({ matrix: null, shown: a });
  });
});

describe('the pins in Song (Magnus beslut 2026-10-22: Listan och hyllan i Song)', () => {
  /** A store whose project has a loop and a mod; returns their ids. */
  function loopAndMod() {
    const store = createStore(initialState(createProject()));
    store.dispatch({ type: 'run', command: createLoop('Amen', 'main', 1) });
    store.dispatch({ type: 'run', command: createMod('Wobble', []) });
    const present = store.getState().history.present;
    return { store, loop: Object.keys(present.loops)[0]!, mod: Object.keys(present.mods)[0]! };
  }

  it('pins every loop and mod from the start, also a new one', () => {
    const { store, loop, mod } = loopAndMod();
    expect(songPinned(store.getState().focus, loop)).toBe(true);
    expect(songPinned(store.getState().focus, mod)).toBe(true);
    store.dispatch({ type: 'run', command: createLoop('Fill', 'fill', 1) });
    const fill = Object.keys(store.getState().history.present.loops).find((id) => id !== loop)!;
    expect(songPinned(store.getState().focus, fill)).toBe(true);
  });

  it('unpins and pins loops and mods again, each once', () => {
    const { store, loop, mod } = loopAndMod();
    store.dispatch({ type: 'songPin', id: loop, on: false });
    store.dispatch({ type: 'songPin', id: loop, on: false });
    store.dispatch({ type: 'songPin', id: mod, on: false });
    expect(store.getState().focus.songUnpins).toEqual([loop, mod]);
    expect(songPinned(store.getState().focus, loop)).toBe(false);
    store.dispatch({ type: 'songPin', id: loop, on: true });
    expect(store.getState().focus.songUnpins).toEqual([mod]);
    expect(songPinned(store.getState().focus, loop)).toBe(true);
  });

  it('has nothing to do with the pins in Loops or Matrices', () => {
    const { store, loop } = loopAndMod();
    store.dispatch({ type: 'run', command: createMatrix('Snares') });
    const matrix = Object.keys(store.getState().history.present.matrices)[0]!;
    store.dispatch({ type: 'songPin', id: loop, on: false });
    expect(store.getState().focus).toMatchObject({ matrix: null, loopUnpins: [] });
    store.dispatch({ type: 'loopPin', matrix, on: false });
    store.dispatch({ type: 'focus', matrix });
    expect(store.getState().focus.songUnpins).toEqual([loop]);
  });

  it('drops removed loops and mods', () => {
    const { store, loop, mod } = loopAndMod();
    store.dispatch({ type: 'songPin', id: loop, on: false });
    store.dispatch({ type: 'songPin', id: mod, on: false });
    store.dispatch({ type: 'run', command: remove('mod', mod) });
    expect(store.getState().focus.songUnpins).toEqual([loop]);
  });

  it('is view state, not undone, and everything is pinned again after Load', () => {
    const { store, loop } = loopAndMod();
    const before = store.getState().history;
    store.dispatch({ type: 'songPin', id: loop, on: false });
    expect(store.getState().history).toBe(before);
    store.dispatch({ type: 'undo' });
    store.dispatch({ type: 'redo' });
    expect(songPinned(store.getState().focus, loop)).toBe(false);
    store.dispatch({ type: 'load', project: store.getState().history.present });
    expect(songPinned(store.getState().focus, loop)).toBe(true);
  });
});
