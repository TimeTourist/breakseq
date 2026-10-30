import { strFromU8, strToU8 } from 'fflate';
import type { AudioData, Id, Project } from '../model';
import { OLD_PROJECT_MESSAGE, upgradeProject } from '../model';
import { AudioFileError, decodeAudioFile, encodeFloatWav } from './codec';
import { PROJECT_FILE_VERSION, ProjectFileError } from './project-file';

/**
 * A project folder on disk, as much of it as snapshots need. Paths are relative
 * to the folder and use '/'. The browser's File System Access API is one; tests
 * use one in memory.
 */
export interface Folder {
  readonly name: string;
  /** null if there is no such file. */
  readonly read: (path: string) => Promise<Uint8Array | null>;
  /** Writes the whole file, making its directory if needed. */
  readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
  /** The names of the files in a directory, or none if it does not exist. */
  readonly list: (dir: string) => Promise<string[]>;
  /** Puts what was written on disk, for a folder that keeps it until then (a .breakseq file). */
  readonly flush?: () => Promise<void>;
}

/** breakseq.json: what makes a folder a Breakseq project, and which snapshot is active. */
export interface Manifest {
  readonly format: 'breakseq-project';
  readonly version: number;
  /** Path of the active snapshot, e.g. "snapshots/2026-10-15 20.30 Hek-tick.json". */
  readonly active: string | null;
}

export interface SnapshotInfo {
  readonly file: string;
  readonly name: string;
  /** When it was last saved, as an ISO date. */
  readonly saved: string;
}

/** A snapshot file: everything in the project, with each audio a path to its WAV in the folder. */
interface SnapshotJson {
  readonly format: 'breakseq';
  readonly version: number;
  readonly name: string;
  readonly saved: string;
  readonly project: Omit<Project, 'audio'> & { readonly audio: Readonly<Record<Id, string>> };
}

const MANIFEST = 'breakseq.json';
const SNAPSHOTS = 'snapshots';
const AUDIO = 'audio';
export const audioPath = (id: Id) => `${AUDIO}/${id}.wav`;

const readJson = async <T>(folder: Folder, path: string): Promise<T | null> => {
  const bytes = await folder.read(path);
  if (bytes === null) return null;
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch {
    throw new ProjectFileError(`${path} is damaged`);
  }
};

export async function readManifest(folder: Folder): Promise<Manifest | null> {
  const manifest = await readJson<Manifest>(folder, MANIFEST);
  if (manifest === null) return null;
  if (manifest.format !== 'breakseq-project') throw new ProjectFileError(`${MANIFEST} is not a Breakseq project`);
  return manifest;
}

export const writeManifest = (folder: Folder, active: string | null): Promise<void> =>
  folder.write(MANIFEST, strToU8(JSON.stringify({ format: 'breakseq-project', version: PROJECT_FILE_VERSION, active } satisfies Manifest, null, 2)));

/** The project as text without its audio data: equal strings mean nothing has changed. */
export function comparable(project: Project): string {
  return JSON.stringify({ ...project, audio: Object.keys(project.audio).sort() });
}

/** A file name for a snapshot: "2026-10-15 20.30 Hek-tick Amen groove.json", safe on any disk. */
function fileName(name: string, saved: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${saved.getFullYear()}-${pad(saved.getMonth() + 1)}-${pad(saved.getDate())} ${pad(saved.getHours())}.${pad(saved.getMinutes())}`;
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${stamp} ${safe === '' ? 'snapshot' : safe}`;
}

/**
 * Saves the project as a snapshot. With `file` it writes over that snapshot,
 * else it makes a new file that does not clash with one there. Each audio is
 * written once: one already in the folder is left as it is.
 */
export async function saveSnapshot(folder: Folder, project: Project, name: string, saved: Date, file: string | null = null): Promise<SnapshotInfo> {
  const existing = new Set(await folder.list(AUDIO));
  for (const [id, audio] of Object.entries(project.audio)) {
    if (!existing.has(`${id}.wav`)) await folder.write(audioPath(id), encodeFloatWav(audio));
  }
  let path = file;
  if (path === null) {
    const taken = new Set(await folder.list(SNAPSHOTS));
    const base = fileName(name, saved);
    let candidate = `${base}.json`;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base} (${n}).json`;
    path = `${SNAPSHOTS}/${candidate}`;
  }
  const json: SnapshotJson = {
    format: 'breakseq',
    version: PROJECT_FILE_VERSION,
    name,
    saved: saved.toISOString(),
    project: { ...project, audio: Object.fromEntries(Object.keys(project.audio).map((id) => [id, audioPath(id)])) },
  };
  await folder.write(path, strToU8(JSON.stringify(json)));
  return { file: path, name, saved: json.saved };
}

/** Every snapshot in the folder, the newest first. */
export async function listSnapshots(folder: Folder): Promise<SnapshotInfo[]> {
  const files = (await folder.list(SNAPSHOTS)).filter((f) => f.endsWith('.json'));
  const infos = await Promise.all(
    files.map(async (f): Promise<SnapshotInfo | null> => {
      const json = await readJson<SnapshotJson>(folder, `${SNAPSHOTS}/${f}`).catch(() => null);
      return json === null || json.format !== 'breakseq' ? null : { file: `${SNAPSHOTS}/${f}`, name: json.name, saved: json.saved };
    }),
  );
  return infos.filter((i): i is SnapshotInfo => i !== null).sort((a, b) => b.saved.localeCompare(a.saved) || b.file.localeCompare(a.file));
}

/** Reads a snapshot back into a project, with its audio from the folder. */
export async function loadSnapshot(folder: Folder, file: string): Promise<Project> {
  const json = await readJson<SnapshotJson>(folder, file);
  if (json === null) throw new ProjectFileError(`${file} is missing`);
  if (json.format !== 'breakseq') throw new ProjectFileError(`${file} is not a Breakseq snapshot`);
  if (json.version > PROJECT_FILE_VERSION) throw new ProjectFileError(`${file} is from a newer version of Breakseq`);
  const audio: Record<Id, AudioData> = {};
  for (const [id, path] of Object.entries(json.project.audio)) {
    const wav = await folder.read(path);
    if (wav === null) throw new ProjectFileError(`The project folder is missing ${path}`);
    try {
      audio[id] = decodeAudioFile(wav);
    } catch (e) {
      throw new ProjectFileError(`${path}: ${e instanceof AudioFileError ? e.message : 'unreadable'}`);
    }
  }
  const project = upgradeProject({ ...json.project, audio });
  if (project === null) throw new ProjectFileError(OLD_PROJECT_MESSAGE);
  return project;
}

/** Copies a project, every snapshot and audio, into another folder; the caller flushes it. */
export async function copyProject(from: Folder, to: Folder): Promise<void> {
  const manifest = await from.read(MANIFEST);
  if (manifest === null) throw new ProjectFileError(`“${from.name}” is not a Breakseq project`);
  for (const dir of [SNAPSHOTS, AUDIO]) {
    for (const name of await from.list(dir)) {
      const bytes = await from.read(`${dir}/${name}`);
      if (bytes !== null) await to.write(`${dir}/${name}`, bytes);
    }
  }
  await to.write(MANIFEST, manifest);
}
