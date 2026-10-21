import type { ReactNode } from 'react';

/**
 * A control that does nothing just now, greyed out with a short reason, in its
 * title and as text beside it (see Reglage som inte hörs). Magnus beslut.
 */
export function Unheard({ why, when, children }: { readonly why: string; readonly when: boolean; readonly children: ReactNode }) {
  if (!when) return <>{children}</>;
  return (
    <span className="unheard" title={why}>
      {children}
      <span className="unheard-why">{why}</span>
    </span>
  );
}
