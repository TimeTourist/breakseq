export function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" fill="currentColor" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v5M9.2 6.5v5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A new sample of a file: a waveform with a plus. (Magnus beslut) */
export function NewSampleIcon() {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
      <path d="M1.5 7.5v1M4 5v6M6.5 2.5v11M9 6v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 4v6M11 7h6" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Fold a file in the list: a triangle pointing down, turned to point right when folded. */
export function FoldIcon({ folded }: { readonly folded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={folded ? { transform: 'rotate(-90deg)' } : undefined}>
      <path d="M1 3h10L6 10z" fill="currentColor" />
    </svg>
  );
}

/** Collapse all (chevrons pointing in) or Expand all (pointing out). */
export function FoldAllIcon({ folded }: { readonly folded: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={folded ? undefined : { transform: 'rotate(180deg)' }}>
      <path d="M4 3l4 4 4-4M4 9l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** What a matrix is, by how many pads it has: a break (rows of pads) or a one-shot (one pad). */
export function MatrixKindIcon({ kind }: { readonly kind: 'break' | 'one-shot' }) {
  return (
    <span className="matrix-kind" role="img" aria-label={kind} title={kind === 'break' ? 'Break: more than one pad' : 'One-shot: one pad'}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        {kind === 'break' ? (
          <path d="M2 3.5h12M2 8h12M2 12.5h12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : (
          <circle cx="8" cy="8" r="3.5" fill="currentColor" />
        )}
      </svg>
    </span>
  );
}

/** Pin a matrix in Matrices: a thumbtack. */
export function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z" />
      <path d="M8 8.5V14" />
    </svg>
  );
}
