import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Project, Renumber } from '../model';

/** Words in a list: "a", "a and b", "a, b and c". */
const listText = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`;

/** What the renumber dialog asks (decision 14): "You use slice 07, 09 in: pad 2 and pad 3. Make a new trim and sample for this?" */
export function renumberQuestion(project: Project, conflict: Renumber): string {
  const slices = conflict.slices.map((s) => String(s + 1).padStart(2, '0')).join(', ');
  const pads = listText(conflict.pads.flatMap((id) => (project.pads[id] === undefined ? [] : [`pad ${project.pads[id].name}`])));
  return `You use slice ${slices} in: ${pads}. Make a new trim and sample for this?`;
}

interface RenumberDialogProps {
  readonly project: Project;
  readonly conflict: Renumber;
  /** New trim (true) or Renumber (false); null when cancelled, as with Escape. */
  readonly onAnswer: (newTrim: boolean | null) => void;
}

/**
 * Asked before a change of markers or bars renumbers slices that more than
 * one hit plays. New trim leaves them as they were and moves the matrix being
 * sliced to a new trim with the change; Renumber counts slices by number.
 */
export function RenumberDialog({ project, conflict, onAnswer }: RenumberDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onAnswer(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onAnswer]);
  const question = renumberQuestion(project, conflict);
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onAnswer(null)}>
      <div className="dialog panel stack confirm-delete" role="alertdialog" aria-modal="true" aria-label={question}>
        <h2>{question}</h2>
        <p className="muted small">New trim leaves everything that plays them as it is. Renumber counts slices by number, so a slice that moves up plays where the old one did. Escape cancels.</p>
        <div className="row confirm-buttons">
          <button type="button" autoFocus onClick={() => onAnswer(true)}>
            New trim
          </button>
          <button type="button" onClick={() => onAnswer(false)}>
            Renumber
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
