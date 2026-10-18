import type { Id, Project } from './types';

export type UsageKind = 'sample' | 'matrix' | 'hit' | 'pad' | 'loop' | 'mod' | 'song';

/** Something that refers to the object being removed. */
export interface Usage {
  readonly kind: UsageKind;
  /** null for the song, which has no id. */
  readonly id: Id | null;
  readonly name: string;
}

export type CommandError =
  | { readonly kind: 'in-use'; readonly usages: readonly Usage[] }
  | { readonly kind: 'not-found'; readonly id: Id }
  | { readonly kind: 'invalid'; readonly message: string };

export type CommandResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly error: CommandError };

export interface CommandContext {
  readonly newId: () => Id;
}

/** A change to the project. Pure: returns a new project and never mutates the old one. */
export type Command = (project: Project, ctx: CommandContext) => CommandResult;

export const defaultContext: CommandContext = {
  newId: () => crypto.randomUUID(),
};

export const ok = (project: Project): CommandResult => ({ ok: true, project });

export const fail = (error: CommandError): CommandResult => ({ ok: false, error });

export const notFound = (id: Id): CommandResult => fail({ kind: 'not-found', id });

export const invalid = (message: string): CommandResult => fail({ kind: 'invalid', message });

/** Runs commands in order as one command; stops at the first failure. */
export const sequence =
  (...commands: readonly Command[]): Command =>
  (project, ctx) => {
    let current = project;
    for (const command of commands) {
      const result = command(current, ctx);
      if (!result.ok) return result;
      current = result.project;
    }
    return ok(current);
  };

/** Returns a copy of `record` with `key` removed. */
export function without<T>(record: Readonly<Record<Id, T>>, key: Id): Record<Id, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}
