import { useSyncExternalStore } from 'react';
import type { Command, CommandError, History, Project } from '../model';
import { apply, createHistory, createProject, redo, undo } from '../model';

export const VIEWS = ['import', 'slice', 'tag', 'hits', 'pads', 'loops', 'mods', 'song'] as const;
export type View = (typeof VIEWS)[number];

export interface AppState {
  readonly history: History;
  readonly view: View;
  /** The break picked in Import for slicing. */
  readonly sliceTarget: string | null;
}

export type Action =
  | { readonly type: 'run'; readonly command: Command }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'view'; readonly view: View }
  | { readonly type: 'sliceTarget'; readonly sampleId: string | null }
  | { readonly type: 'load'; readonly project: Project };

export const initialState = (project: Project = createProject()): AppState => ({
  history: createHistory(project),
  view: 'import',
  sliceTarget: null,
});

/** Pure state transition. A failed command leaves the state unchanged and reports its error. */
export function reduce(state: AppState, action: Action): { state: AppState; error: CommandError | null } {
  switch (action.type) {
    case 'run': {
      const result = apply(state.history, action.command);
      return result.ok ? { state: { ...state, history: result.history }, error: null } : { state, error: result.error };
    }
    case 'undo':
      return { state: { ...state, history: undo(state.history) }, error: null };
    case 'redo':
      return { state: { ...state, history: redo(state.history) }, error: null };
    case 'view':
      return { state: { ...state, view: action.view }, error: null };
    case 'sliceTarget':
      return { state: { ...state, sliceTarget: action.sampleId }, error: null };
    case 'load':
      return { state: { ...state, history: createHistory(action.project) }, error: null };
  }
}

export interface Store {
  readonly getState: () => AppState;
  readonly dispatch: (action: Action) => CommandError | null;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createStore(initial: AppState = initialState()): Store {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (action) => {
      const next = reduce(state, action);
      if (next.state !== state) {
        state = next.state;
        listeners.forEach((l) => l());
      }
      return next.error;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useAppState<T>(store: Store, select: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export const describeError = (error: CommandError): string => {
  switch (error.kind) {
    case 'in-use':
      return `In use by ${error.usages.map((u) => u.name).join(', ')}`;
    case 'not-found':
      return 'Not found';
    case 'invalid':
      return error.message;
  }
};
