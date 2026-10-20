import type { AudioData, Project } from '../model';
import { encodeWav, normalizeGain, peakOf } from './codec';
import type { Trigger } from './generate';
import type { MidiPlan, Piece } from './midi';
import { encodeMidi, midiPlan, slotCount } from './midi';
import { renderTakeWithTail, scheduleHit } from './render';
import { encodeRex } from './rex';
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
  scheduleHit(context, project, piece.trigger, 0);
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
 * The song's reverb and delay alone, from its start for as long as they ring,
 * at `gain`: laid beside the dry slices in a DAW, from where the MIDI starts,
 * they sound like the song. Null when nothing is sent to them.
 */
async function spaceStem(
  project: Project,
  take: { readonly triggers: readonly Trigger[]; readonly tapes: readonly Tape[] },
  sampleRate: number,
  gain: number,
): Promise<Uint8Array | null> {
  if (!take.triggers.some((t) => t.reverb !== null || t.delay !== null)) return null;
  const { full } = await renderTakeWithTail(take, project, sampleRate, undefined, 'space');
  const channels = Array.from({ length: full.numberOfChannels }, (_, i) => full.getChannelData(i));
  return encodeWav({ sampleRate, channels }, { gain });
}

/**
 * The MIDI file and the WAV of slices for a take. The slices are normalized
 * like the song's own export, so the levels match; if a whole piece peaks
 * higher than the song does, they are brought down to fit. The slices are dry:
 * the reverb and delay come as a WAV of their own, at the same level.
 */
export async function midiExport(
  project: Project,
  take: { readonly triggers: readonly Trigger[]; readonly tapes: readonly Tape[]; readonly buffer: AudioBuffer },
  sampleRate: number,
): Promise<{ readonly midi: Uint8Array; readonly wav: Uint8Array; readonly pieces: number; readonly space: Uint8Array | null }> {
  const plan = midiPlan(project, take);
  const slices = await renderSlices(project, plan, take.buffer, sampleRate);
  const songChannels = Array.from({ length: take.buffer.numberOfChannels }, (_, i) => take.buffer.getChannelData(i));
  const gain = Math.min(normalizeGain(peakOf(songChannels)), normalizeGain(peakOf(slices.audio.channels)));
  return {
    midi: encodeMidi(project.song.bpm, plan.notes),
    wav: encodeWav(slices.audio, { gain, cues: slices.cues }),
    pieces: plan.pieces.length,
    space: await spaceStem(project, take, sampleRate, gain),
  };
}

/** The shortest slice in a REX file, in frames: a silent piece still gets a slice of its own, so the notes after it stay. */
const MIN_REX_SLICE = 256;

/**
 * The MIDI file and a REX2 file for a take: the same pieces as the WAV of
 * slices, one REX slice each, laid one after another, so MIDI note C1 and up
 * plays them in Dr. Octo Rex. Levels as the slices WAV.
 */
export async function rexExport(
  project: Project,
  take: { readonly triggers: readonly Trigger[]; readonly tapes: readonly Tape[]; readonly buffer: AudioBuffer },
  sampleRate: number,
): Promise<{ readonly midi: Uint8Array; readonly rex: Uint8Array; readonly pieces: number; readonly space: Uint8Array | null }> {
  const plan = midiPlan(project, take);
  const pieces = await Promise.all(plan.pieces.map((p) => pieceAudio(project, p, take.buffer, sampleRate)));
  const songChannels = Array.from({ length: take.buffer.numberOfChannels }, (_, i) => take.buffer.getChannelData(i));
  const gain = Math.min(normalizeGain(peakOf(songChannels)), normalizeGain(peakOf(pieces.flat())));
  const slices = pieces.map(([l, r]): [Float32Array, Float32Array] => {
    const length = Math.max(MIN_REX_SLICE, l!.length);
    const out: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
    l!.forEach((v, i) => (out[0][i] = v * gain));
    (r ?? l)!.forEach((v, i) => (out[1][i] = v * gain));
    return out;
  });
  return {
    midi: encodeMidi(project.song.bpm, plan.notes),
    rex: encodeRex({ sampleRate, bpm: project.song.bpm, slices }),
    pieces: plan.pieces.length,
    space: await spaceStem(project, take, sampleRate, gain),
  };
}
