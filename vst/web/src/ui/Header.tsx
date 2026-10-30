import { useEffect, useMemo, useState } from 'react';
import { rerollAll, setBpm } from '../model';
import { useApp, useProject, useRun, useSelect } from './context';
import { ConfirmLoad } from './ConfirmLoad';
import { Logo } from './Logo';
import { RerollButton } from './RerollButton';
import { useSnapshots } from './snapshots';
import { useCommitAfterPause } from './usePause';
import { describeChange } from './describeChange';
import type { View } from './store';
import { VIEWS } from './store';
import type { Context, Crumb, Jump, Step } from './crumbs';
import { isMenu, trail } from './crumbs';

const LABELS: Record<View, string> = {
  samples: 'Samples',
  pads: 'Matrices',
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
  /** A render of what Play plays is under way. */
  readonly rendering?: boolean;
}

export function Header({ onView, playing, canPlay, onPlay, onStop, status, rendering = false }: HeaderProps) {
  const view = useSelect((s) => s.view);
  const loop = useSelect((s) => s.loop);
  const { store, services } = useApp();
  /** In the plugin the tempo is Reason's: shown, not typed (Magnus beslut). */
  const hostTempo = services.host !== undefined;
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

  /** `pausing`: typing rested; a value on the way that is not a tempo yet waits for more. */
  const commitBpm = (pausing = false) => {
    const value = Number(draft);
    const valid = draft.trim() !== '' && Number.isFinite(value) && value > 0;
    if (pausing && (!valid || value === bpm)) return;
    if (!valid || run(setBpm(Math.min(400, value))) !== null) setDraft(String(bpm));
  };
  useCommitAfterPause(draft === String(bpm) ? null : draft, () => commitBpm(true));

  return (
    <header className="header">
      <Logo />
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
        {/* On every tab, while what Play plays renders: always there, so the header does not move. (Claudes val) */}
        <span className="rendering muted small" role="status" aria-hidden={!rendering} style={{ visibility: rendering ? 'visible' : 'hidden' }}>
          Rendering…
        </span>
        <label className="bpm" title={hostTempo ? 'The tempo is Reason’s: change it in Reason' : undefined}>
          <input
            aria-label="Tempo in BPM"
            inputMode="decimal"
            readOnly={hostTempo}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitBpm()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span>BPM</span>
        </label>
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
        {/* Loop, on to begin with: Play plays over and over, else once, on every tab. (Magnus beslut) */}
        <button
          type="button"
          className="loop-toggle"
          aria-pressed={loop}
          title={loop ? 'Play plays it over and over (in Song, its loop region if it has one): click to play it once' : 'Play plays it once, to the end: click to loop it'}
          onClick={() => store.dispatch({ type: 'loop', on: !loop })}
        >
          Loop
        </button>
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
        <RerollButton command={rerollAll()} label="Reroll everything" title="Reroll everything: new random choices for every pad, matrix, mod and clip in the project." />
        <SnapshotButtons />
      </div>
      <Crumbs />
    </header>
  );
}

/** Plain text before a step: the file before its sample, never a link. (Magnus beslut) */
function ContextText({ context }: { readonly context: Context | undefined }) {
  if (context === undefined) return null;
  return (
    <>
      <span className="crumb-context" title={context.title}>
        {context.label}
      </span>
      <span className="crumb-sep" aria-hidden="true">
        ·
      </span>
    </>
  );
}

/**
 * The link row under the tabs, always in the same place (Magnus beslut): the
 * same chain on every tab, one step per tab (file · sample › matrices ›
 * loops › mods › ♪ Song). The tab one is on is plain text, larger; every
 * other step links there, with a count, or is a slim menu when there are several.
 */
function Crumbs() {
  const { store } = useApp();
  const state = useSelect((s) => s);
  const now = useMemo(() => trail(state), [state]);
  const go = (jump: Jump) => jump.go.forEach((action) => store.dispatch(action));
  const crumb = (c: Crumb) =>
    isMenu(c) ? (
      <select
        className="crumb-menu"
        aria-label={c.label}
        title={c.title}
        value=""
        onChange={(e) => {
          const picked = c.items[Number(e.target.value)];
          if (picked !== undefined) go(picked);
        }}
      >
        <option value="" disabled>
          {c.label}
        </option>
        {c.items.map((item, i) => (
          <option key={i} value={i} title={item.title}>
            {item.label}
          </option>
        ))}
      </select>
    ) : (
      <>
        <ContextText context={c.context} />
        <button type="button" className="link-text" title={c.title} onClick={() => go(c)}>
          {c.label}
        </button>
      </>
    );
  const step = (s: Step) =>
    s.kind === 'link' ? (
      crumb(s.crumb)
    ) : (
      <>
        <ContextText context={s.current.context} />
        <span className="crumb-current" aria-current="location" title={s.current.title}>
          {s.current.label}
        </span>
        {s.current.detail !== undefined && <span className="crumb-detail">{s.current.detail}</span>}
      </>
    );
  return (
    <nav aria-label="Where you are" className="crumbs">
      {now.steps.map((s, i) => (
        <span key={i} className="crumb">
          {i > 0 && (
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          {step(s)}
        </span>
      ))}
      {now.song && (
        <span className="crumb">
          {now.steps.length > 0 && (
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          <button type="button" className="link-text in-song" title="Heard in the song: open Song" onClick={() => store.dispatch({ type: 'view', view: 'song' })}>
            ♪ Song →
          </button>
        </span>
      )}
    </nav>
  );
}

/**
 * Save over the active snapshot, or keep the work as a new one with a name.
 * Both need a project, opened in Project.
 */
function SnapshotButtons() {
  const { folder, active, changed, save, newSnapshot, load } = useSnapshots();
  const [naming, setNaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noFolder = 'Open or make a project in Project first';

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
      {/* Load the active snapshot as last saved: off with nothing changed, as Save is, and it asks first (Magnus beslut). */}
      <button
        type="button"
        disabled={busy || folder === null || active === null || !changed}
        title={folder === null ? noFolder : 'Load the active snapshot as last saved'}
        onClick={() => setConfirming(true)}
      >
        Load
      </button>
      {confirming && active !== null && (
        <ConfirmLoad
          onAnswer={(yes) => {
            setConfirming(false);
            if (yes) attempt(() => load(active));
          }}
        />
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
