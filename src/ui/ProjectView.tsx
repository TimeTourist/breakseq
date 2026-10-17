import { useEffect, useState } from 'react';
import { PlayIcon } from './icons';
import type { Folder, SnapshotInfo } from '../engine';
import { comparable, listSnapshots, loadSnapshot, readManifest, saveSnapshot, writeManifest } from '../engine';
import type { Project } from '../model';
import { createProject } from '../model';
import { useApp, useSelect } from './context';
import type { RememberedFolder } from './folders';
import type { Take } from './playback';
import { useSnapshots } from './snapshots';
import type { BackupInfo } from './backups';
import { BACKUP_KEEP, backupTime, summaryText } from './backups';

/** "2026-10-15 20:30", in local time. */
export function when(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A question with a few answers, shown over the view. */
interface Ask {
  readonly question: string;
  readonly answers: readonly { readonly label: string; readonly run: () => void }[];
}

interface ProjectViewProps {
  /** Exports the song as it is now, as heard. */
  readonly onExport: () => void;
  readonly canExport: boolean;
  /** Exports the song as MIDI and a WAV of its sounds in slots; resolves to how many sounds. */
  readonly onExportMidi: () => Promise<number>;
  /** Plays a take in the place of the song, until Stop. */
  readonly onPlayTake: (take: Take) => void;
  /** Backups of the autosave, newest first; null when there are none to keep. */
  readonly backups: readonly BackupInfo[] | null;
  /** Swaps in a backup, after keeping the work as one. */
  readonly onRestore: (id: string) => Promise<void>;
}

/**
 * Projects as folders on disk, and snapshots of the work in them: play or
 * export any of them without loading it, or load one. Save and New snapshot
 * are in the header. Undo works within a snapshot; loading one starts afresh.
 */
export function ProjectView({ onExport, canExport, onExportMidi, onPlayTake, backups, onRestore }: ProjectViewProps) {
  const { store, services } = useApp();
  const folders = services.folders;
  const { folder, active, changed, snapshots, setFolder, refresh, save } = useSnapshots();
  const present = useSelect((s) => s.history.present);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [remembered, setRemembered] = useState<RememberedFolder | null>(null);
  const [busy, setBusy] = useState(false);
  /** The time backups are told against ("12 min ago"), kept current. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  /** What the last MIDI export saved. */
  const [midiDone, setMidiDone] = useState<string | null>(null);
  /** The snapshot being rendered to play or export. */
  const [rendering, setRendering] = useState<string | null>(null);

  /** Work that would be lost: changes since the active snapshot, or any work at all with no snapshot yet. */
  const unsaved = active !== null ? changed : Object.keys(present.samples).length > 0 || Object.keys(present.loops).length > 0;

  /** Runs `work`, showing what went wrong, and keeps buttons off meanwhile. */
  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Opens a folder that has a project: its active snapshot, or the newest. */
  const openFolder = async (f: Folder) => {
    const manifest = await readManifest(f);
    const list = await listSnapshots(f);
    const file = manifest?.active ?? list[0]?.file ?? null;
    const info = list.find((s) => s.file === file) ?? null;
    if (info === null) throw new Error('This project has no snapshots yet');
    const project = await loadSnapshot(f, info.file);
    store.dispatch({ type: 'load', project });
    setFolder({ folder: f, active: info, saved: comparable(project), snapshots: list });
  };

  /** Starts a project in an empty folder, with the work as it is or empty; its first snapshot is "Start". */
  const startIn = async (f: Folder, project: Project) => {
    if (project !== present) store.dispatch({ type: 'load', project });
    const info = await saveSnapshot(f, project, 'Start', new Date());
    await writeManifest(f, info.file);
    setFolder({ folder: f, active: info, saved: comparable(project) });
    await refresh(f);
  };

  // Reconnect to the folder from last time without asking, if the browser still allows it.
  useEffect(() => {
    if (folder !== null || folders === undefined) return;
    let gone = false;
    void (async () => {
      const last = await folders.remembered();
      if (gone || last === null) return;
      setRemembered(last);
      const f = await last.reconnect(false);
      if (!gone && f !== null) await connect(f);
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the view opens without a folder
  }, []);

  useEffect(() => {
    if (folder !== null) void refresh(folder).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the folder changes; refresh is a new function each render
  }, [folder]);

  /**
   * Comes back to a folder after a reload: the work in the browser is kept, and
   * compared with the active snapshot to show whether it has changed.
   */
  const connect = async (f: Folder) => {
    const manifest = await readManifest(f);
    const list = await listSnapshots(f);
    const info = list.find((s) => s.file === manifest?.active) ?? null;
    const savedText = info === null ? null : comparable(await loadSnapshot(f, info.file));
    setFolder({ folder: f, active: info, saved: savedText, snapshots: list });
  };

  /** Asks first when work would be lost: save it, throw it away, or stop. */
  const guarded = (what: string, go: () => Promise<void>) => {
    if (!unsaved) {
      void attempt(go);
      return;
    }
    const canSave = folder !== null && active !== null;
    setAsk({
      question: canSave ? `You have changes that are not in “${active.name}”. ${what}?` : `Your work is not in a snapshot yet. ${what} anyway?`,
      answers: [
        ...(canSave
          ? [
              {
                label: 'Save first',
                run: () =>
                  void attempt(async () => {
                    await save();
                    await go();
                  }),
              },
            ]
          : []),
        { label: canSave ? 'Discard changes' : 'Discard the work', run: () => void attempt(go) },
        { label: 'Cancel', run: () => undefined },
      ],
    });
  };

  /**
   * Renders a snapshot's song straight from its file, for playing or export.
   * The work that is loaded is not touched.
   */
  const renderSnapshot = (info: SnapshotInfo, then: (take: Take) => void) =>
    void attempt(async () => {
      if (folder === null) return;
      setRendering(info.file);
      try {
        const project = await loadSnapshot(folder, info.file);
        then(await services.renderSong(project, services.rng()));
      } finally {
        setRendering(null);
      }
    });

  const load = (info: SnapshotInfo) =>
    guarded(`Load “${info.name}”`, async () => {
      if (folder === null) return;
      const project = await loadSnapshot(folder, info.file);
      store.dispatch({ type: 'load', project });
      await writeManifest(folder, info.file);
      setFolder({ active: info, saved: comparable(project) });
      await refresh(folder);
    });

  const open = () =>
    guarded('Open another project', async () => {
      const f = await folders?.pick();
      if (f === undefined || f === null) return;
      if ((await readManifest(f)) === null) await startIn(f, createProject());
      else await openFolder(f);
    });

  const newProject = () =>
    void attempt(async () => {
      const f = await folders?.pick();
      if (f === undefined || f === null) return;
      if ((await readManifest(f)) !== null) throw new Error(`“${f.name}” already has a project: use Open`);
      const work = store.getState().history.present;
      setAsk({
        question: `A new project in “${f.name}”. Start it with the work you have now, or empty?`,
        answers: [
          { label: 'Keep the current work', run: () => void attempt(() => startIn(f, work)) },
          { label: 'Start empty', run: () => guarded('Start empty', () => startIn(f, createProject())) },
          { label: 'Cancel', run: () => undefined },
        ],
      });
    });

  const others = snapshots.filter((s) => s.file !== active?.file);

  return (
    <main className="view project-view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>Project</h1>
          <p className="muted">
            {folder === null
              ? 'A project is a folder on your disk. Snapshots in it keep your work as it is, to come back to.'
              : `In the folder “${folder.name}”.`}
          </p>
        </div>
        <div className="row push">
          <button type="button" disabled={busy || folders?.supported !== true} onClick={open}>
            Open
          </button>
          <button type="button" disabled={busy || folders?.supported !== true} onClick={newProject}>
            New
          </button>
        </div>
      </div>

      {folders?.supported !== true && <p className="muted">Opening project folders needs Chrome or Edge.</p>}

      {folder === null && remembered !== null && (
        <section className="panel row">
          <span className="muted">Last time you worked in “{remembered.name}”.</span>
          <button
            type="button"
            className="push"
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                const f = await remembered.reconnect(true);
                if (f === null) throw new Error('The browser did not allow the folder');
                await connect(f);
              })
            }
          >
            Reconnect “{remembered.name}”
          </button>
        </section>
      )}

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel stack-tight" aria-label="Export">
        <div className="row">
          <span className="label">Export</span>
          <span className="muted small">The song as it is now, as you hear it: WAV, 44.1 kHz, 24 bit.</span>
          <button type="button" className="primary push" disabled={!canExport} onClick={onExport}>
            Export WAV
          </button>
        </div>
        <div className="row">
          <span className="muted small grow">
            Or as MIDI and a WAV of its sounds, one per slot from C1 up, for a sampler like Dr. Octo Rex or Digitakt: slice the WAV, play the MIDI, and it sounds like the song.
          </span>
          <button
            type="button"
            className="push"
            disabled={!canExport || busy}
            onClick={() =>
              void attempt(async () => {
                setMidiDone(null);
                const pieces = await onExportMidi();
                setMidiDone(`Saved a MIDI file and a WAV with ${pieces} sound${pieces === 1 ? '' : 's'}.`);
              })
            }
          >
            Export MIDI + slices
          </button>
        </div>
        {midiDone !== null && <p className="muted small" role="status">{midiDone}</p>}
      </section>

      {folder !== null && (
        <section className="panel stack" aria-label="Snapshots">
          <h2 className="label">Snapshots</h2>
          <p className="muted small">Play or export a snapshot without loading it: the work you have open stays as it is. Save and New snapshot are at the top.</p>
          {[...(active === null ? [] : [active]), ...others].map((s) => {
            const isActive = s.file === active?.file;
            return (
              <div key={s.file} className={`snapshot-row${isActive ? ' active' : ''}`} aria-label={`Snapshot ${s.name}`} role="group">
                <span className="mono muted">{when(s.saved)}</span>
                <span className="grow snapshot-name">{s.name}</span>
                {isActive && <span className="badge">active</span>}
                {isActive && changed && <span className="badge warn" title="The work has changes that are not in this snapshot">changed</span>}
                {rendering === s.file && <span className="muted small">Rendering…</span>}
                <button type="button" className="icon-button" disabled={busy} aria-label={`Play ${s.name}`} onClick={() => renderSnapshot(s, onPlayTake)}>
                  <PlayIcon />
                </button>
                <button type="button" disabled={busy} aria-label={`Export ${s.name}`} onClick={() => renderSnapshot(s, (take) => services.exportWav(take, s.name))}>
                  Export
                </button>
                {!isActive && (
                  <button type="button" disabled={busy} aria-label={`Load ${s.name}`} onClick={() => load(s)}>
                    Load
                  </button>
                )}
              </div>
            );
          })}
          {snapshots.length === 0 && <p className="muted small">No snapshots yet: New snapshot at the top keeps the work as one.</p>}
        </section>
      )}

      {backups !== null && (
        <section className="panel stack" aria-label="Autosave backups">
          <h2 className="label">Autosave backups</h2>
          <p className="muted small">
            The browser keeps the last {BACKUP_KEEP}: the project as it was when the page loaded, then one every 5 minutes while you work. Restore swaps one in like Load; the work you have now is kept as a backup first.
          </p>
          {backups.map((b) => (
            <div key={b.id} className="snapshot-row" role="group" aria-label={`Backup ${backupTime(b.at, now)}`}>
              <span className="mono muted">{backupTime(b.at, now)}</span>
              <span className="grow snapshot-name">{b.summary.snapshot ?? <span className="muted">No snapshot</span>}</span>
              <span className="muted small">{summaryText(b.summary)}</span>
              <button type="button" disabled={busy} onClick={() => void attempt(() => onRestore(b.id))}>
                Restore
              </button>
            </div>
          ))}
          {backups.length === 0 && <p className="muted small">No backups yet.</p>}
        </section>
      )}

      {ask !== null && (
        <div className="dialog-backdrop">
          <div className="dialog panel stack" role="dialog" aria-modal="true" aria-label={ask.question}>
            <p>{ask.question}</p>
            <div className="row">
              {ask.answers.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    setAsk(null);
                    a.run();
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
