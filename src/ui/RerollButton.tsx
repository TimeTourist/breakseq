import type { Command } from '../model';
import { useRun } from './context';

/**
 * 🎲: Reroll, new seeds for what `command` reaches, so its random choices pick
 * anew (see Slump och seeds). One undo step: Undo brings back the randomness
 * there was. `label` names it for a screen reader, `title` says what it rolls.
 */
export function RerollButton({
  command,
  label,
  title,
  text,
  onError,
}: {
  command: Command;
  label: string;
  title: string;
  /** Shown beside 🎲 as a whole button ("🎲 Reroll this clip"); then it is also its name, and `label` is not used. */
  text?: string;
  onError?: (error: string | null) => void;
}) {
  const run = useRun();
  return (
    <button
      type="button"
      className={text === undefined ? 'icon-button reroll' : 'reroll-text'}
      aria-label={text === undefined ? label : undefined}
      title={`${title} Undo brings it back.`}
      onClick={(e) => {
        e.stopPropagation();
        // Run first: an optional call would skip its argument when there is no onError.
        const error = run(command);
        onError?.(error);
      }}
    >
      {text === undefined ? <span aria-hidden="true">🎲</span> : `🎲 ${text}`}
    </button>
  );
}
