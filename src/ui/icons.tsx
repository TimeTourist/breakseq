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

/** Trim: the two corners of a crop. */
export function CropIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1v11h11M1 4h11v11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A new trim: a crop with a plus. */
export function NewCropIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
      <path d="M1 4.5h5M3.5 2v5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 1v11h11M5 4h11v11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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
