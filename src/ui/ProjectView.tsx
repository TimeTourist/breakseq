import { useEffect, useMemo, useState } from 'react';
import type { Folder, SnapshotInfo } from '../engine';
import { comparable, listSnapshots, loadSnapshot, readManifest, saveSnapshot, writeManifest } from '../engine';
import type { Project } from '../model';
import { createProject } from '../model';
import { useApp, useSelect } from './context';
import type { RememberedFolder } from './folders';
import type { ProjectFolderState } from './store';

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

/**
 * Projects as folders on disk, and snapshots of the work in them: save over
 * the active one, save a new one, or load another. Undo works within a
 * snapshot; loading one starts afresh.
 */
export function ProjectView() {
  const { store, services } = useApp();
  const folders = services.folders;
  const { folder, active, saved } = useSelect((s) => s.projectFolder);
  const present = useSelect((s) => s.history.present);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [remembered, setRemembered] = useState<RememberedFolder | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = useMemo(() => saved !== null && comparable(present) !== saved, [present, saved]);
  /** Work that would be lost: changes since the active snapshot, or any work at all with no snapshot yet. */
  const unsaved = active !== null ? changed : Object.keys(present.samples).length > 0 || Object.keys(present.loops).length > 0;

  const setFolder = (state: Partial<ProjectFolderState>) => store.dispatch({ type: 'projectFolder', state });

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

  const refresh = async (f: Folder) => setSnapshots(await listSnapshots(f));

  /** Opens a folder that has a project: its active snapshot, or the newest. */
  const openFolder = async (f: Folder) => {
    const manifest = await readManifest(f);
    const list = await listSnapshots(f);
    const file = manifest?.active ?? list[0]?.file ?? null;
    const info = list.find((s) => s.file === file) ?? null;
    if (info === null) throw new Error('This project has no snapshots yet');
    const project = await loadSnapshot(f, info.file);
    store.dispatch({ type: 'load', project });
    setFolder({ folder: f, active: info, saved: comparable(project) });
    setSnapshots(list);
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
    setFolder({ folder: f, active: info, saved: savedText });
    setSnapshots(list);
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

  const save = async () => {
    if (folder === null || active === null) return;
    const project = store.getState().history.present;
    const info = await saveSnapshot(folder, project, active.name, new Date(), active.file);
    setFolder({ active: info, saved: comparable(project) });
    await refresh(folder);
  };

  const newSnapshot = async () => {
    if (folder === null) return;
    const project = store.getState().history.present;
    const info = await saveSnapshot(folder, project, name.trim() === '' ? `Snapshot ${snapshots.length + 1}` : name.trim(), new Date());
    await writeManifest(folder, info.file);
    setFolder({ active: info, saved: comparable(project) });
    setName('');
    await refresh(folder);
  };

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

      {folder !== null && (
        <section className="panel stack" aria-label="Snapshots">
          <h2 className="label">Snapshots</h2>
          {active !== null && (
            <div className="snapshot-row active">
              <span className="mono muted">{when(active.saved)}</span>
              <span className="grow snapshot-name">{active.name}</span>
              <span className="badge">active</span>
              {changed && <span className="badge warn">changed</span>}
              <button type="button" disabled={busy || !changed} onClick={() => void attempt(save)}>
                Save
              </button>
            </div>
          )}
          <form
            className="snapshot-row new"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(newSnapshot);
            }}
          >
            <span className="mono muted">{active === null ? '' : 'or keep it as'}</span>
            <input aria-label="New snapshot name" className="grow" placeholder="New snapshot name, e.g. Hek-tick Amen groove" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" aria-label="New snapshot" disabled={busy}>
              New
            </button>
          </form>
          {others.map((s) => (
            <div key={s.file} className="snapshot-row">
              <span className="mono muted">{when(s.saved)}</span>
              <span className="grow snapshot-name">{s.name}</span>
              <button type="button" disabled={busy} onClick={() => load(s)}>
                Load
              </button>
            </div>
          ))}
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
