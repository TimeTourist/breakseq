import { useSyncExternalStore } from 'react';
import type { Folder, SnapshotInfo } from '../engine';
import type { Clip, Command, CommandError, History, Id, Project } from '../model';
import { apply, createHistory, createProject, redo, seal, undo } from '../model';

export const VIEWS = ['samples', 'pads', 'loops', 'mods', 'song', 'project'] as const;
export type View = (typeof VIEWS)[number];

/** What is open in each editing view. */
export interface Selection {
  readonly hit: Id | null;
  readonly pad: Id | null;
  /** The matrix selected on its own in Pads, while no pad or hit is. */
  readonly matrix: Id | null;
  readonly loop: Id | null;
  /** Step index within the selected loop. */
  readonly step: number | null;
  readonly mod: Id | null;
  /** The loop a mod is tried on in Mods. */
  readonly previewLoop: Id | null;
}

/** Where one is in the app: the tab and what is open in it. Browser Back and Forward go between places. */
export type Place = Pick<AppState, 'view' | 'selection' | 'sliceTarget' | 'trimming'>;

export const placeOf = ({ view, selection, sliceTarget, trimming }: AppState): Place => ({ view, selection, sliceTarget, trimming });

/** The project folder open in Project, and which snapshot the work was last saved to. */
export interface ProjectFolderState {
  readonly folder: Folder | null;
  readonly active: SnapshotInfo | null;
  /** `comparable` of the project as the active snapshot holds it: the work differs from it when changed. */
  readonly saved: string | null;
  /** The snapshots in the folder, newest first. */
  readonly snapshots: readonly SnapshotInfo[];
}

/**
 * The matrix the Samples and Pads tabs work on, and the matrices their pads are
 * taken from. View state: not in the undo history and not in the project file.
 */
export interface Focus {
  readonly matrix: Id | null;
  readonly takeFrom: readonly Id[];
}

/**
 * The matrices taken from, as shown and used: the matrix in focus is not one,
 * though it stays in `takeFrom` and comes back when the focus moves on.
 */
export const takenFrom = (focus: Focus): Id[] => focus.takeFrom.filter((id) => id !== focus.matrix);

export interface AppState {
  readonly history: History;
  readonly focus: Focus;
  readonly projectFolder: ProjectFolderState;
  readonly view: View;
  /** The trim selected in Samples, shown with its slicing below the table. */
  readonly sliceTarget: string | null;
  readonly selection: Selection;
  /** The step in Song that Play starts from, set by a click in its ruler; Stop goes back to it. */
  readonly songCursor: number;
  /** A clip copied in Song with Ctrl+C, to paste with Ctrl+V. */
  readonly clipboard: Clip | null;
  /** The sample (trim) whose Trim is open in Samples, below the table: what Play plays there. Follows `sliceTarget`. */
  readonly trimming: Id | null;
  /** A trim just marked Slice by a click: its slicing below slices it once by default (transients or its cues, at guessed bars). Undo never sets it. */
  readonly autoSlice: Id | null;
  /** The transients last found in Samples, so Transients stays chosen across New trim, a new trim, undo and redo. */
  readonly transients: TransientsFound | null;
}

/** Transients found for a sample: the slice points in its file they gave, and at which sensitivity. */
export interface TransientsFound {
  readonly sampleId: Id;
  readonly points: readonly number[];
  readonly sensitivity: number;
}

export type Action =
  /** `mergeKey`: runs with the same key in a row share one undo step (see `apply`). */
  | { readonly type: 'run'; readonly command: Command; readonly mergeKey?: string }
  /** Ends a merge, as when a slider is released. */
  | { readonly type: 'seal' }
  | { readonly type: 'select'; readonly selection: Partial<Selection>; readonly view?: View }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  /** Sets the focus matrix, or clears it with null. */
  | { readonly type: 'focus'; readonly matrix: Id | null }
  /** Adds a matrix to the ones taken from, or removes it. */
  | { readonly type: 'takeFrom'; readonly matrix: Id; readonly on: boolean }
  | { readonly type: 'view'; readonly view: View }
  | { readonly type: 'place'; readonly place: Place }
  | { readonly type: 'sliceTarget'; readonly sampleId: string | null }
  /** Swaps in a project and starts a new undo history, as a loaded snapshot does. */
  | { readonly type: 'load'; readonly project: Project }
  | { readonly type: 'projectFolder'; readonly state: Partial<ProjectFolderState> }
  | { readonly type: 'songCursor'; readonly step: number }
  | { readonly type: 'clipboard'; readonly clip: Clip | null }
  | { readonly type: 'trimming'; readonly sampleId: Id | null }
  | { readonly type: 'autoSlice'; readonly sampleId: Id | null }
  | { readonly type: 'transients'; readonly found: TransientsFound | null };

