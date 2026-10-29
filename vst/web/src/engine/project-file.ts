import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { AudioData, Id, Project } from '../model';
import { OLD_PROJECT_MESSAGE, upgradeProject } from '../model';
import { AudioFileError, decodeAudioFile, encodeFloatWav } from './codec';

export const PROJECT_FILE_VERSION = 2;

export class ProjectFileError extends Error {
  override name = 'ProjectFileError';
}

/** project.json: the project with each audio replaced by the path of its WAV in the zip. */
interface ProjectJson {
  readonly format: 'breakseq';
  readonly version: number;
  readonly project: Omit<Project, 'audio'> & { readonly audio: Readonly<Record<Id, string>> };
}

const audioPath = (id: Id) => `audio/${id}.wav`;

/** A zip with project.json and one lossless 32-bit float WAV per audio. */
export function writeProjectFile(project: Project): Uint8Array {
  const json: ProjectJson = {
    format: 'breakseq',
    version: PROJECT_FILE_VERSION,
    project: { ...project, audio: Object.fromEntries(Object.keys(project.audio).map((id) => [id, audioPath(id)])) },
  };
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(json)) };
  for (const [id, audio] of Object.entries(project.audio)) files[audioPath(id)] = encodeFloatWav(audio);
  // WAV data barely compresses; store it so saving stays fast.
  return zipSync(files, { level: 0 });
}

/** Reads a project file. Throws ProjectFileError if it is not one, or from a newer version. */
export function readProjectFile(bytes: Uint8Array): Project {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ProjectFileError('Not a Breakseq project file');
  }
  const raw = files['project.json'];
  if (raw === undefined) throw new ProjectFileError('Not a Breakseq project file');

  let json: ProjectJson;
  try {
    json = JSON.parse(strFromU8(raw)) as ProjectJson;
  } catch {
    throw new ProjectFileError('The project file is damaged');
  }
  if (json.format !== 'breakseq') throw new ProjectFileError('Not a Breakseq project file');
  if (json.version > PROJECT_FILE_VERSION) throw new ProjectFileError('The project file is from a newer version of Breakseq');

  const audio: Record<Id, AudioData> = {};
  for (const [id, path] of Object.entries(json.project.audio)) {
    const wav = files[path];
    if (wav === undefined) throw new ProjectFileError(`The project file is missing ${path}`);
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
