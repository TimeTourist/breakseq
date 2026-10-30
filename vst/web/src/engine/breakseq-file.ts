import type { Zippable } from 'fflate';
import { unzipSync, zipSync } from 'fflate';
import type { Folder } from './project-folder';
import { ProjectFileError } from './project-file';

export const BREAKSEQ_EXTENSION = '.breakseq';

/** The files in a .breakseq, by path; throws if it is not one. */
export function readBreakseqFile(bytes: Uint8Array, name: string): Map<string, Uint8Array> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ProjectFileError(`“${name}” is not a Breakseq project`);
  }
  if (files['breakseq.json'] === undefined) throw new ProjectFileError(`“${name}” is not a Breakseq project`);
  return new Map(Object.entries(files));
}

/** A .breakseq from its files: the audio is stored as it is (WAV packs badly), the JSON packed. */
export function writeBreakseqFile(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, bytes] of files) zippable[path] = [bytes, { level: path.endsWith('.wav') ? 0 : 6 }];
  return zipSync(zippable);
}

/**
 * A project in one .breakseq file (docs/vst-spec.md, Lagring): the project
 * folder as a zip. It is kept in memory, and `flush` writes the whole file
 * through `persist` once a save is done, not for each file in it. `bytes` is
 * the file as opened, or null for a new one.
 */
export function breakseqFolder(name: string, bytes: Uint8Array | null, persist: (bytes: Uint8Array) => Promise<void>): Folder {
  const files = bytes === null ? new Map<string, Uint8Array>() : readBreakseqFile(bytes, name);
  let dirty = false;
  return {
    name,
    read: async (path) => files.get(path) ?? null,
    write: async (path, data) => {
      files.set(path, data);
      dirty = true;
    },
    list: async (dir) => {
      const prefix = dir === '' ? '' : `${dir}/`;
      return [...files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map((p) => p.slice(prefix.length));
    },
    flush: async () => {
      if (!dirty) return;
      await persist(writeBreakseqFile(files));
      dirty = false;
    },
  };
}
