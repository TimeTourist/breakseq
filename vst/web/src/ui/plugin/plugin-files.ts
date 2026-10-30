import type { Folder } from '../../engine';
import { breakseqFolder } from '../../engine';
import type { FolderService } from '../folders';
import type { Bridge } from './bridge';
import { base64ToBytes, bytesToBase64 } from './bridge';

/** What the C++ side answers when a file is picked: where it is and, when opened, what is in it. */
interface Picked {
  readonly path: string;
  readonly name: string;
  readonly data?: string;
}

const picked = (value: unknown): Picked | null => (typeof value === 'object' && value !== null && typeof (value as Picked).path === 'string' ? (value as Picked) : null);

/**
 * Projects as .breakseq files (docs/vst-spec.md, Lagring). The plugin opens
 * Windows' dialogs and reads and writes the files, and keeps the path in the
 * song's state, so the song opens its file again. `folders` are the old
 * project folders, for Import folder….
 */
export function pluginFiles(bridge: Bridge, folders: FolderService): FolderService {
  const fileFolder = (path: string, name: string, bytes: Uint8Array | null): Folder =>
    breakseqFolder(name, bytes, async (data) => {
      if ((await bridge.call('writeProjectFile', path, bytesToBase64(data))) !== true) throw new Error(`Could not write “${name}”`);
    });

  return {
    supported: true,
    pick: async () => {
      const file = picked(await bridge.call('openProjectFile'));
      return file === null ? null : fileFolder(file.path, file.name, base64ToBytes(file.data ?? ''));
    },
    create: async () => {
      const file = picked(await bridge.call('newProjectFile'));
      return file === null ? null : fileFolder(file.path, file.name, null);
    },
    remembered: async () => {
      const file = picked(await bridge.call('projectFile'));
      if (file === null) return null;
      return {
        name: file.name,
        reconnect: async () => {
          const data = await bridge.call('readProjectFile', file.path);
          return typeof data === 'string' ? fileFolder(file.path, file.name, base64ToBytes(data)) : null;
        },
      };
    },
    folders,
  };
}
