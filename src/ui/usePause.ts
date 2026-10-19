import { useEffect, useRef } from 'react';

/** How long typing rests before a field's value is used. */
export const TYPING_PAUSE = 600;

/**
 * Calls `commit` once `draft` has rested for a moment, so a field takes its
 * value without leaving it. A null draft is nothing typed. Enter and leaving
 * the field still commit at once, where the field does that.
 */
export function useCommitAfterPause(draft: unknown, commit: () => void): void {
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => {
    if (draft === null) return;
    const timer = setTimeout(() => latest.current(), TYPING_PAUSE);
    return () => clearTimeout(timer);
  }, [draft]);
}
