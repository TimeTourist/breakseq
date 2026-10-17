import type { Place, Store } from './store';
import { placeOf } from './store';

const isPlace = (value: unknown): value is Place =>
  typeof value === 'object' && value !== null && 'view' in value && 'selection' in value && 'sliceTarget' in value && 'trimming' in value;

/**
 * Makes the browser's Back and Forward go between tabs: every change of tab is
 * a step in the browser's history, which keeps what was open in the tab left.
 * Undo is separate and untouched. Returns the cleanup.
 */
export function followBrowserHistory(store: Store, history: History = window.history, events: EventTarget = window): () => void {
  let last = placeOf(store.getState());
  let restoring = false;
  history.replaceState(last, '');

  const unsubscribe = store.subscribe(() => {
    if (restoring) return;
    const place = placeOf(store.getState());
    if (place.view !== last.view) {
      // The tab left keeps what was open in it when it was left.
      history.replaceState(last, '');
      history.pushState(place, '');
    }
    last = place;
  });

  const onPop = (e: Event) => {
    const place = (e as PopStateEvent).state;
    if (!isPlace(place)) return;
    restoring = true;
    store.dispatch({ type: 'place', place });
    restoring = false;
    last = placeOf(store.getState());
  };
  events.addEventListener('popstate', onPop);
  return () => {
    unsubscribe();
    events.removeEventListener('popstate', onPop);
  };
}
