import type { AudioData, Project, Rng } from '../model';
import type { HitRun } from '../engine';
import { EXPORT_SAMPLE_RATE, encodeWav, generateTake, midiExport, renderTakeWithTail, rexExport } from '../engine';
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
  /** Renders what a view plays that is not a song: hits one after another, or a sample's audio as it is. */
  readonly renderPreview: (preview: Preview) => Promise<Take>;
  /** Saves a take as WAV; `name`, e.g. a snapshot's, goes in the file name. */
  readonly exportWav: (take: Take, name?: string) => void;
  /** Saves the song as a MIDI file and a WAV of its sounds in slots; says how many sounds. */
  readonly exportMidi: (project: Project, take: Take) => Promise<number>;
  /** Saves the song as a MIDI file and a REX file of its sounds, one slice each; says how many sounds. */
  readonly exportRex: (project: Project, take: Take) => Promise<number>;
  /** Hands the user a file to save. */
  readonly download: (name: string, bytes: Uint8Array, type: string) => void;
  /** Fresh randomness for each take. */
  readonly rng: () => Rng;
  /** Project folders on disk; without it, Project only explains what it would do. */
  readonly folders?: FolderService;
}

/** Something Play plays that is not a song. */
export type Preview =
  | { readonly kind: 'hits'; readonly project: Project; readonly run: HitRun }
  | { readonly kind: 'audio'; readonly audio: AudioData };

async function renderPreview(preview: Preview): Promise<Take> {
  if (preview.kind === 'hits') {
    const take = { triggers: preview.run.triggers, tapes: [] };
    return { ...take, ...withTail(await renderTakeWithTail(take, preview.project, EXPORT_SAMPLE_RATE, preview.run.seconds)) };
  }
  const { audio } = preview;
  const length = Math.max(1, audio.channels[0]?.length ?? 0);
  const buffer = new AudioBuffer({ numberOfChannels: Math.max(1, audio.channels.length), length, sampleRate: audio.sampleRate });
  audio.channels.forEach((channel, i) => buffer.copyToChannel(Float32Array.from(channel), i));
  return { buffer, triggers: [], tapes: [] };
}

async function renderSong(project: Project, rng: Rng): Promise<Take> {
  const take = generateTake(project, rng);
  return { ...withTail(await renderTakeWithTail(take, project, EXPORT_SAMPLE_RATE)), triggers: take.triggers, tapes: take.tapes };
}

/** A take's buffers: `full` only when something rings past the end. */
const withTail = ({ buffer, full }: { buffer: AudioBuffer; full: AudioBuffer }): Pick<Take, 'buffer' | 'full'> => (full === buffer ? { buffer } : { buffer, full });

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

/** The song as heard, then its reverb and delay ringing out. */
function exportWav(take: Take, name?: string): void {
  const buffer = take.full ?? take.buffer;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const part = name === undefined || fileSafe(name) === '' ? '' : `${fileSafe(name)}-`;
  download(`breakseq-${part}${timestamp()}.wav`, encodeWav({ sampleRate: buffer.sampleRate, channels }), 'audio/wav');
}

async function exportMidi(project: Project, take: Take): Promise<number> {
  const { midi, wav, pieces, space } = await midiExport(project, take, EXPORT_SAMPLE_RATE);
  const stamp = timestamp();
  download(`breakseq-${stamp}.mid`, midi, 'audio/midi');
  download(`breakseq-${stamp}-slices.wav`, wav, 'audio/wav');
  if (space !== null) download(`breakseq-${stamp}-reverb-delay.wav`, space, 'audio/wav');
  return pieces;
}

async function exportRex(project: Project, take: Take): Promise<number> {
  const { midi, rex, pieces, space } = await rexExport(project, take, EXPORT_SAMPLE_RATE);
  const stamp = timestamp();
  download(`breakseq-${stamp}.mid`, midi, 'audio/midi');
  download(`breakseq-${stamp}.rx2`, rex, 'application/octet-stream');
  if (space !== null) download(`breakseq-${stamp}-reverb-delay.wav`, space, 'audio/wav');
  return pieces;
}

export function browserServices(): Services {
  return {
    storage: indexedDbStorage(),
    backups: indexedDbBackups(),
    folders: browserFolders(),
    player: createPlayer(),
    renderSong,
    renderPreview,
    exportWav,
    exportMidi,
    exportRex,
    download,
    rng: () => Math.random,
  };
}
