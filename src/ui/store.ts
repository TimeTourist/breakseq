import { useSyncExternalStore } from 'react';
import type { Folder, SnapshotInfo } from '../engine';
import type { Clip, Command, CommandError, History, Id, Project } from '../model';
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
  /** The slice Slice opens with selected, as when a parent's slice line in Hits is double-clicked. */
  readonly sliceSelected: number;
  readonly selection: Selection;
  /** The step in Song that Play starts from, set by a click in its ruler; Stop goes back to it. */
  readonly songCursor: number;
  /** A clip copied in Song with Ctrl+C, to paste with Ctrl+V. */
  readonly clipboard: Clip | null;
  /** Whether Play in Hits loops what is open, or plays it once. */
  readonly hitsLoop: boolean;
  /** Breaks whose pads are folded away in the Hits list. */
  readonly folded: readonly Id[];
  /** The break whose Trim is open in Import: what Play plays there. */
  readonly trimming: Id | null;
  /** Groups of pads left out of the pad shelf in Loops: a break's id, or "One-shots" or "Built". */
  readonly shelfHidden: readonly string[];
  /** Groups unfolded in the list under the shelf that chooses them; all are folded at first. */
  readonly shelfOpen: readonly string[];
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
  | { readonly type: 'sliceTarget'; readonly breakId: string | null; readonly slice?: number }
  /** Swaps in a project and starts a new undo history, as a loaded snapshot does. */
  | { readonly type: 'load'; readonly project: Project }
  | { readonly type: 'projectFolder'; readonly state: Partial<ProjectFolderState> }
  | { readonly type: 'songCursor'; readonly step: number }
  | { readonly type: 'clipboard'; readonly clip: Clip | null }
  | { readonly type: 'hitsLoop'; readonly loop: boolean }
  | { readonly type: 'fold'; readonly breakIds: readonly Id[]; readonly folded: boolean }
  | { readonly type: 'trimming'; readonly breakId: Id | null }
  | { readonly type: 'shelfShown'; readonly group: string; readonly shown: boolean }
  | { readonly type: 'shelfOpen'; readonly groups: readonly string[]; readonly open: boolean };

export const initialState = (project: Project = createProject()): AppState => ({
  history: createHistory(project),
  projectFolder: { folder: null, active: null, saved: null, snapshots: [] },
  view: 'import',
  sliceTarget: null,
  sliceSelected: 0,
  selection: { hit: null, pad: null, loop: null, step: null, mod: null, previewLoop: null },
  songCursor: 0,
  clipboard: null,
  hitsLoop: false,
  folded: [],
  trimming: null,
  shelfHidden: [],
  shelfOpen: [],
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
      return { state: { ...state, sliceTarget: action.breakId, sliceSelected: action.slice ?? 0 }, error: null };
    case 'load':
      return { state: { ...state, history: createHistory(action.project), songCursor: 0 }, error: null };
    case 'projectFolder':
      return { state: { ...state, projectFolder: { ...state.projectFolder, ...action.state } }, error: null };
    case 'songCursor':
      return { state: { ...state, songCursor: Math.max(0, Math.round(action.step)) }, error: null };
    case 'clipboard':
      return { state: { ...state, clipboard: action.clip }, error: null };
    case 'hitsLoop':
      return { state: { ...state, hitsLoop: action.loop }, error: null };
    case 'fold': {
      const others = state.folded.filter((id) => !action.breakIds.includes(id));
      return { state: { ...state, folded: action.folded ? [...others, ...action.breakIds] : others }, error: null };
    }
    case 'trimming':
      return { state: { ...state, trimming: action.breakId }, error: null };
    case 'shelfShown': {
      const others = state.shelfHidden.filter((g) => g !== action.group);
      return { state: { ...state, shelfHidden: action.shown ? others : [...others, action.group] }, error: null };
    }
    case 'shelfOpen': {
      const others = state.shelfOpen.filter((g) => !action.groups.includes(g));
      return { state: { ...state, shelfOpen: action.open ? [...others, ...action.groups] : others }, error: null };
    }
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
