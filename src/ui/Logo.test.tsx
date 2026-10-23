// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logo, MAD_MS, MAX_WAIT_MS, MIN_WAIT_MS } from './Logo';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the logo', () => {
  it('is the happy smiley, named Breakseq, and now and then turns crazy for a moment', () => {
    vi.useFakeTimers();
    render(<Logo rng={() => 0.5} />);
    const logo = screen.getByRole('img', { name: 'Breakseq' });
    expect(logo.classList.contains('mad')).toBe(false);
    act(() => vi.advanceTimersByTime(MIN_WAIT_MS + (MAX_WAIT_MS - MIN_WAIT_MS) / 2));
    expect(logo.classList.contains('mad')).toBe(true);
    act(() => vi.advanceTimersByTime(MAD_MS));
    expect(logo.classList.contains('mad')).toBe(false);
  });

  it('waits at least the shortest wait', () => {
    vi.useFakeTimers();
    render(<Logo rng={() => 0} />);
    act(() => vi.advanceTimersByTime(MIN_WAIT_MS - 1));
    expect(screen.getByRole('img', { name: 'Breakseq' }).classList.contains('mad')).toBe(false);
  });
});
