import { describe, expect, it } from 'vitest';
import { createMatrix, createProject, remove } from '../model';
import { createStore, initialState, matrixInView } from './store';

/** A store whose project has two matrices; returns their ids. */
function twoMatrices() {
  const store = createStore(initialState(createProject()));
  store.dispatch({ type: 'run', command: createMatrix('Snares') });
  store.dispatch({ type: 'run', command: createMatrix('Kicks') });
  const [a, b] = Object.keys(store.getState().history.present.matrices);
  return { store, a: a!, b: b! };
}

describe('focus', () => {
  it('starts with no focus matrix and no matrix pinned in Loops', () => {
    expect(createStore().getState().focus).toEqual({ matrix: null, loopPins: [] });
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
    expect(store.getState().focus).toEqual({ matrix: null, loopPins: [], shown: null });
  });
});

describe('the pins in Loops (Magnus beslut: several, apart from the Matrices pin)', () => {
  it('adds and removes matrices, each once', () => {
    const { store, a, b } = twoMatrices();
    store.dispatch({ type: 'loopPin', matrix: a, on: true });
    store.dispatch({ type: 'loopPin', matrix: a, on: true });
    store.dispatch({ type: 'loopPin', matrix: b, on: true });
    expect(store.getState().focus.loopPins).toEqual([a, b]);
    store.dispatch({ type: 'loopPin', matrix: a, on: false });
    expect(store.getState().focus.loopPins).toEqual([b]);
  });

  it('drops removed matrices', () => {
    const { store, a, b } = twoMatrices();
    store.dispatch({ type: 'loopPin', matrix: a, on: true });
    store.dispatch({ type: 'loopPin', matrix: b, on: true });
    store.dispatch({ type: 'run', command: remove('matrix', a) });
    expect(store.getState().focus.loopPins).toEqual([b]);
  });

  it('is view state: not in the undo history', () => {
    const { store, a } = twoMatrices();
    const before = store.getState().history;
    store.dispatch({ type: 'focus', matrix: a });
    store.dispatch({ type: 'loopPin', matrix: a, on: true });
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
