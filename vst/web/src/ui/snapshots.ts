import { useMemo } from 'react';
import type { Folder, SnapshotInfo } from '../engine';
import { comparable, listSnapshots, loadSnapshot, saveSnapshot, writeManifest } from '../engine';
import { useApp, useSelect } from './context';
import type { ProjectFolderState } from './store';

/**
 * The project folder's snapshots and what is done to them from the header:
 * Load the active one as last saved, Save over it, and keep the work as a New
 * snapshot. Used by the header and by Project, so both always show the same.
 */
export function useSnapshots() {
  const { store } = useApp();
  const { folder, active, saved, snapshots } = useSelect((s) => s.projectFolder);
  const present = useSelect((s) => s.history.present);
  const changed = useMemo(() => saved !== null && comparable(present) !== saved, [present, saved]);

  const setFolder = (state: Partial<ProjectFolderState>) => store.dispatch({ type: 'projectFolder', state });

  const refresh = async (f: Folder) => setFolder({ snapshots: await listSnapshots(f) });

  /** Saves the work over the active snapshot. */
  const save = async () => {
    if (folder === null || active === null) return;
    const project = store.getState().history.present;
    const info = await saveSnapshot(folder, project, active.name, new Date(), active.file);
    await folder.flush?.();
    setFolder({ active: info, saved: comparable(project) });
    await refresh(folder);
  };

  /** Keeps the work as a new snapshot, which becomes the active one; the one before stays as it was. */
  const newSnapshot = async (name: string): Promise<SnapshotInfo | null> => {
    if (folder === null) return null;
    const project = store.getState().history.present;
    const info = await saveSnapshot(folder, project, name.trim() === '' ? `Snapshot ${snapshots.length + 1}` : name.trim(), new Date());
    await writeManifest(folder, info.file);
    await folder.flush?.();
    setFolder({ active: info, saved: comparable(project) });
    await refresh(folder);
    return info;
  };

  /** Loads a snapshot as it was saved, which becomes the active one; a load starts a new undo history. */
  const load = async (info: SnapshotInfo) => {
    if (folder === null) return;
    const project = await loadSnapshot(folder, info.file);
    store.dispatch({ type: 'load', project });
    await writeManifest(folder, info.file);
    await folder.flush?.();
    setFolder({ active: info, saved: comparable(project) });
    await refresh(folder);
  };

  return { folder, active, changed, snapshots, setFolder, refresh, save, newSnapshot, load };
}
