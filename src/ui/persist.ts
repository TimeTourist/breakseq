import type { Project } from '../model';

/** Where the project is autosaved. */
export interface ProjectStorage {
  readonly load: () => Promise<Project | null>;
  readonly save: (project: Project) => Promise<void>;
}

const DB_NAME = 'breakseq';
const STORE = 'projects';
const KEY = 'current';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** The project in IndexedDB. Audio (Float32Arrays) is stored by structured clone. */
export function indexedDbStorage(factory: IDBFactory = indexedDB): ProjectStorage {
  let db: Promise<IDBDatabase> | null = null;
  const connect = () => (db ??= open(factory));
  return {
    load: async () => ((await run(await connect(), 'readonly', (s) => s.get(KEY))) as Project | undefined) ?? null,
    save: async (project) => {
      await run(await connect(), 'readwrite', (s) => s.put(project, KEY));
    },
  };
}
