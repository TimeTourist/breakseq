import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext, useApp, useProject, useSelect } from './context';
import { Header } from './Header';
import { ImportView } from './ImportView';
import type { Take } from './playback';
import type { Services } from './services';
import { SliceView } from './SliceView';
import { SongView } from './SongView';
import type { Store, View } from './store';
import { VIEWS } from './store';

export const RENDER_DEBOUNCE_MS = 300;
export const SAVE_DEBOUNCE_MS = 1000;

const PHASE: Partial<Record<View, number>> = { tag: 3, hits: 3, pads: 3, loops: 3, mods: 4 };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Renders the song shortly after every change, and on demand for a new random take. */
function useSongTake() {
  const { services } = useApp();
  const project = useProject();
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

/** Loads the saved project once, then saves shortly after every change. */
function useAutosave() {
  const { store, services } = useApp();
  const project = useProject();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    services.storage
      .load()
      .then((saved) => {
        if (saved !== null) store.dispatch({ type: 'load', project: saved });
      })
      .catch(() => setError('Could not load the saved project'))
      .finally(() => setLoaded(true));
  }, [store, services]);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      services.storage
        .save(project)
        .then(() => setError(null))
        .catch(() => setError('Autosave failed'));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [project, loaded, services]);

  return { error };
}

/** The bar under the playhead, polled each frame while playing. */
function usePlayhead(playing: boolean): number | null {
  const { services } = useApp();
  const [bar, setBar] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) {
      setBar(null);
      return;
    }
    let frame = requestAnimationFrame(function tick() {
      setBar(services.player.currentBar());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, services]);
  return bar;
}

function Shell() {
  const { store, services } = useApp();
  const view = useSelect((s) => s.view);
  const { take, rendering, error: renderError, newTake } = useSongTake();
  const { error: saveError } = useAutosave();
  const [playing, setPlaying] = useState(false);
  const playheadBar = usePlayhead(playing);

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
        onExport={() => {
          if (take !== null) services.exportWav(take);
        }}
        status={status}
      />
      {view === 'import' && <ImportView />}
      {view === 'slice' && <SliceView />}
      {view === 'song' && <SongView playheadBar={playheadBar} rendering={rendering} onNewTake={newTake} />}
      {PHASE[view] !== undefined && (
        <main className="view">
          <div className="view-head">
            <h1>{view[0]!.toUpperCase() + view.slice(1)}</h1>
            <p className="muted">This view comes in phase {PHASE[view]}.</p>
          </div>
        </main>
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