export const initialState = (project: Project = createProject()): AppState => ({
  history: createHistory(project),
  focus: { matrix: null, takeFrom: [] },
  projectFolder: { folder: null, active: null, saved: null, snapshots: [] },
  view: 'samples',
  sliceTarget: null,
  selection: { hit: null, pad: null, matrix: null, loop: null, step: null, mod: null, previewLoop: null },
  songCursor: 0,
  clipboard: null,
  trimming: null,
  autoSlice: null,
  transients: null,
});

/** The focus with matrices that are no longer in the project left out: a removed or undone matrix is no focus. */
const settleFocus = (focus: Focus, project: Project): Focus => {
  const matrix = focus.matrix !== null && project.matrices[focus.matrix] !== undefined ? focus.matrix : null;
  const takeFrom = focus.takeFrom.filter((id) => project.matrices[id] !== undefined);
  return matrix === focus.matrix && takeFrom.length === focus.takeFrom.length ? focus : { matrix, takeFrom };
};

/** The state with a new history, its focus settled on the project the history now shows. */
const withHistory = (state: AppState, history: History): AppState => ({
  ...state,
  history,
  focus: settleFocus(state.focus, history.present),
});

/** Pure state transition. A failed command leaves the state unchanged and reports its error. */
export function reduce(state: AppState, action: Action): { state: AppState; error: CommandError | null } {
  switch (action.type) {
    case 'run': {
      const result = apply(state.history, action.command, undefined, action.mergeKey ?? null);
      return result.ok ? { state: withHistory(state, result.history), error: null } : { state, error: result.error };
    }
    case 'seal': {
      const history = seal(state.history);
      return { state: history === state.history ? state : withHistory(state, history), error: null };
    }
    case 'select':
      return {
        state: { ...state, selection: { ...state.selection, ...action.selection }, view: action.view ?? state.view },
        error: null,
      };
    case 'undo':
      return { state: withHistory(state, undo(state.history)), error: null };
    case 'redo':
      return { state: withHistory(state, redo(state.history)), error: null };
    case 'focus':
      return { state: { ...state, focus: { ...state.focus, matrix: action.matrix } }, error: null };
    case 'takeFrom': {
      const others = state.focus.takeFrom.filter((id) => id !== action.matrix);
      return { state: { ...state, focus: { ...state.focus, takeFrom: action.on ? [...others, action.matrix] : others } }, error: null };
    }
    case 'view':
      return { state: { ...state, view: action.view }, error: null };
    case 'place':
      return { state: { ...state, ...action.place }, error: null };
    case 'sliceTarget':
      // An open Trim is part of what is shown below the table: it follows the trim selected (fas 23b).
      return {
        state: { ...state, sliceTarget: action.sampleId, trimming: state.trimming === null || action.sampleId === null ? state.trimming : action.sampleId },
        error: null,
      };
    case 'load':
      return { state: { ...withHistory(state, createHistory(action.project)), songCursor: 0 }, error: null };
    case 'projectFolder':
      return { state: { ...state, projectFolder: { ...state.projectFolder, ...action.state } }, error: null };
    case 'songCursor':
      return { state: { ...state, songCursor: Math.max(0, Math.round(action.step)) }, error: null };
    case 'clipboard':
      return { state: { ...state, clipboard: action.clip }, error: null };
    case 'trimming':
      return { state: { ...state, trimming: action.sampleId }, error: null };
    case 'autoSlice':
      return { state: { ...state, autoSlice: action.sampleId }, error: null };
    case 'transients':
      return { state: { ...state, transients: action.found }, error: null };
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
