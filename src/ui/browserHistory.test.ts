// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../model';
import { followBrowserHistory } from './browserHistory';
import { createStore, initialState } from './store';

/** A browser history of its own: entries, where one is, and popstate on Back and Forward. */
function fakeHistory() {
  const events = new EventTarget();
  const entries: unknown[] = [null];
  let at = 0;
  const history = {
    get state() {
      return entries[at];
    },
    replaceState: (state: unknown) => {
      entries[at] = structuredClone(state);
    },
    pushState: (state: unknown) => {
      entries.splice(at + 1, entries.length, structuredClone(state));
      at += 1;
    },
  } as unknown as History;
  const go = (by: number) => {
    at += by;
    events.dispatchEvent(Object.assign(new Event('popstate'), { state: entries[at] }));
  };
  return { history, events, back: () => go(-1), forward: () => go(1), length: () => entries.length };
}

let stop = () => {};
afterEach(() => stop());

describe('browser Back and Forward', () => {
  it('go between tabs, each with what was open in it', () => {
    const store = createStore(initialState(createProject()));
    const browser = fakeHistory();
    stop = followBrowserHistory(store, browser.history, browser.events);
    store.dispatch({ type: 'sliceTarget', sampleId: 'b1' });
    store.dispatch({ type: 'view', view: 'slice' });
    store.dispatch({ type: 'select', selection: { hit: 'h1' }, view: 'hits' });
    store.dispatch({ type: 'select', selection: { hit: 'h2' } });
    store.dispatch({ type: 'view', view: 'loops' });
    expect(browser.length()).toBe(4);

    browser.back();
    expect(store.getState()).toMatchObject({ view: 'hits', selection: { hit: 'h2' } });
    browser.back();
    expect(store.getState()).toMatchObject({ view: 'slice', sliceTarget: 'b1' });
    browser.back();
    expect(store.getState().view).toBe('import');
    browser.forward();
    expect(store.getState().view).toBe('slice');
  });

  it('a new tab after Back drops the steps ahead, as in a browser', () => {
    const store = createStore(initialState(createProject()));
    const browser = fakeHistory();
    stop = followBrowserHistory(store, browser.history, browser.events);
    store.dispatch({ type: 'view', view: 'slice' });
    store.dispatch({ type: 'view', view: 'hits' });
    browser.back();
    store.dispatch({ type: 'view', view: 'song' });
    expect(browser.length()).toBe(3);
    browser.back();
    expect(store.getState().view).toBe('slice');
  });

  it('changes within a tab are not steps, and undo is untouched', () => {
    const store = createStore(initialState(createProject()));
    const browser = fakeHistory();
    stop = followBrowserHistory(store, browser.history, browser.events);
    store.dispatch({ type: 'select', selection: { loop: 'l1' } });
    store.dispatch({ type: 'select', selection: { loop: 'l2' } });
    expect(browser.length()).toBe(1);
  });
});
