import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Trigger } from '../engine';
import type { Project } from '../model';
import { stepDuration } from '../model';
import type { BackupInfo } from './backups';
import { backupDue, summarize } from './backups';
import { followBrowserHistory } from './browserHistory';
import { AppContext, useApp, useProject, useSelect } from './context';
import { Header } from './Header';
import { isTyping } from './isTyping';
import { LoopsView } from './LoopsView';
import { ModsView } from './ModsView';
import { PadsView } from './PadsView';
import { SONG_KEY, subjectOf } from './subject';
import type { Take } from './playback';
import type { Services } from './services';
import { ProjectView } from './ProjectView';
import { SamplesView } from './SamplesView';
import { SongView } from './SongView';
import type { AppState, Selection, Store, View } from './store';
import { VIEWS } from './store';

export const RENDER_DEBOUNCE_MS = 300;
export const SAVE_DEBOUNCE_MS = 1000;


/** Whether two projects render the same: all but the song's loop, which only says what plays over and over. */
export const sameRender = (a: Project, b: Project): boolean =>
  (Object.keys(a) as (keyof Project)[]).every((key) => key === 'song' || a[key] === b[key]) &&
  a.song.bpm === b.song.bpm &&
  a.song.bars === b.song.bars &&
  a.song.clips === b.song.clips;

/** A rendered take of what a view plays, with the subject it was rendered from. */
export interface ShownTake {
  readonly take: Take;
  readonly key: string;
  readonly once: boolean;
}

/**
 * Renders what the view plays (see subjectOf) shortly after every change, and
 * on demand for a new random take. A new subject renders straight away.
 * `held`: the selection Pads plays while the transport runs, so selecting
 * something else there does not change what plays.
 */
function useTake(held: Selection | null) {
  const { services, store } = useApp();
  const latestFull = useProject();
  // Marking or turning the song's loop on or off is no reason for a new take.
  const stable = useRef(latestFull);
  if (stable.current !== latestFull && !sameRender(stable.current, latestFull)) stable.current = latestFull;
  const full = stable.current;
  // Only a change of what plays, not of every selection, renders anew.
  // Read through a ref: holding what already plays is no reason to render it again.
  const heldRef = useRef(held);
  heldRef.current = held;
  const playedState = (s: AppState): AppState => (heldRef.current !== null && s.view === 'pads' ? { ...s, selection: heldRef.current } : s);
  const key = useSelect((s) => subjectOf(full, playedState(s))?.key ?? null);
  // playedState reads the latest held through its ref; only a new key renders anew.
  const subject = useMemo(() => (key === null ? null : subjectOf(full, playedState(store.getState()))), [full, key, store]);
  const [shown, setShown] = useState<ShownTake | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const id = ++latest.current;
    if (subject === null) {
      setShown(null);
      setRendering(false);
      lastKey.current = null;
      return;
    }
    setRendering(true);
    const fresh = subject.key !== lastKey.current;
    lastKey.current = subject.key;
    const timer = setTimeout(
      () => {
        const rng = services.rng();
        // Through a promise, so a render that throws at once is reported like one that fails later.
        Promise.resolve()
          .then(() => (subject.kind === 'song' ? services.renderSong(subject.project, rng) : services.renderPreview(subject.preview(rng))))
          .then((take) => {
            if (id !== latest.current) return;
            setShown({ take, key: subject.key, once: subject.once });
            setError(null);
          })
          .catch((e: unknown) => {
            if (id === latest.current) setError(e instanceof Error ? e.message : String(e));
          })
          .finally(() => {
            if (id === latest.current) setRendering(false);
          });
      },
      fresh ? 0 : RENDER_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [subject, nonce, services]);

  return { shown, rendering, error, newTake: useCallback(() => setNonce((n) => n + 1), []) };
}

/** Shown when an autosave from before Matrix was set aside as a backup. */
const SET_ASIDE_NOTICE = 'Your project from before Matrix was kept as a backup in Project.';

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
  const [notice, setNotice] = useState<string | null>(null);
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
        if (services.storage.setAside?.() === true) {
          setNotice(SET_ASIDE_NOTICE);
          // The old autosave became a backup during the load: the list read before it lacks it.
          services.backups
            ?.list()
            .then(setBackups)
            .catch(() => undefined);
        }
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

  return { error, backups, restore, notice, dismissNotice: () => setNotice(null) };
}

/**
 * The trigger under the playhead and the seconds into the take, polled each
 * frame while playing. `onEnded` runs when what played once has played out.
 */
