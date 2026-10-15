import type { Project, Rng } from '../model';
import { EXPORT_SAMPLE_RATE, encodeWav, generateTriggers, renderTriggers } from '../engine';
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
  /** Fresh randomness for each take. */
  readonly rng: () => Rng;
}

async function renderSong(project: Project, rng: Rng): Promise<Take> {
  const triggers = generateTriggers(project, rng);
  const buffer = await renderTriggers(triggers, project, EXPORT_SAMPLE_RATE);
  return { buffer, triggers };
}

function exportWav(take: Take): void {
  const { buffer } = take;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const bytes = encodeWav({ sampleRate: buffer.sampleRate, channels });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `breakseq-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.wav`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function browserServices(): Services {
  return {
    storage: indexedDbStorage(),
    player: createPlayer(),
    renderSong,
    exportWav,
    rng: () => Math.random,
  };
}
