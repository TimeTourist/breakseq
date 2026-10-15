import type { Project, Rng } from '../model';
import { EXPORT_SAMPLE_RATE, encodeWav, generateTake, renderTake } from '../engine';
import type { ProjectStorage } from './persist';
import { indexedDbStorage } from './persist';
import type { Player, Take } from './playback';
import { createPlayer } from './playback';

/** Everything the UI does outside React. Tests pass fakes. */
export interface Services {
  readonly storage: ProjectStorage;
  readonly player: Player;
  readonly renderSong: (project: Project, rng: Rng) => Promise<Take>;
  readonly exportWav: (take: Take) => void;
  /** Hands the user a file to save. */
  readonly download: (name: string, bytes: Uint8Array, type: string) => void;
  /** Fresh randomness for each take. */
  readonly rng: () => Rng;
}

async function renderSong(project: Project, rng: Rng): Promise<Take> {
  const take = generateTake(project, rng);
  const buffer = await renderTake(take, project, EXPORT_SAMPLE_RATE);
  return { buffer, triggers: take.triggers };
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

function exportWav(take: Take): void {
  const { buffer } = take;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  download(`breakseq-${timestamp()}.wav`, encodeWav({ sampleRate: buffer.sampleRate, channels }), 'audio/wav');
}

export function browserServices(): Services {
  return {
    storage: indexedDbStorage(),
    player: createPlayer(),
    renderSong,
    exportWav,
    download,
    rng: () => Math.random,
  };
}
