import { createContext, useContext } from 'react';
import type { Command, Project } from '../model';
import type { Services } from './services';
import type { AppState, Selection, Store, View } from './store';
import { describeError, useAppState } from './store';

export interface AppContextValue {
  readonly store: Store;
  readonly services: Services;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error('useApp outside AppContext');
  return value;
}

export function useSelect<T>(select: (state: AppState) => T): T {
  return useAppState(useApp().store, select);
}

export const useProject = (): Project => useSelect((s) => s.history.present);

/**
 * Runs a command; returns an error message, or null when it worked. Runs with the
 * same `mergeKey` in a row share one undo step until `seal` (call it when a drag ends).
 */
export function useRun(): (command: Command, mergeKey?: string) => string | null {
  const { store } = useApp();
  return (command, mergeKey) => {
    const error = store.dispatch(mergeKey === undefined ? { type: 'run', command } : { type: 'run', command, mergeKey });
    return error === null ? null : describeError(error);
  };
}

export function useSeal(): () => void {
  const { store } = useApp();
  return () => store.dispatch({ type: 'seal' });
}

/** Opens an object in its view. */
export function useOpen(): (selection: Partial<Selection>, view: View) => void {
  const { store } = useApp();
  return (selection, view) => store.dispatch({ type: 'select', selection, view });
}
