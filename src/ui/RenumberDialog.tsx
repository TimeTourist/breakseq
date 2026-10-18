import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Id, Project, Renumber } from '../model';
import { matrixOfPad, rowName } from '../model';

/** Words in a list: "a", "a and b", "a, b and c". */
const listText = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`;

/** A pad by its matrix and row ("amen 1 07", "Snares 01"), which tell pads apart where names may not (U20). */
function padPlace(project: Project, padId: Id): string | null {
  const pad = project.pads[padId];
  if (pad === undefined) return null;
  const matrix = matrixOfPad(project, padId);
  return matrix === undefined ? pad.name : rowName(matrix.name, matrix.pads.indexOf(padId));
}

/** What the renumber dialog asks (decision 14): "You use slice 07, 09 in: pad amen 1 07 and pad Snares 01. Make a new trim and sample for this?" */
export function renumberQuestion(project: Project, conflict: Renumber, canNewTrim = true): string {
  const slices = conflict.slices.map((s) => String(s + 1).padStart(2, '0')).join(', ');
  const places = conflict.pads.map((id) => padPlace(project, id)).filter((place) => place !== null);
  const pads = listText(places.map((place) => `pad ${place}`));
  return `You use slice ${slices} in: ${pads}. ${canNewTrim ? 'Make a new trim and sample for this?' : 'Renumber them?'}`;
}

interface RenumberDialogProps {
  readonly project: Project;
  readonly conflict: Renumber;
  /** False for a trim with no matrix of its own: there is nothing for a new trim to take along, so only Renumber is offered. */
  readonly canNewTrim: boolean;
  /** New trim (true) or Renumber (false); null when cancelled, as with Escape. */
  readonly onAnswer: (newTrim: boolean | null) => void;
}

/**
 * Asked before a change of markers or bars renumbers slices that more than
 * one hit plays. New trim leaves them as they were and moves the matrix being
 * sliced to a new trim with the change; Renumber counts slices by number.
 */
export function RenumberDialog({ project, conflict, canNewTrim, onAnswer }: RenumberDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onAnswer(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onAnswer]);
  // The dialog itself takes focus, not a button in it: the Enter or blur that opened it must not answer it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const question = renumberQuestion(project, conflict, canNewTrim);
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onAnswer(null)}>
      <div ref={box} tabIndex={-1} className="dialog panel stack confirm-delete" role="alertdialog" aria-modal="true" aria-label={question}>
        <h2>{question}</h2>
        <p className="muted small">
          {canNewTrim && 'New trim leaves everything that plays them as it is. '}Renumber counts slices by number, so a slice that moves up plays where the old one did. Escape cancels.
        </p>
        <div className="row confirm-buttons">
          {canNewTrim && (
            <button type="button" onClick={() => onAnswer(true)}>
              New trim
            </button>
          )}
          <button type="button" onClick={() => onAnswer(false)}>
            Renumber
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
