import type { Project } from '../model';
import { encodeWav } from './codec';
import { generateTake } from './generate';
import { encodeMidi, midiPlan } from './midi';
import { renderTakeWithTail } from './render-chunks';
import { pieceAudio, spaceStem } from './render-slices';

/**
 * What the plugin sends to Reason (docs/vst-spec.md, Song to Audio och Song
 * to MIDI). Both render the whole song in Reason's sample rate, at the level
 * Play has: nothing is normalized (Claudes val).
 */

/** The song as heard, with what rings past its end, as a WAV. */
export async function songToAudio(project: Project, sampleRate: number): Promise<Uint8Array> {
  const take = generateTake(project);
  const { full } = await renderTakeWithTail(take, project, sampleRate);
  const channels = Array.from({ length: full.numberOfChannels }, (_, c) => full.getChannelData(c));
  return encodeWav({ sampleRate, channels }, { gain: 1 });
}

export interface SongToMidi {
  /** One sound per key from C1, stereo: as the rx2 export's slices (Magnus beslut). */
  readonly pieces: readonly (readonly Float32Array[])[];
  readonly midi: Uint8Array;
  /** The song's reverb and delay alone, silent under what is cut from the song; null when nothing is sent to them. */
  readonly space: Uint8Array | null;
  /** Identifies the pieces: the same sounds give the same fingerprint. */
  readonly fingerprint: string;
}

/**
 * The song as the rx2 export makes it, but for the plugin's sampler: every
 * distinct sound a piece, a hit with everything but reverb and delay, Tape,
 * Scratch and audio mods cut from the song as heard; the reverb and delay a
 * WAV of their own. Throws MidiExportError past 92 pieces.
 */
export async function songToMidi(project: Project, sampleRate: number): Promise<SongToMidi> {
  const take = generateTake(project);
  const plan = midiPlan(project, take);
  const { buffer } = await renderTakeWithTail(take, project, sampleRate);
  const pieces = await Promise.all(plan.pieces.map((p) => pieceAudio(project, p, buffer, sampleRate)));
  const stereo = pieces.map(([l, r]) => [l!, r ?? l!]);
  return {
    pieces: stereo,
    midi: encodeMidi(project.song.bpm, plan.notes),
    space: await spaceStem(project, take, sampleRate, 1),
    fingerprint: fingerprint(stereo, sampleRate),
  };
}

/** FNV-1a over the pieces' samples, their lengths and the rate: equal pieces, equal fingerprint. */
export function fingerprint(pieces: readonly (readonly Float32Array[])[], sampleRate: number): string {
  let hash = 0x811c9dc5;
  const mix = (n: number) => {
    hash ^= n;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  mix(sampleRate);
  mix(pieces.length);
  for (const piece of pieces) {
    for (const channel of piece) {
      mix(channel.length);
      const words = new Uint32Array(channel.buffer, channel.byteOffset, channel.length);
      for (const w of words) mix(w);
    }
  }
  return `${pieces.length}:${hash.toString(16).padStart(8, '0')}`;
}
