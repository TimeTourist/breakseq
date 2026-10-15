import type { Command, CommandContext, CommandError } from './command';
import { defaultContext } from './command';
import type { Project } from './types';

/** One shared undo history for the whole app: a list of immutable states. */
export interface History {
  readonly past: readonly Project[];
  readonly present: Project;
  readonly future: readonly Project[];
  /** The merge key of the last command, while further commands with it may join its undo step. */
  readonly lastKey: string | null;
}

export type ApplyResult =
  | { readonly ok: true; readonly history: History }
  | { readonly ok: false; readonly history: History; readonly error: CommandError };

export function createHistory(project: Project): History {
  return { past: [], present: project, future: [], lastKey: null };
}

/**
 * Runs a command. On success the old state goes on the undo stack and redo is cleared.
 * Commands given the same `mergeKey` one after another share one undo step, so dragging
 * a slider or typing a number is undone in one go.
 */
export function apply(
  history: History,
  command: Command,
  ctx: CommandContext = defaultContext,
  mergeKey: string | null = null,
): ApplyResult {
  const result = command(history.present, ctx);
  if (!result.ok) return { ok: false, history, error: result.error };
  const merge = mergeKey !== null && mergeKey === history.lastKey;
  return {
    ok: true,
    history: {
      past: merge ? history.past : [...history.past, history.present],
      present: result.project,
      future: [],
      lastKey: mergeKey,
    },
  };
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastKey: null,
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest, lastKey: null };
}

/** Ends the current merge, as when a slider is released: the next command starts a new undo step. */
export function seal(history: History): History {
  return history.lastKey === null ? history : { ...history, lastKey: null };
}
