import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

interface ConfirmDeleteProps {
  readonly name: string;
  readonly goes: readonly string[];
  readonly usages: readonly Usage[];
  readonly onAnswer: (yes: boolean) => void;
  /** The question, for other changes that take things with them: "Make amen 1 a one-shot?". */
  readonly question?: string;
  /** The button that does it. */
  readonly action?: string;
}

/**
 * What Delete asks, every time, in a dialog: what goes with it, and where it
 * goes silent. Other changes that take things with them ask the same way.
 */
export function ConfirmDelete({ name, goes, usages, onAnswer, question = `Delete ${name}?`, action = 'Delete' }: ConfirmDeleteProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onAnswer(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onAnswer]);
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className="dialog panel stack confirm-delete" role="alertdialog" aria-modal="true" aria-label={question}>
        <h2>{question}</h2>
        {goes.length > 0 && (
          <div className="stack-tight">
            <span className="label">Goes with it</span>
            <ul>
              {goes.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        )}
        {usages.length > 0 && (
          <div className="stack-tight">
            <span className="label">Goes silent in</span>
            <ul>
              {usages.map((u) => (
                <li key={`${u.kind}:${u.id ?? ''}`}>{usageText(u)}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="muted small">Ctrl+Z brings it back.</p>
        <div className="row confirm-buttons">
          <button type="button" autoFocus onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={() => onAnswer(true)}>
            {action}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const usageText = (u: Usage) => (u.kind === 'song' ? 'Song' : `${u.kind} ${u.name}`);

/**
 * Delete, the same everywhere: it always asks first, in a dialog listing what
 * goes with it and where it goes silent.
 */
export function DeleteButton({ label, name, usages, blocked, onDelete, onDeleted, onError, goes = [], icon = false }: DeleteButtonProps) {
  const where = usages.map(usageText).join(', ');
  const [asking, setAsking] = useState(false);
  return (
    <>
    <button
      type="button"
      className={icon ? 'icon-button small' : undefined}
      aria-label={`${label} ${name}`}
      disabled={blocked !== undefined}
      title={blocked ?? [label, ...(goes.length > 0 ? [`Goes with it: ${goes.join(', ')}`] : []), ...(usages.length > 0 ? [`Goes silent in: ${where}`] : [])].join('. ')}
      onClick={() => setAsking(true)}
    >
      {icon ? <TrashIcon /> : label}
    </button>
    {asking && (
      <ConfirmDelete
        name={name}
        goes={goes}
        usages={usages}
        onAnswer={(yes) => {
          setAsking(false);
          if (!yes) return;
          const failed = onDelete();
          onError(failed);
          if (failed === null) onDeleted?.();
        }}
      />
    )}
    </>
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
