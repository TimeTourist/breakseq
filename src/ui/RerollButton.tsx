import type { Command } from '../model';
import { useRun } from './context';

/**
 * 🎲: Reroll, new seeds for what `command` reaches, so its random choices pick
 * anew (see Slump och seeds). One undo step: Undo brings back the randomness
 * there was. `label` names it for a screen reader, `title` says what it rolls.
 */
export function RerollButton({ command, label, title, onError }: { command: Command; label: string; title: string; onError?: (error: string | null) => void }) {
  const run = useRun();
  return (
    <button
      type="button"
      className="icon-button reroll"
      aria-label={label}
      title={`${title} Undo brings it back.`}
      onClick={(e) => {
        e.stopPropagation();
        // Run first: an optional call would skip its argument when there is no onError.
        const error = run(command);
        onError?.(error);
      }}
    >
      <span aria-hidden="true">🎲</span>
    </button>
  );
}
