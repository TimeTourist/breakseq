import type { Folder } from '../engine';

/** The parts of the File System Access API used here, which TypeScript's DOM types leave out. */
interface PermissionHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
type DirectoryPicker = (options: { mode: 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;

/** A folder the user picked, remembered between visits. */
export interface RememberedFolder {
  readonly name: string;
  /** Asks for access again if needed (`ask`), or only checks it. null if not granted. */
  readonly reconnect: (ask: boolean) => Promise<Folder | null>;
}

/** Project folders on disk. Tests pass a fake. */
export interface FolderService {
  /** Whether this browser can open folders (Chrome and Edge can). */
  readonly supported: boolean;
  /** Lets the user pick a folder, and remembers it. null if they cancel. */
  readonly pick: () => Promise<Folder | null>;
  /** The folder picked last time, if any. */
  readonly remembered: () => Promise<RememberedFolder | null>;
}

const isMissing = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

/** A folder on disk through a directory handle. */
export function handleFolder(root: FileSystemDirectoryHandle): Folder {
  /** The directory a path is in, made on the way if `create`; null if it is not there. */
  const directory = async (parts: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle | null> => {
    let dir = root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    }
    return dir;
  };
  const split = (path: string) => {
    const parts = path.split('/').filter((p) => p !== '');
    return { dirs: parts.slice(0, -1), file: parts.at(-1) ?? '' };
  };
  return {
    name: root.name,
    read: async (path) => {
      const { dirs, file } = split(path);
      const dir = await directory(dirs, false);
      if (dir === null) return null;
      try {
        const handle = await dir.getFileHandle(file);
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    write: async (path, bytes) => {
      const { dirs, file } = split(path);
      const dir = (await directory(dirs, true))!;
      const writable = await (await dir.getFileHandle(file, { create: true })).createWritable();
      await writable.write(bytes as BufferSource);
      await writable.close();
    },
    list: async (path) => {
      const dir = await directory(path.split('/').filter((p) => p !== ''), false);
      if (dir === null) return [];
      const names: string[] = [];
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === 'file') names.push(name);
      }
      return names;
    },
  };
}

const DB = 'breakseq-folders';
const STORE = 'handles';
const KEY = 'project';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

async function keep(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not remember the folder'));
  });
}

async function recall(): Promise<FileSystemDirectoryHandle | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Could not read the remembered folder'));
  });
}

/** Folders through the File System Access API, as in Chrome and Edge. */
export function browserFolders(): FolderService {
  // Looked up when used, not once: the page may not have it yet, or have another.
  const picker = () => (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker?.bind(window);
  return {
    supported: picker() !== undefined,
    pick: async () => {
      const pickFolder = picker();
      if (pickFolder === undefined) return null;
      try {
        const handle = await pickFolder({ mode: 'readwrite', id: 'breakseq-project' });
        await keep(handle).catch(() => undefined);
        return handleFolder(handle);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null;
        throw e;
      }
    },
    remembered: async () => {
      const handle = await recall().catch(() => null);
      if (handle === null) return null;
      return {
        name: handle.name,
        reconnect: async (ask) => {
          const permission = handle as unknown as PermissionHandle;
          let state = await permission.queryPermission({ mode: 'readwrite' });
          if (state !== 'granted' && ask) state = await permission.requestPermission({ mode: 'readwrite' });
          return state === 'granted' ? handleFolder(handle) : null;
        },
      };
    },
  };
}
