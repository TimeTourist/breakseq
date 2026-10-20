import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Asked before a Load that would lose changes since the last save (Magnus
 * beslut): the header's Load, a snapshot's and a backup's all ask the same.
 * Yes loads, Cancel or Escape does nothing.
 */
export function ConfirmLoad({ onAnswer }: { readonly onAnswer: (load: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onAnswer(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onAnswer]);
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className="dialog panel stack confirm-delete" role="alertdialog" aria-modal="true" aria-label="Are you sure?">
        <h2>Are you sure?</h2>
        <p className="muted small">Changes since last save are lost.</p>
        <div className="row confirm-buttons">
          <button type="button" autoFocus onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={() => onAnswer(true)}>
            Yes, load
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
