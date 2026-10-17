import type { Usage } from '../model';
import { findUsages, removeAnyway } from '../model';
import { useProject, useRun } from './context';
import { TrashIcon } from './icons';

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
  /** What else goes with it, listed in the question: "4 pads", "loop amen 1". */
  readonly goes?: readonly string[];
  /** A trash icon instead of the label, which is then its tooltip: in tight rows. */
  readonly icon?: boolean;
}

/** What Delete asks, every time: what goes, and where it goes silent. */
export function deleteQuestion(name: string, goes: readonly string[], where: string): string {
  return [
    `Delete ${name}?`,
    ...(goes.length > 0 ? [`Goes with it: ${goes.join(', ')}.`] : []),
    ...(where !== '' ? [`Goes silent in: ${where}.`] : []),
    'Ctrl+Z brings it back.',
  ].join('\n');
}

export const usageText = (u: Usage) => (u.kind === 'song' ? 'Song' : `${u.kind} ${u.name}`);

/**
 * Delete, the same everywhere: it always asks first, listing what goes with
 * it and where it goes silent.
 */
export function DeleteButton({ label, name, usages, blocked, onDelete, onDeleted, onError, goes = [], icon = false }: DeleteButtonProps) {
  const where = usages.map(usageText).join(', ');
  return (
    <button
      type="button"
      className={icon ? 'icon-button small' : undefined}
      aria-label={`${label} ${name}`}
      disabled={blocked !== undefined}
      title={blocked ?? [label, ...(goes.length > 0 ? [`Goes with it: ${goes.join(', ')}`] : []), ...(usages.length > 0 ? [`Goes silent in: ${where}`] : [])].join('. ')}
      onClick={() => {
        if (!window.confirm(deleteQuestion(name, goes, where))) return;
        const failed = onDelete();
        onError(failed);
        if (failed === null) onDeleted?.();
      }}
    >
      {icon ? <TrashIcon /> : label}
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
