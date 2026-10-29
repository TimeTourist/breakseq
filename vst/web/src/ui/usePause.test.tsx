// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TYPING_PAUSE, useCommitAfterPause } from './usePause';

afterEach(() => vi.useRealTimers());

describe('a field takes its value when typing rests, without leaving it', () => {
  it('commits once the draft has rested, not while it changes, and not for no draft', () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { rerender } = renderHook(({ draft }: { draft: string | null }) => useCommitAfterPause(draft, commit), { initialProps: { draft: null as string | null } });
    vi.advanceTimersByTime(TYPING_PAUSE * 2);
    expect(commit).not.toHaveBeenCalled();
    rerender({ draft: '1' });
    vi.advanceTimersByTime(TYPING_PAUSE - 100);
    rerender({ draft: '16' });
    vi.advanceTimersByTime(TYPING_PAUSE - 100);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
