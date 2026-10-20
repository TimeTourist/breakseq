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
  /** The clip selected in Song. Missing in a place kept before it was added. */
  readonly clip?: Id | null;
}

/** Where one is in the app: the tab and what is open in it. Browser Back and Forward go between places. */
export type Place = Pick<AppState, 'view' | 'selection' | 'sliceTarget'>;

export const placeOf = ({ view, selection, sliceTarget }: AppState): Place => ({ view, selection, sliceTarget });

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
 * Which matrix Matrices shows, and which matrices Loops' shelf holds. View
 * state: not in the undo history and not in the project file (Magnus beslut).
 */
export interface Focus {
  /**
   * The pinned matrix in Matrices (Magnus beslut): while there is one Matrices
   * always shows it, and a click on another matrix's pad or hit only plays it.
   */
  readonly matrix: Id | null;
  /** The matrices pinned in Loops, whose pads its shelf holds: several, apart from the Matrices pin (Magnus beslut). */
  readonly loopPins: readonly Id[];
  /** The matrix Matrices shows while none is pinned: the one whose row, pad or hit was clicked last. Missing is none. */
  readonly shown?: Id | null;
}

/** The matrix Matrices shows: the pinned one, else the one clicked last. */
export const matrixInView = (focus: Focus): Id | null => focus.matrix ?? focus.shown ?? null;

export interface AppState {
  readonly history: History;
  readonly focus: Focus;
  readonly projectFolder: ProjectFolderState;
  readonly view: View;
  /** The sample selected in Samples, shown in its editor. */
  readonly sliceTarget: string | null;
  readonly selection: Selection;
  /** The step in Song that Play starts from, set by a click in its ruler; Stop goes back to it. */
  readonly songCursor: number;
  /** A clip copied in Song with Ctrl+C, to paste with Ctrl+V. */
  readonly clipboard: Clip | null;
  /** Loop in the header: Play plays what it plays over and over, else once. On to begin with; the song has its own loop. (Magnus beslut) */
  readonly loop: boolean;
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
  /** Pins a matrix (the focus in Loops), or unpins with null; Matrices goes on showing what it showed. */
  | { readonly type: 'focus'; readonly matrix: Id | null }
  /** Shows a matrix in Matrices, as a link or a click on it does; a pin, if any, moves to it. */
  | { readonly type: 'show'; readonly matrix: Id }
  /** Pins a matrix in Loops, or unpins it. */
  | { readonly type: 'loopPin'; readonly matrix: Id; readonly on: boolean }
  | { readonly type: 'view'; readonly view: View }
  | { readonly type: 'place'; readonly place: Place }
  | { readonly type: 'sliceTarget'; readonly sampleId: string | null }
  /** Swaps in a project and starts a new undo history, as a loaded snapshot does. */
  | { readonly type: 'load'; readonly project: Project }
  | { readonly type: 'projectFolder'; readonly state: Partial<ProjectFolderState> }
  | { readonly type: 'songCursor'; readonly step: number }
  | { readonly type: 'clipboard'; readonly clip: Clip | null }
  | { readonly type: 'loop'; readonly on: boolean }
  | { readonly type: 'transients'; readonly found: TransientsFound | null };

export const initialState = (project: Project = createProject()): AppState => ({
  history: createHistory(project),
  focus: { matrix: null, loopPins: [] },
  projectFolder: { folder: null, active: null, saved: null, snapshots: [] },
  view: 'samples',
  sliceTarget: null,
  selection: { hit: null, pad: null, matrix: null, loop: null, step: null, mod: null, previewLoop: null, clip: null },
  songCursor: 0,
  clipboard: null,
  loop: true,
  transients: null,
});

/** The focus with matrices that are no longer in the project left out: a removed or undone matrix is no focus. */
const settleFocus = (focus: Focus, project: Project): Focus => {
  const matrix = focus.matrix !== null && project.matrices[focus.matrix] !== undefined ? focus.matrix : null;
  const shown = (focus.shown ?? null) !== null && project.matrices[focus.shown!] !== undefined ? focus.shown! : null;
  const loopPins = focus.loopPins.filter((id) => project.matrices[id] !== undefined);
  return matrix === focus.matrix && shown === (focus.shown ?? null) && loopPins.length === focus.loopPins.length ? focus : { matrix, loopPins, shown };
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
      // Unpinned, Matrices goes on showing the matrix it showed.
      return { state: { ...state, focus: { ...state.focus, matrix: action.matrix, shown: action.matrix ?? matrixInView(state.focus) } }, error: null };
    case 'show':
      return { state: { ...state, focus: { ...state.focus, shown: action.matrix, matrix: state.focus.matrix === null ? null : action.matrix } }, error: null };
    case 'loopPin': {
      const others = state.focus.loopPins.filter((id) => id !== action.matrix);
      return { state: { ...state, focus: { ...state.focus, loopPins: action.on ? [...others, action.matrix] : others } }, error: null };
    }
    case 'view':
      return { state: { ...state, view: action.view }, error: null };
    case 'place':
      return { state: { ...state, ...action.place }, error: null };
    case 'sliceTarget':
      return { state: { ...state, sliceTarget: action.sampleId }, error: null };
    case 'load':
      return { state: { ...withHistory(state, createHistory(action.project)), songCursor: 0 }, error: null };
    case 'projectFolder':
      return { state: { ...state, projectFolder: { ...state.projectFolder, ...action.state } }, error: null };
    case 'songCursor':
      return { state: { ...state, songCursor: Math.max(0, Math.round(action.step)) }, error: null };
    case 'clipboard':
      return { state: { ...state, clipboard: action.clip }, error: null };
    case 'loop':
      return { state: { ...state, loop: action.on }, error: null };
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
