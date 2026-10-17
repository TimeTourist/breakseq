import type { AudioData, Project } from '../model';
import { encodeWav, normalizeGain, peakOf } from './codec';
import type { Trigger } from './generate';
import type { MidiPlan, Piece } from './midi';
import { encodeMidi, midiPlan, slotCount } from './midi';
import { scheduleHit } from './render';
import type { Tape } from './tape';

/** Silence after the longest piece in its slot, so every piece starts after a gap. */
export const SLOT_GAP = 0.01;

/** One piece on its own, as heard: a hit rendered whole, or a tape segment cut from the song. */
async function pieceAudio(project: Project, piece: Piece, song: AudioBuffer, sampleRate: number): Promise<Float32Array[]> {
  if (piece.kind === 'tape') {
    // Under a tape nothing else is heard, so the song there is the tape.
    const from = Math.round(piece.tape.time * sampleRate);
    const to = Math.round(piece.tape.end * sampleRate);
    return [0, 1].map((c) => song.getChannelData(Math.min(c, song.numberOfChannels - 1)).slice(from, to));
  }
  const length = Math.max(1, Math.ceil(piece.seconds * sampleRate));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  scheduleHit(context, new Map(), project, piece.trigger, 0);
  const buffer = await context.startRendering();
  return [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
}

/** The pieces laid out in equal slots, the longest piece plus a gap each, with a cue at every slot. */
export async function renderSlices(
  project: Project,
  plan: MidiPlan,
  song: AudioBuffer,
  sampleRate: number,
): Promise<{ readonly audio: AudioData; readonly cues: readonly number[] }> {
  const pieces = await Promise.all(plan.pieces.map((p) => pieceAudio(project, p, song, sampleRate)));
  const slot = Math.max(1, ...pieces.map((p) => p[0]!.length)) + Math.round(SLOT_GAP * sampleRate);
  const count = slotCount(pieces.length);
  const channels = [new Float32Array(slot * count), new Float32Array(slot * count)];
  pieces.forEach((piece, i) => piece.forEach((data, c) => channels[c]!.set(data, i * slot)));
  return { audio: { sampleRate, channels }, cues: Array.from({ length: count }, (_, i) => i * slot) };
}

/**
 * The MIDI file and the WAV of slices for a take. The slices are normalized
 * like the song's own export, so the levels match; if a whole piece peaks
 * higher than the song does, they are brought down to fit.
 */
export async function midiExport(
  project: Project,
  take: { readonly triggers: readonly Trigger[]; readonly tapes: readonly Tape[]; readonly buffer: AudioBuffer },
  sampleRate: number,
): Promise<{ readonly midi: Uint8Array; readonly wav: Uint8Array; readonly pieces: number }> {
  const plan = midiPlan(project, take);
  const slices = await renderSlices(project, plan, take.buffer, sampleRate);
  const songChannels = Array.from({ length: take.buffer.numberOfChannels }, (_, i) => take.buffer.getChannelData(i));
  const gain = Math.min(normalizeGain(peakOf(songChannels)), normalizeGain(peakOf(slices.audio.channels)));
  return {
    midi: encodeMidi(project.song.bpm, plan.notes),
    wav: encodeWav(slices.audio, { gain, cues: slices.cues }),
    pieces: plan.pieces.length,
  };
}
