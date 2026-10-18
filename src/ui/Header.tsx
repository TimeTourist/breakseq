import { useEffect, useState } from 'react';
import { setBpm } from '../model';
import { useApp, useProject, useRun, useSelect } from './context';
import { useSnapshots } from './snapshots';
import { describeChange } from './describeChange';
import type { View } from './store';
import { VIEWS } from './store';

const LABELS: Record<View, string> = {
  samples: 'Samples',
  pads: 'Pads',
  loops: 'Loops',
  mods: 'Mods',
  song: 'Song',
  project: 'Project',
};

interface HeaderProps {
  readonly onView: (view: View) => void;
  readonly playing: boolean;
  readonly canPlay: boolean;
  readonly onPlay: () => void;
  readonly onStop: () => void;
  readonly status: string | null;
}

export function Header({ onView, playing, canPlay, onPlay, onStop, status }: HeaderProps) {
  const view = useSelect((s) => s.view);
  const { store } = useApp();
  const history = useSelect((s) => s.history);
  const previous = history.past.at(-1);
  const next = history.future[0];
  const undoText = previous === undefined ? 'Nothing to undo' : `Undo: ${describeChange(previous, history.present)} (Ctrl+Z)`;
  const redoText = next === undefined ? 'Nothing to redo' : `Redo: ${describeChange(history.present, next)} (Ctrl+Shift+Z)`;
  const bpm = useProject().song.bpm;
  const run = useRun();
  const [draft, setDraft] = useState(String(bpm));
  useEffect(() => {
    setDraft(String(bpm));
  }, [bpm]);

  const commitBpm = () => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0 || run(setBpm(Math.min(400, value))) !== null) setDraft(String(bpm));
  };

  return (
    <header className="header">
      <div className="brand">BREAKSEQ</div>
      <nav aria-label="Pipeline" className="tabs">
        {VIEWS.map((v, i) => (
          <button
            key={v}
            type="button"
            className="tab"
            aria-current={v === view ? 'page' : undefined}
            onClick={() => onView(v)}
          >
            <span className="tab-num">{i + 1}</span>
            <span>{LABELS[v]}</span>
          </button>
        ))}
      </nav>
      <div className="transport">
        {status !== null && <span className="status">{status}</span>}
        <button
          type="button"
          className="icon-button"
          aria-label={undoText}
          title={undoText}
          disabled={previous === undefined}
          onClick={() => store.dispatch({ type: 'undo' })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 4L2 7l3 3M2.5 7H10a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={redoText}
          title={redoText}
          disabled={next === undefined}
          onClick={() => store.dispatch({ type: 'redo' })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11 4l3 3-3 3M13.5 7H6a3.5 3.5 0 0 0 0 7h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* One button, as everywhere: Play, and Stop while it plays. */}
        <button
          type="button"
          className="icon-button"
          aria-label={playing ? 'Stop' : 'Play'}
          title={playing ? 'Stop' : 'Play'}
          disabled={!playing && !canPlay}
          onClick={playing ? onStop : onPlay}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 2.5v11l9-5.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <label className="bpm">
          <input
            aria-label="Tempo in BPM"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span>BPM</span>
        </label>
        <SnapshotButtons />
      </div>
    </header>
  );
}

/**
 * Save over the active snapshot, or keep the work as a new one with a name.
 * Both need a project folder, opened in Project.
 */
function SnapshotButtons() {
  const { folder, active, changed, save, newSnapshot } = useSnapshots();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noFolder = 'Open a project folder in Project first';

  const attempt = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const saveTitle = folder === null ? noFolder : active === null ? 'No snapshot is active yet: use New snapshot' : changed ? `Save the work over “${active.name}”` : `“${active.name}” has no changes to save`;

  return (
    <div className="snapshot-buttons">
      {error !== null && (
        <span className="status error" role="alert">
          {error}
        </span>
      )}
      <button type="button" disabled={busy || folder === null || active === null || !changed} title={saveTitle} onClick={() => attempt(save)}>
        Save
      </button>
      <button
        type="button"
        // Primary only while it can be used: switched off it looks like any button that is off.
        className={busy || folder === null ? undefined : 'primary'}
        aria-expanded={naming}
        disabled={busy || folder === null}
        title={folder === null ? noFolder : 'Keep the work as a new snapshot'}
        onClick={() => setNaming((n) => !n)}
      >
        New snapshot
      </button>
      {naming && (
        <form
          className="snapshot-popover panel row"
          onSubmit={(e) => {
            e.preventDefault();
            attempt(async () => {
              await newSnapshot(name);
              setName('');
              setNaming(false);
            });
          }}
        >
          <input
            aria-label="New snapshot name"
            autoFocus
            placeholder="Name, e.g. Hek-tick Amen groove"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(false);
            }}
          />
          <button type="submit" className="primary" disabled={busy}>
            Keep
          </button>
        </form>
      )}
    </div>
  );
}
