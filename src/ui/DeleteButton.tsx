import type { Usage } from '../model';
import { findUsages, removeAnyway } from '../model';
import { useProject, useRun } from './context';

interface DeleteButtonProps {
  /** What the button reads: "Delete pad". */
  readonly label: string;
  /** The name of what goes, for its aria-label and the question. */
  readonly name: string;
  /** Where it is used; it goes silent there. */
  readonly usages: readonly Usage[];
  /** Set when it cannot go on its own, saying why: a break's own pad goes with the break. */
  readonly blocked?: string | undefined;
  /** Removes it, returning an error or null. */
  readonly onDelete: () => string | null;
  readonly onDeleted?: (() => void) | undefined;
  readonly onError: (error: string | null) => void;
  /** What else goes with it, for the button's title. */
  readonly takes?: string;
}

export const usageText = (u: Usage) => (u.kind === 'song' ? 'Song' : `${u.kind} ${u.name}`);

/**
 * Delete, the same everywhere: deleting something that is used asks first,
 * naming where, and it goes silent there.
 */
export function DeleteButton({ label, name, usages, blocked, onDelete, onDeleted, onError, takes }: DeleteButtonProps) {
  const where = usages.map(usageText).join(', ');
  return (
    <button
      type="button"
      aria-label={`${label} ${name}`}
      disabled={blocked !== undefined}
      title={blocked ?? (usages.length > 0 ? `In use by ${where}: it goes silent there` : `${label}${takes === undefined ? '' : `: ${takes}`}`)}
      onClick={() => {
        if (usages.length > 0 && !window.confirm(`${name} is used by ${where}. Delete it anyway? It goes silent there.`)) return;
        const failed = onDelete();
        onError(failed);
        if (failed === null) onDeleted?.();
      }}
    >
      {label}
    </button>
  );
}

interface DeleteProps {
  readonly kind: 'pad' | 'hit' | 'loop' | 'mod';
  readonly id: string;
  readonly name: string;
  readonly onDeleted?: (() => void) | undefined;
  readonly onError: (error: string | null) => void;
}

/** Delete for a pad, hit, loop or mod; one that is part of a break goes with the break instead. */
export function Delete({ kind, id, name, onDeleted, onError }: DeleteProps) {
  const project = useProject();
  const run = useRun();
  const usages = findUsages(project, kind, id);
  const owner = usages.find((u) => u.kind === 'break');
  return (
    <DeleteButton
      label={`Delete ${kind}`}
      name={name}
      usages={usages}
      blocked={owner === undefined ? undefined : `Part of break ${owner.name}: it goes with the break`}
      onDelete={() => run(removeAnyway(kind, id))}
      onDeleted={onDeleted}
      onError={onError}
    />
  );
}
