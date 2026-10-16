import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Trigger } from '../engine';
import { loopSong, modPreviewSong } from '../engine';
import type { Project } from '../model';
import { stepDuration } from '../model';
import type { BackupInfo } from './backups';
import { backupDue, summarize } from './backups';
import { AppContext, useApp, useProject, useSelect } from './context';
import { Header } from './Header';
import { HitsView } from './HitsView';
import { ImportView } from './ImportView';
import { LoopsView, currentLoopId } from './LoopsView';
import { ModsView, currentModId, previewLoopId } from './ModsView';
import type { Take } from './playback';
import type { Services } from './services';
import { SliceView } from './SliceView';
import { ProjectView } from './ProjectView';
import { SongView } from './SongView';
import type { Store, View } from './store';
import { VIEWS } from './store';

export const RENDER_DEBOUNCE_MS = 300;
export const SAVE_DEBOUNCE_MS = 1000;


const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Renders what the view plays shortly after every change, and on demand for a new
 * random take: the selected loop in Loops, the song everywhere else.
 */
function useTake() {
  const { services } = useApp();
  const full = useProject();
  const view = useSelect((s) => s.view);
  const loopId = useSelect((s) =>
    s.view === 'loops' ? currentLoopId(s.history.present, s.selection) : s.view === 'mods' ? previewLoopId(s.history.present, s.selection) : null,
  );
  const modId = useSelect((s) => (s.view === 'mods' ? currentModId(s.history.present, s.selection) : null));
  const project = useMemo(() => {
    if (view === 'loops' && loopId !== null) return loopSong(full, loopId);
    if (view === 'mods' && loopId !== null && modId !== null) return modPreviewSong(full, modId, loopId);
    if (view === 'mods' && loopId !== null) return loopSong(full, loopId);
    return full;
  }, [full, view, loopId, modId]);
  const [take, setTake] = useState<Take | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    setRendering(true);
    const timer = setTimeout(() => {
      services
        .renderSong(project, services.rng())
        .then((next) => {
          if (id !== latest.current) return;
          setTake(next);
          setError(null);
          services.player.replace(next);
        })
        .catch((e: unknown) => {
          if (id === latest.current) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (id === latest.current) setRendering(false);
        });
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [project, nonce, services]);

  return { take, rendering, error, newTake: useCallback(() => setNonce((n) => n + 1), []) };
}

/**
 * Loads the saved project once, then saves shortly after every change. If the
 * saved project could not be loaded, nothing is saved: saving would write the
 * empty project over the one that is still there.
 *
 * Backups: the project as loaded, before anything changes it, then at most
 * one every BACKUP_EVERY_MS while it changes. Restoring one first keeps the
 * work as a backup, so a restore can be undone with another.
 */
function useAutosave() {
  const { store, services } = useApp();
  const project = useProject();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<readonly BackupInfo[]>([]);
  const lastBackup = useRef<number | null>(null);

  const keep = useCallback(
    async (kept: Project) => {
      if (services.backups === undefined) return;
      const now = Date.now();
      lastBackup.current = now;
      await services.backups.add(kept, summarize(kept, store.getState().projectFolder.active?.name ?? null), now);
      setBackups(await services.backups.list());
    },
    [services, store],
  );

  useEffect(() => {
    services.backups
      ?.list()
      .then(setBackups)
      .catch(() => undefined);
    services.storage
      .load()
      .then((saved) => {
        if (saved !== null) store.dispatch({ type: 'load', project: saved });
        setLoaded(true);
        if (saved !== null) keep(saved).catch(() => setError('Could not keep a backup of the autosave'));
      })
      .catch(() => setError('Could not load the saved project. Autosave is off so it is not overwritten; restore a backup in Project, or reload the page to try again.'));
  }, [store, services, keep]);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      services.storage
        .save(project)
        .then(() => {
          setError(null);
          if (backupDue(lastBackup.current, Date.now())) return keep(project);
        })
        .catch(() => setError('Autosave failed'));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [project, loaded, services, keep]);

  /** Swaps in a backup, as Load does, after keeping the work as one. Autosave is on from then. */
  const restore = useCallback(
    async (id: string) => {
      if (services.backups === undefined) return;
      if (loaded) await keep(store.getState().history.present);
      const restored = await services.backups.restore(id);
      store.dispatch({ type: 'load', project: restored });
      // What was restored is a backup already: the next is due BACKUP_EVERY_MS from now.
      lastBackup.current = Date.now();
      setLoaded(true);
      setError(null);
    },
    [services, store, loaded, keep],
  );

  return { error, backups, restore };
}

/** The trigger under the playhead and the seconds into the take, polled each frame while playing. */
function usePlayhead(playing: boolean): { trigger: Trigger | null; seconds: number | null } {
  const { services } = useApp();
  const [state, setState] = useState<{ trigger: Trigger | null; seconds: number | null }>({ trigger: null, seconds: null });
  useEffect(() => {
    if (!playing) {
      setState({ trigger: null, seconds: null });
      return;
    }
    let frame = requestAnimationFrame(function tick() {
      setState({ trigger: services.player.currentTrigger(), seconds: services.player.currentPosition() });
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, services]);
  return state;
}

function Shell() {
  const { store, services } = useApp();
  const view = useSelect((s) => s.view);
  const { take, rendering, error: renderError, newTake } = useTake();
  const { error: saveError, backups, restore } = useAutosave();
  const [playing, setPlaying] = useState(false);
  const playhead = usePlayhead(playing);
  const bpm = useSelect((s) => s.history.present.song.bpm);

  const setView = useCallback((v: View) => store.dispatch({ type: 'view', view: v }), [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        store.dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.dispatch({ type: 'redo' });
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-8]$/.test(e.key)) {
        setView(VIEWS[Number(e.key) - 1]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, setView]);

  const status = renderError !== null ? `Render failed: ${renderError}` : saveError;

  return (
    <div className="app">
      <Header
        onView={setView}
        playing={playing}
        canPlay={take !== null}
        onPlay={() => {
          if (take === null) return;
          services.player.play(take);
          setPlaying(true);
        }}
        onStop={() => {
          services.player.stop();
          setPlaying(false);
        }}
        status={status}
      />
      {view === 'import' && <ImportView />}
      {view === 'slice' && <SliceView />}
      {view === 'hits' && <HitsView />}
      {view === 'loops' && <LoopsView playhead={playhead.trigger} />}
      {view === 'mods' && <ModsView />}
      {view === 'project' && (
        <ProjectView
          canExport={take !== null}
          onExport={() => {
            if (take !== null) services.exportWav(take);
          }}
          onExportMidi={() => (take === null ? Promise.resolve(0) : services.exportMidi(store.getState().history.present, take))}
          backups={services.backups === undefined ? null : backups}
          onRestore={restore}
          onPlayTake={(snapshotTake) => {
            services.player.play(snapshotTake);
            setPlaying(true);
          }}
        />
      )}
      {view === 'song' && (
        <SongView playheadSeconds={playhead.seconds} stepSeconds={stepDuration(bpm)} rendering={rendering} onNewTake={newTake} />
      )}
    </div>
  );
}

export function App({ store, services }: { readonly store: Store; readonly services: Services }) {
  const value = useMemo(() => ({ store, services }), [store, services]);
  return (
    <AppContext.Provider value={value}>
      <Shell />
    </AppContext.Provider>
  );
}
