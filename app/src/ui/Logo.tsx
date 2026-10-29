import { useEffect, useState } from 'react';
import { CrazySmiley, HappySmiley } from './icons';

/** How long the crazy face shows, and the wait before it comes again (Claudes val). */
export const MAD_MS = 1400;
export const MIN_WAIT_MS = 20_000;
export const MAX_WAIT_MS = 60_000;

/**
 * The logo: the happy acid smiley, which now and then turns into the crazy
 * one for a moment. It means nothing; it is fun to look at (Magnus beslut
 * 2026-10-23). `rng` picks the waits; the view is the only place it is used.
 */
export function Logo({ rng = Math.random }: { readonly rng?: () => number }) {
  const [mad, setMad] = useState(false);
  useEffect(() => {
    const wait = mad ? MAD_MS : MIN_WAIT_MS + rng() * (MAX_WAIT_MS - MIN_WAIT_MS);
    const timer = setTimeout(() => setMad(!mad), wait);
    return () => clearTimeout(timer);
  }, [mad, rng]);
  return (
    <div className={`brand${mad ? ' mad' : ''}`} role="img" aria-label="Breakseq" title="Breakseq">
      <HappySmiley size={30} />
      <CrazySmiley size={30} />
    </div>
  );
}
