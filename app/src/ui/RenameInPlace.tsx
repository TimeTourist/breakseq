import { useState } from 'react';

interface RenameInPlaceProps {
  /** The name now. */
  readonly name: string;
  /** What is renamed, for the button's tooltip and the field's label: "matrix", "pad", "hit". */
  readonly what: string;
  /** Renames it; returns an error to show, or null. */
  readonly onRename: (name: string) => string | null;
  readonly onError: (error: string | null) => void;
}

/**
 * Rename in place (Magnus beslut): a Rename button that turns into a text field
 * where it is. Enter saves, Esc cancels, and leaving the field saves too; a
 * name left empty or unchanged changes nothing. (Claudes val.)
 */
export function RenameInPlace({ name, what, onRename, onError }: RenameInPlaceProps) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null)
    return (
      <button type="button" title={`Rename the ${what}`} aria-label={`Rename ${name}`} onClick={() => setDraft(name)}>
        Rename
      </button>
    );
  const save = () => {
    setDraft(null);
    if (draft.trim() !== '' && draft !== name) onError(onRename(draft));
  };
  return (
    <input
      className="rename-field mono"
      aria-label={`${what[0]!.toUpperCase()}${what.slice(1)} name`}
      // The field takes the place of the button that opened it, so it gets the focus.
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
        }
      }}
      onBlur={save}
    />
  );
}
