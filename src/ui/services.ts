import type { Project, Rng } from '../model';
import { EXPORT_SAMPLE_RATE, encodeWav, generateTake, midiExport, renderTake } from '../engine';
import type { FolderService } from './folders';
import { browserFolders } from './folders';
import type { BackupStorage } from './backups';
import type { ProjectStorage } from './persist';
import { indexedDbBackups, indexedDbStorage } from './persist';
import type { Player, Take } from './playback';
import { createPlayer } from './playback';

/** Everything the UI does outside React. Tests pass fakes. */
export interface Services {
  readonly storage: ProjectStorage;
  /** Backups of the autosave; without it, Project shows none. */
  readonly backups?: BackupStorage;
  readonly player: Player;
  readonly renderSong: (project: Project, rng: Rng) => Promise<Take>;
  /** Saves a take as WAV; `name`, e.g. a snapshot's, goes in the file name. */
  readonly exportWav: (take: Take, name?: string) => void;
  /** Saves the song as a MIDI file and a WAV of its sounds in slots; says how many sounds. */
  readonly exportMidi: (project: Project, take: Take) => Promise<number>;
  /** Hands the user a file to save. */
  readonly download: (name: string, bytes: Uint8Array, type: string) => void;
  /** Fresh randomness for each take. */
  readonly rng: () => Rng;
  /** Project folders on disk; without it, Project only explains what it would do. */
  readonly folders?: FolderService;
}

async function renderSong(project: Project, rng: Rng): Promise<Take> {
  const take = generateTake(project, rng);
  const buffer = await renderTake(take, project, EXPORT_SAMPLE_RATE);
  return { buffer, triggers: take.triggers, tapes: take.tapes };
}

function download(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const timestamp = () => new Date().toISOString().slice(0, 19).replaceAll(':', '-');

/** A name as it can stand in a file name: "Hek-tick Amen groove" → "hek-tick-amen-groove". */
export const fileSafe = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9åäöæø]+/g, '-')
    .replace(/^-+|-+$/g, '');

function exportWav(take: Take, name?: string): void {
  const { buffer } = take;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const part = name === undefined || fileSafe(name) === '' ? '' : `${fileSafe(name)}-`;
  download(`breakseq-${part}${timestamp()}.wav`, encodeWav({ sampleRate: buffer.sampleRate, channels }), 'audio/wav');
}

async function exportMidi(project: Project, take: Take): Promise<number> {
  const { midi, wav, pieces } = await midiExport(project, take, EXPORT_SAMPLE_RATE);
  const stamp = timestamp();
  download(`breakseq-${stamp}.mid`, midi, 'audio/midi');
  download(`breakseq-${stamp}-slices.wav`, wav, 'audio/wav');
  return pieces;
}

export function browserServices(): Services {
  return {
    storage: indexedDbStorage(),
    backups: indexedDbBackups(),
    folders: browserFolders(),
    player: createPlayer(),
    renderSong,
    exportWav,
    exportMidi,
    download,
    rng: () => Math.random,
  };
}
