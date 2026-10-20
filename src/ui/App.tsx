import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Trigger } from '../engine';
import { isRenderCancelled, sameHeard } from '../engine';
import type { Project, Rng } from '../model';
import { stepDuration } from '../model';
import type { BackupInfo } from './backups';
import { backupDue, summarize } from './backups';
import { followBrowserHistory } from './browserHistory';
import { AppContext, useApp, useProject, useSelect } from './context';
import { Header } from './Header';
import { isTyping, modalOpen } from './isTyping';
import { LoopsView } from './LoopsView';
import { ModsView } from './ModsView';
import { PadsView } from './PadsView';
import type { Subject } from './subject';
import { SONG_KEY, subjectOf } from './subject';
import type { Take } from './playback';
import type { Services } from './services';
import { ProjectView } from './ProjectView';
import { SamplesView } from './SamplesView';
import { SongView } from './SongView';
import type { Store, View } from './store';
import { VIEWS } from './store';

export const RENDER_DEBOUNCE_MS = 300;
export const SAVE_DEBOUNCE_MS = 1000;


/** A rendered take of what a view plays, with the subject it was rendered from. */
export interface ShownTake {
  readonly take: Take;
  readonly key: string;
  readonly once: boolean;
}

/**
 * Randomness that a render of the same thing can draw again: every render of
 * a subject gets the same numbers, in the same order, until `reset`. A change
 * then keeps what Random and No repeat picked, so it is the change that is
 * heard; New take, or another subject, picks anew. (Claudes val.)
 */
function replayable(fresh: () => Rng) {
  let drawn: number[] = [];
  let source: Rng | null = null;
  return {
    reset: () => {
      drawn = [];
      source = null;
    },
    rng: (): Rng => {
      source ??= fresh();
      const from = source;
      const values = drawn;
      let i = 0;
      return () => {
        if (i === values.length) values.push(from());
        return values[i++]!;
      };
    },
  };
}

/**
 * Renders what the view plays (see subjectOf) shortly after every change that
 * can be heard in it, and on demand for a new random take. A new subject
 * renders straight away. A change while a render is under way cancels it: only
 * the newest render runs to the end.
 */
function useTake() {
  const { services, store } = useApp();
  const project = useProject();
  // Only a change of what plays, not of every selection, renders anew.
  const key = useSelect((s) => subjectOf(project, s)?.key ?? null);
  // Only a new key renders anew; the rest of the state is read as it is then.
  const latestSubject = useMemo(() => (key === null ? null : subjectOf(project, store.getState())), [project, key, store]);
  // A change that is not heard in it, as a new name or a matrix it does not play, renders nothing.
  const stable = useRef<Subject | null>(null);
  if (latestSubject === null) stable.current = null;
  else if (stable.current === null || stable.current.key !== latestSubject.key || !sameHeard(stable.current.sound, latestSubject.sound)) stable.current = latestSubject;
  const subject = stable.current;
  const [shown, setShown] = useState<ShownTake | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  const lastKey = useRef<string | null>(null);
  const lastNonce = useRef(nonce);
  const random = useRef<ReturnType<typeof replayable> | null>(null);
  random.current ??= replayable(() => services.rng());

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
    // Something else, or New take: new random picks.
    if (fresh || nonce !== lastNonce.current) random.current!.reset();
    lastNonce.current = nonce;
    const controller = new AbortController();
    const request = { signal: controller.signal };
    const timer = setTimeout(
      () => {
        const rng = random.current!.rng();
        // Through a promise, so a render that throws at once is reported like one that fails later.
        Promise.resolve()
          .then(() => (subject.kind === 'song' ? services.renderSong(subject.project, rng, request) : services.renderPreview(subject.preview(rng), request)))
          .then((take) => {
            if (id !== latest.current) return;
            // The same audio as what is shown, as when nothing heard changed: nothing to swap in.
            setShown((before) => (before !== null && before.key === subject.key && before.take.buffer === take.buffer && before.once === subject.once ? before : { take, key: subject.key, once: subject.once }));
            setError(null);
          })
          .catch((e: unknown) => {
            if (id === latest.current && !isRenderCancelled(e)) setError(e instanceof Error ? e.message : String(e));
          })
          .finally(() => {
            if (id === latest.current) setRendering(false);
          });
      },
      fresh ? 0 : RENDER_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [subject, nonce, services]);

  return { shown, rendering, error, key, newTake: useCallback(() => setNonce((n) => n + 1), []) };
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
  const { shown, rendering, error: renderError, newTake, key: playsKey } = useTake();
  const { error: saveError, backups, restore, notice, dismissNotice } = useAutosave();
  const playhead = usePlayhead(playing, () => {
    setPlaying(false);
    setPlayingKey(null);
  });
  const bpm = useSelect((s) => s.history.present.song.bpm);
  const songLoop = useSelect((s) => s.history.present.song.loop ?? null);
  // Loop in the header, on every tab: off, what Play plays plays once, the song from its start point to its end. (Magnus beslut)
  const loopOn = useSelect((s) => s.loop);
  const onceOf = (take: ShownTake) => take.once || !loopOn;
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
    services.player.play(next.take, next.key === SONG_KEY ? store.getState().songCursor * step : 0, onceOf(next));
    setPlayingKey(next.key);
    setPlaying(true);
  };
  const play = () => {
    if (shown !== null) start(shown);
  };
  const stop = () => {
    services.player.stop();
    setPlaying(false);
    setPlayingKey(null);
  };

  // While playing, a new render of the same thing takes over as soon as it can
  // (Magnus beslut); something else, as after a change of view, starts straight away.
  // A snapshot played from Project goes on until the view changes: a change to the project is not it.
  const snapshotView = useRef<View | null>(null);
  const following = useRef({ playing, playingKey, view });
  following.current = { playing, playingKey, view };
  useEffect(() => {
    const now = following.current;
    if (!now.playing) return;
    if (now.playingKey === 'snapshot' && now.view === snapshotView.current) return;
    // A view with nothing to play stops what played, unless it is a snapshot from Project.
    if (shown === null) {
      if (now.playingKey !== 'snapshot') stop();
      return;
    }
    if (shown.key === now.playingKey) services.player.replace(shown.take);
    else start(shown);
    // Only a new take decides this; start reads the latest of the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, services]);

  // Leaving Project while a snapshot plays: the new view's sound starts, also when it is the song already rendered.
  useEffect(() => {
    const now = following.current;
    if (now.playing && now.playingKey === 'snapshot' && view !== snapshotView.current && shown !== null && shown.key === playsKey) start(shown);
    // Only the view decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Loop switched while something plays: it starts again, looped or once (the song from its start point).
  useEffect(() => {
    const { playing: now, playingKey: key } = following.current;
    if (now && key !== null && key !== 'snapshot' && shown?.key === key) start(shown);
    // Only Loop decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopOn]);

  // The keyboard handler is set up once and reads the latest of these.
  const toggle = useRef(() => {});
  toggle.current = () => (playing ? stop() : play());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || modalOpen()) return;
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
        rendering={rendering}
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
            // A snapshot plays whole: the song's loop region is the loaded song's, not the snapshot's. (Claudes val)
            // TODO(spec): whether Loop in the header applies to a snapshot's ▶; it loops it, as before.
            services.player.stopAudition();
            services.player.setLoop(null);
            services.player.play(snapshotTake);
            snapshotView.current = view;
            setPlayingKey('snapshot');
            setPlaying(true);
          }}
        />
      )}
      {view === 'song' && (
        <SongView
          playheadSeconds={songPlays ? playhead.seconds : null}
          stepSeconds={step}
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
