import type { AudioData, Id, Project } from '../model';
import { comparable } from '../engine';
import { OLD_PROJECT_MESSAGE, upgradeProject } from '../model';
import type { BackupInfo, BackupStorage, BackupSummary } from './backups';
import { BACKUP_KEEP } from './backups';

/** Where the project is autosaved. */
export interface ProjectStorage {
  readonly load: () => Promise<Project | null>;
  readonly save: (project: Project) => Promise<void>;
  /** After `load`: whether the autosave was from before Matrix and was set aside as a backup. */
  readonly setAside?: () => boolean;
}

const DB_NAME = 'breakseq';
const STORE = 'projects';
const KEY = 'current';
/** Backups of the autosave, the project without its audio. */
const BACKUPS = 'backups';
/** The backups' audio, once per audio id: audio never changes and its id is never reused. */
const AUDIO = 'backup-audio';

interface BackupRecord extends BackupInfo {
  readonly project: Project;
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [STORE, BACKUPS, AUDIO]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>, name = STORE): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = work(tx.objectStore(name));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Runs `work` over several stores in one transaction, resolving when it commits. */
function runAll(db: IDBDatabase, names: readonly string[], work: (stores: Record<string, IDBObjectStore>) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    work(Object.fromEntries(names.map((n) => [n, tx.objectStore(n)])));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

const connection = (factory: IDBFactory) => {
  let db: Promise<IDBDatabase> | null = null;
  return () => (db ??= open(factory));
};

/** The project in IndexedDB. Audio (Float32Arrays) is stored by structured clone. */
export function indexedDbStorage(factory: IDBFactory = indexedDB): ProjectStorage {
  const connect = connection(factory);
  let setAside = false;
  return {
    load: async () => {
      setAside = false;
      const saved = await run(await connect(), 'readonly', (s) => s.get(KEY));
      if (saved === undefined) return null;
      const project = upgradeProject(saved);
      if (project === null) {
        await keepOldAutosave(factory, saved);
        setAside = true;
      }
      return project;
    },
    setAside: () => setAside,
    save: async (project) => {
      await run(await connect(), 'readwrite', (s) => s.put(project, KEY));
    },
  };
}

/** Keeps an autosave from before Matrix as a backup, as it is, before the autosave is written over. */
async function keepOldAutosave(factory: IDBFactory, saved: unknown): Promise<void> {
  const old = saved as Partial<Project> & { audio?: Record<Id, AudioData> };
  const count = (record: object | undefined) => Object.keys(record ?? {}).length;
  const summary = { snapshot: null, samples: count(old.samples), loops: count(old.loops), clips: old.song?.clips?.length ?? 0 };
  await indexedDbBackups(factory).add({ ...old, audio: old.audio ?? {} } as Project, summary, Date.now());
}

/**
 * Backups of the autosave in IndexedDB, the newest BACKUP_KEEP. Each holds
 * the project without audio; the audio is kept once, for as long as a backup
 * uses it. A project the same as the newest backup's is not kept again.
 */
export function indexedDbBackups(factory: IDBFactory = indexedDB, newId: () => string = () => crypto.randomUUID()): BackupStorage {
  const connect = connection(factory);
  const records = async () => {
    const all = (await run(await connect(), 'readonly', (s) => s.getAll(), BACKUPS)) as BackupRecord[];
    return all.sort((a, b) => b.at - a.at);
  };
  return {
    list: async () => (await records()).map(({ id, at, summary }) => ({ id, at, summary })),
    add: async (project: Project, summary: BackupSummary, at: number) => {
      const db = await connect();
      const stored = new Set((await run(db, 'readonly', (s) => s.getAllKeys(), AUDIO)) as string[]);
      const record: BackupRecord = { id: newId(), at, summary, project: { ...project, audio: {} } };
      const before = await records();
      // A reload without changes would push a useful backup out with the same project again.
      if (before[0] !== undefined && comparable(before[0].project) === comparable(record.project)) return;
      const kept = [record, ...before].sort((a, b) => b.at - a.at);
      const dropped = kept.slice(BACKUP_KEEP);
      const used = new Set<Id>([...kept.slice(0, BACKUP_KEEP).flatMap((r) => audioIds(r.project)), ...Object.keys(project.audio)]);
      await runAll(db, [BACKUPS, AUDIO], (s) => {
        for (const [id, audio] of Object.entries(project.audio)) if (!stored.has(id)) s[AUDIO]!.put(audio, id);
        s[BACKUPS]!.put(record, record.id);
        for (const r of dropped) s[BACKUPS]!.delete(r.id);
        for (const id of stored) if (!used.has(id)) s[AUDIO]!.delete(id);
      });
    },
    restore: async (id: string) => {
      const db = await connect();
      const record = (await run(db, 'readonly', (s) => s.get(id), BACKUPS)) as BackupRecord | undefined;
      if (record === undefined) throw new Error('That backup is gone');
      const audio: Record<Id, AudioData> = {};
      for (const audioId of audioIds(record.project)) {
        const data = (await run(db, 'readonly', (s) => s.get(audioId), AUDIO)) as AudioData | undefined;
        if (data !== undefined) audio[audioId] = data;
      }
      const project = upgradeProject({ ...record.project, audio });
      if (project === null) throw new Error(OLD_PROJECT_MESSAGE);
      return project;
    },
  };
}

/** The audio a project's samples play. */
const audioIds = (project: Project): Id[] => [...new Set(Object.values(project.samples).map((s) => s.audioId))];
