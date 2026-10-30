import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context';
import { runSongToAudio, runSongToMidi, runSongToRex } from './song-to';

/**
 * Asked before Song to MIDI rebuilds the keys (Magnus beslut): the frozen
 * sounds would change, so MIDI clips already in Reason could play the wrong
 * ones. Yes rebuilds, Cancel or Escape leaves everything as it was.
 */
export function ConfirmKeys({ onAnswer }: { readonly onAnswer: (rebuild: boolean) => void }) {
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
      <div className="dialog panel stack confirm-delete" role="alertdialog" aria-modal="true" aria-label="Rebuild the keys?">
        <h2>Rebuild the keys?</h2>
        <p className="muted small">The song’s sounds have changed, so the keys get new sounds. MIDI clips already in Reason may play the wrong sounds.</p>
        <p className="muted small">To keep them, cancel and make a new instance, or use Duplicate Device in Reason first.</p>
        <div className="row confirm-buttons">
          <button type="button" autoFocus onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={() => onAnswer(true)}>
            Yes, rebuild
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Song to Audio, Song to MIDI and Song to REX, pressed in the plugin's bar: renders the
 * song as it is now and hands the files to the bar. One at a time.
 */
export function SongTo() {
  const { store, services } = useApp();
  const host = services.host;
  const [asking, setAsking] = useState<((rebuild: boolean) => void) | null>(null);
  const busy = useRef(false);

  const ask = useCallback(() => new Promise<boolean>((resolve) => setAsking(() => resolve)), []);
  const answer = useCallback(
    (rebuild: boolean) => {
      asking?.(rebuild);
      setAsking(null);
    },
    [asking],
  );

  useEffect(() => {
    if (host === undefined) return;
    return host.onSongTo((kind) => {
      if (busy.current) return;
      busy.current = true;
      const project = store.getState().history.present;
      const done = kind === 'audio' ? runSongToAudio(project, host) : kind === 'rex' ? runSongToRex(project, host) : runSongToMidi(project, host, ask);
      void done.finally(() => (busy.current = false));
    });
  }, [host, store, ask]);

  return asking === null ? null : <ConfirmKeys onAnswer={answer} />;
}
