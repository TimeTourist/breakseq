import { useSyncExternalStore } from 'react';
import type { Folder, SnapshotInfo } from '../engine';
import type { Command, CommandError, History, Id, Project } from '../model';
import { apply, createHistory, createProject, redo, seal, undo } from '../model';

export const VIEWS = ['import', 'slice', 'hits', 'loops', 'mods', 'song', 'project'] as const;
export type View = (typeof VIEWS)[number];

/** What is open in each editing view. */
export interface Selection {
  readonly hit: Id | null;
  readonly pad: Id | null;
  readonly loop: Id | null;
  /** Step index within the selected loop. */
  readonly step: number | null;
  readonly mod: Id | null;
  /** The loop a mod is tried on in Mods. */
  readonly previewLoop: Id | null;
}

/** The project folder open in Project, and which snapshot the work was last saved to. */
export interface ProjectFolderState {
  readonly folder: Folder | null;
  readonly active: SnapshotInfo | null;
  /** `comparable` of the project as the active snapshot holds it: the work differs from it when changed. */
  readonly saved: string | null;
  /** The snapshots in the folder, newest first. */
  readonly snapshots: readonly SnapshotInfo[];
}

export interface AppState {
  readonly history: History;
  readonly projectFolder: ProjectFolderState;
  readonly view: View;
  /** The break picked in Import for slicing. */
  readonly sliceTarget: string | null;
  readonly selection: Selection;
}

export type Action =
  /** `mergeKey`: runs with the same key in a row share one undo step (see `apply`). */
  | { readonly type: 'run'; readonly command: Command; readonly mergeKey?: string }
  /** Ends a merge, as when a slider is released. */
  | { readonly type: 'seal' }
  | { readonly type: 'select'; readonly selection: Partial<Selection>; readonly view?: View }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'view'; readonly view: View }
  | { readonly type: 'sliceTarget'; readonly breakId: string | null }
  /** Swaps in a project and starts a new undo history, as a loaded snapshot does. */
  | { readonly type: 'load'; readonly project: Project }
  | { readonly type: 'projectFolder'; readonly state: Partial<ProjectFolderState> };

export const initialState = (project: Project = createProject()): AppState => ({
  history: createHistory(project),
  projectFolder: { folder: null, active: null, saved: null, snapshots: [] },
  view: 'import',
  sliceTarget: null,
  selection: { hit: null, pad: null, loop: null, step: null, mod: null, previewLoop: null },
});

/** Pure state transition. A failed command leaves the state unchanged and reports its error. */
export function reduce(state: AppState, action: Action): { state: AppState; error: CommandError | null } {
  switch (action.type) {
    case 'run': {
      const result = apply(state.history, action.command, undefined, action.mergeKey ?? null);
      return result.ok ? { state: { ...state, history: result.history }, error: null } : { state, error: result.error };
    }
    case 'seal': {
      const history = seal(state.history);
      return { state: history === state.history ? state : { ...state, history }, error: null };
    }
    case 'select':
      return {
        state: { ...state, selection: { ...state.selection, ...action.selection }, view: action.view ?? state.view },
        error: null,
      };
    case 'undo':
      return { state: { ...state, history: undo(state.history) }, error: null };
    case 'redo':
      return { state: { ...state, history: redo(state.history) }, error: null };
    case 'view':
      return { state: { ...state, view: action.view }, error: null };
    case 'sliceTarget':
      return { state: { ...state, sliceTarget: action.breakId }, error: null };
    case 'load':
      return { state: { ...state, history: createHistory(action.project) }, error: null };
    case 'projectFolder':
      return { state: { ...state, projectFolder: { ...state.projectFolder, ...action.state } }, error: null };
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
