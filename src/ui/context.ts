import { createContext, useContext } from 'react';
import type { Command, Project } from '../model';
import type { Services } from './services';
import type { AppState, Store } from './store';
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

/** Runs a command; returns an error message, or null when it worked. */
export function useRun(): (command: Command) => string | null {
  const { store } = useApp();
  return (command) => {
    const error = store.dispatch({ type: 'run', command });
    return error === null ? null : describeError(error);
  };
}
