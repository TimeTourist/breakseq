import { useEffect, useState } from 'react';
import { setBpm } from '../model';
import { useApp, useProject, useRun, useSelect } from './context';
import { describeChange } from './describeChange';
import type { View } from './store';
import { VIEWS } from './store';

const LABELS: Record<View, string> = {
  import: 'Import',
  slice: 'Slice',
  hits: 'Hits',
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
  readonly onExport: () => void;
  readonly status: string | null;
}

export function Header({ onView, playing, canPlay, onPlay, onStop, onExport, status }: HeaderProps) {
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
  useEffect(() => setDraft(String(bpm)), [bpm]);

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
        <button type="button" className="icon-button" aria-label="Play" aria-pressed={playing} disabled={!canPlay} onClick={onPlay}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2.5v11l9-5.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="icon-button" aria-label="Stop" disabled={!playing} onClick={onStop}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
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
        <button type="button" className="primary" disabled={!canPlay} onClick={onExport}>
          Export WAV
        </button>
      </div>
    </header>
  );
}