function usePlayhead(playing: boolean, onEnded: () => void): { trigger: Trigger | null; seconds: number | null } {
  const { services } = useApp();
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const [state, setState] = useState<{ trigger: Trigger | null; seconds: number | null }>({ trigger: null, seconds: null });
  useEffect(() => {
    if (!playing) {
      setState({ trigger: null, seconds: null });
      return;
    }
    let frame = requestAnimationFrame(function tick() {
      if (!services.player.isPlaying()) {
        ended.current();
        return;
      }
      const trigger = services.player.currentTrigger();
      const seconds = services.player.currentPosition();
      setState((last) => (last.trigger === trigger && last.seconds === seconds ? last : { trigger, seconds }));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, services]);
  return state;
}

function Shell() {
  const { store, services } = useApp();
  const view = useSelect((s) => s.view);
  const [playing, setPlaying] = useState(false);
  // What is playing: a subject's key, or a snapshot played from Project, which is not the song.
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  // While it plays, Pads keeps playing the selection it started with; a click on a hit auditions it on top.
  const [held, setHeld] = useState<Selection | null>(null);
  // A new matrix in focus plays whole: what was held was of the matrix before.
  const focusMatrix = useSelect((s) => s.focus.matrix);
  useEffect(() => setHeld((h) => (h === null ? null : { ...h, pad: null, hit: null })), [focusMatrix]);
  const { shown, rendering, error: renderError, newTake } = useTake(held);
  const { error: saveError, backups, restore, notice, dismissNotice } = useAutosave();
  const playhead = usePlayhead(playing, () => {
    setPlaying(false);
    setPlayingKey(null);
    setHeld(null);
  });
  const bpm = useSelect((s) => s.history.present.song.bpm);
  const songLoop = useSelect((s) => s.history.present.song.loop ?? null);
  const step = stepDuration(bpm);
  // Only the song has a cursor and a loop; a snapshot or a preview plays as it is.
  const songPlays = playingKey === SONG_KEY;
  const songTake = shown?.key === SONG_KEY ? shown.take : null;

  const setView = useCallback((v: View) => store.dispatch({ type: 'view', view: v }), [store]);

  const loopRange = (song: boolean) => (song && songLoop?.on === true ? { start: songLoop.start * step, end: songLoop.end * step } : null);
  useEffect(() => {
    services.player.setLoop(loopRange(songPlays));
    // loopRange is made from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, songPlays, songLoop, step]);

  const start = (next: ShownTake) => {
    // One thing plays at a time: an audition, as of a file or a slice, stops.
    services.player.stopAudition();
    services.player.setLoop(loopRange(next.key === SONG_KEY));
    services.player.play(next.take, next.key === SONG_KEY ? store.getState().songCursor * step : 0, next.once);
    setPlayingKey(next.key);
    setPlaying(true);
    const now = store.getState();
    setHeld((h) => (now.view !== 'pads' ? null : (h ?? now.selection)));
  };
  const play = () => {
    if (shown !== null) start(shown);
  };
  const stop = () => {
    services.player.stop();
    setPlaying(false);
    setPlayingKey(null);
    setHeld(null);
  };

  // While playing, a new render of the same thing takes over where its loop ends;
  // something else, as after a change of view, starts straight away.
  const following = useRef({ playing, playingKey });
  following.current = { playing, playingKey };
  useEffect(() => {
    if (!following.current.playing) return;
    // A view with nothing to play stops what played, unless it is a snapshot from Project.
    if (shown === null) {
      if (following.current.playingKey !== 'snapshot') stop();
      return;
    }
    if (shown.key === following.current.playingKey) services.player.replace(shown.take);
    else start(shown);
    // Only a new take decides this; start reads the latest of the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, services]);

  // The keyboard handler is set up once and reads the latest of these.
  const toggle = useRef(() => {});
  toggle.current = () => (playing ? stop() : play());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        store.dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.dispatch({ type: 'redo' });
      } else if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Space plays and stops, also with a button focused, which it would otherwise press.
        e.preventDefault();
        if (!e.repeat) toggle.current();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-6]$/.test(e.key)) {
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
        canPlay={shown !== null}
        onPlay={play}
        onStop={stop}
        status={status}
      />
      {notice !== null && (
        <p className="notice row" role="status">
          {notice}
          <button type="button" aria-label="Dismiss notice" onClick={dismissNotice}>
            Dismiss
          </button>
        </p>
      )}
      {view === 'samples' && (
        <SamplesView
          transport={{
            playingKey: playing && playingKey !== 'snapshot' ? playingKey : null,
            seconds: playhead.seconds,
            duration: playing && shown?.key === playingKey ? shown.take.buffer.duration : null,
            onPlay: play,
            onStop: stop,
          }}
        />
      )}
      {view === 'pads' && (
        <PadsView
          transport={{
            playing: playing && playingKey !== 'snapshot',
            onToggle: () => toggle.current(),
            played:
              playing && playingKey !== null && playhead.seconds !== null && shown?.key === playingKey
                ? { key: playingKey, seconds: playhead.seconds, duration: shown.take.buffer.duration }
                : null,
          }}
        />
      )}
      {view === 'loops' && <LoopsView playhead={playhead.trigger} />}
      {view === 'mods' && <ModsView />}
      {view === 'project' && (
        <ProjectView
          canExport={songTake !== null}
          onExport={() => {
            if (songTake !== null) services.exportWav(songTake);
          }}
          onExportMidi={() => (songTake === null ? Promise.resolve(0) : services.exportMidi(store.getState().history.present, songTake))}
          onExportRex={() => (songTake === null ? Promise.resolve(0) : services.exportRex(store.getState().history.present, songTake))}
          backups={services.backups === undefined ? null : backups}
          onRestore={restore}
          onPlayTake={(snapshotTake) => {
            services.player.play(snapshotTake);
            setPlayingKey('snapshot');
            setPlaying(true);
          }}
        />
      )}
      {view === 'song' && (
        <SongView
          playheadSeconds={songPlays ? playhead.seconds : null}
          stepSeconds={step}
          rendering={rendering}
          onNewTake={newTake}
          onSeek={(at) => {
            if (playing && songPlays) services.player.seek(at * step);
          }}
        />
      )}
    </div>
  );
}

export function App({ store, services }: { readonly store: Store; readonly services: Services }) {
  const value = useMemo(() => ({ store, services }), [store, services]);
  // Browser Back and Forward go between tabs.
  useEffect(() => followBrowserHistory(store), [store]);
  return (
    <AppContext.Provider value={value}>
      <Shell />
    </AppContext.Provider>
  );
}
