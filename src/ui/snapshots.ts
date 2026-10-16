import { useMemo } from 'react';
import type { Folder, SnapshotInfo } from '../engine';
import { comparable, listSnapshots, saveSnapshot, writeManifest } from '../engine';
import { useApp, useSelect } from './context';
import type { ProjectFolderState } from './store';

/**
 * The project folder's snapshots and the two things done to them from the
 * header: Save over the active one, and keep the work as a New snapshot. Used
 * by the header and by Project, so both always show the same.
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
    setFolder({ active: info, saved: comparable(project) });
    await refresh(folder);
  };

  /** Keeps the work as a new snapshot, which becomes the active one; the one before stays as it was. */
  const newSnapshot = async (name: string): Promise<SnapshotInfo | null> => {
    if (folder === null) return null;
    const project = store.getState().history.present;
    const info = await saveSnapshot(folder, project, name.trim() === '' ? `Snapshot ${snapshots.length + 1}` : name.trim(), new Date());
    await writeManifest(folder, info.file);
    setFolder({ active: info, saved: comparable(project) });
    await refresh(folder);
    return info;
  };

  return { folder, active, changed, snapshots, setFolder, refresh, save, newSnapshot };
}
