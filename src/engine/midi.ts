import type { Hit, Project } from '../model';
import { effectiveHit, hitColour, hitStretch } from '../model';
import type { AudioClip } from './audio-mods';
import type { Trigger } from './generate';
import { playedStretch } from './generate';
import type { Tape } from './tape';

/**
 * MIDI export: the song as notes and a WAV of the sounds they play, one per
 * key from C1 up, for a sampler such as Dr. Octo Rex or Digitakt. A piece is
 * every distinct sound heard in the song, mods and all, so the notes alone
 * play the song back as it sounds.
 */

/** C1, where slice 1 goes in Dr. Octo Rex. */
export const FIRST_NOTE = 36;
/** From C1 to G9, the highest MIDI note. */
export const MAX_PIECES = 128 - FIRST_NOTE;
/** Grid sizes a sampler can split a file into evenly. */
export const SLOT_GRIDS = [4, 8, 16, 32, 64] as const;
export const MIDI_VELOCITY = 100;
/** Ticks per quarter note. */
export const MIDI_PPQ = 960;

/**
 * One sound in the WAV: a trigger as heard (its first time in the song), a
 * tape segment, or a clip with an audio mod or Scratch. A tape and a clip are
 * cut from the song as heard, from `time` to `end`.
 */
export type Piece =
  | { readonly kind: 'hit'; readonly trigger: Trigger; readonly seconds: number }
  | { readonly kind: 'tape'; readonly tape: Tape; readonly seconds: number }
  | { readonly kind: 'audio'; readonly time: number; readonly end: number; readonly seconds: number };

/** A note: when, how long, and which piece it plays (0 is C1). */
export interface Note {
  readonly time: number;
  readonly length: number;
  readonly piece: number;
}

export interface MidiPlan {
  readonly pieces: readonly Piece[];
  readonly notes: readonly Note[];
}

export class MidiExportError extends Error {}

/** How long a trigger sounds if nothing cuts it: its region at its pitch and stretch. */
export const triggerSeconds = (t: Trigger): number =>
  ((t.region.end - t.region.start) / 2 ** (t.pitch / 12)) * (t.stretch?.factor ?? 1);

const round = (x: number, places: number) => x.toFixed(places);

/**
 * What makes two triggers the same sound: the sample and slice played, region,
 * fade, pitch, volume, pan, direction, stretch, dist and filter, to a hundredth. Not
 * the hit: copies that sound the same are one piece.
 */
const soundKey = (project: Project, t: Trigger): string => {
  const hit: Hit | undefined = project.hits[t.hitId];
  return [
    hit === undefined ? t.hitId : `${hit.sampleId}:${hit.slice ?? '-'}`,
    // Fade is applied at render from the hit and its layers; the trigger does not carry it.
    hit === undefined ? '-' : round(effectiveHit(project, hit).fadeOut, 1),
    round(t.region.start, 6),
    round(t.region.end, 6),
    round(t.pitch, 2),
    round(t.volume, 2),
    round(t.pan, 2),
    t.direction,
    t.stretch === null ? '-' : `${round(t.stretch.factor, 4)}:${round(t.stretch.grain, 2)}:${t.stretch.from}`,
    t.dist === null ? '-' : `${t.dist.mode}:${round(t.dist.amount, 3)}`,
    t.filter === null ? '-' : `${t.filter.type}:${round(t.filter.cutoff, 1)}:${round(t.filter.resonance, 3)}`,
  ].join('|');
};

/** Whether a trigger sounds as its hit does on its own: no variant, no mod. */
function isPlain(project: Project, t: Trigger): boolean {
  const hit: Hit | undefined = project.hits[t.hitId];
  if (hit === undefined || hit.variantOf !== null) return false;
  const own = effectiveHit(project, hit);
  const stretch = playedStretch(hitStretch(project, hit), null);
  const colour = hitColour(project, hit);
  const same = <T,>(a: T | null, b: T | null) => JSON.stringify(a) === JSON.stringify(b);
  return (
    same(colour.dist, t.dist) &&
    same(colour.filter, t.filter) &&
    Math.abs(own.pitch - t.pitch) < 0.005 &&
    Math.abs(own.volume - t.volume) < 0.005 &&
    Math.abs(Math.max(-1, Math.min(1, own.pan)) - t.pan) < 0.005 &&
    own.direction === t.direction &&
    (stretch === null ? t.stretch === null : t.stretch !== null && Math.abs(stretch.factor - t.stretch.factor) < 1e-4 && stretch.grain === t.stretch.grain && stretch.from === t.stretch.from)
  );
}

const EPSILON = 1e-9;

/**
 * What is left of a tape outside the clips with an audio mod or Scratch: those
 * are pieces of their own, cut with the tape as heard, so the tape is not
 * played twice.
 */
// TODO(spec): the spec does not say what the export does where a tape and a clip with an audio mod or Scratch overlap; here the clip's piece wins and the tape is cut around it.
function tapeOutside(tape: Tape, clips: readonly AudioClip[]): Tape[] {
  let parts: Tape[] = [tape];
  for (const clip of clips) {
    parts = parts.flatMap((p) => {
      if (clip.end <= p.time + EPSILON || clip.time >= p.end - EPSILON) return [p];
      return [
        ...(clip.time > p.time + EPSILON ? [{ ...p, end: clip.time }] : []),
        ...(clip.end < p.end - EPSILON ? [{ ...p, time: clip.end }] : []),
      ];
    });
  }
  return parts;
}


/** A take as the exports see it: the triggers heard, and the stretches cut from the song as heard. */
export interface ExportTake {
  readonly triggers: readonly Trigger[];
  readonly tapes: readonly Tape[];
  readonly audioClips?: readonly AudioClip[];
}

/**
 * The pieces and notes of a take. Pieces go by sample and slice: first each
 * sample's slices as they are (Amen 01, 02 …), then variants, then one-shots,
 * then what is cut from the song as heard, in time order: tape segments and
 * clips with an audio mod or Scratch, each a piece of its own (Magnus beslut
 * 2026-10-22). Under a clip there are no notes but its own; where it plays
 * over a tape, the tape is cut there. A note lasts as long as its sound is
 * heard: until it ends, or the next sound cuts it.
 */
export function midiPlan(project: Project, take: ExportTake): MidiPlan {
  const clips = take.audioClips ?? [];
  const under = (time: number) => clips.some((c) => time >= c.time - EPSILON && time < c.end - EPSILON);
  const triggers = take.triggers.filter((t) => !under(t.time)).sort((a, b) => a.time - b.time);
  const cutPieces: Piece[] = [
    ...take.tapes.flatMap((tape) => tapeOutside(tape, clips)).map((tape): Piece => ({ kind: 'tape', tape, seconds: tape.end - tape.time })),
    ...clips.map((c): Piece => ({ kind: 'audio', time: c.time, end: c.end, seconds: c.end - c.time })),
  ].sort((a, b) => cutTime(a) - cutTime(b));
  const cuts = [...triggers.map((t) => t.time), ...cutPieces.map(cutTime)].sort((a, b) => a - b);
  const sampleOrder = Object.keys(project.samples);

  const firsts = new Map<string, { trigger: Trigger; seconds: number; order: number[] }>();
  for (const t of triggers) {
    const key = soundKey(project, t);
    if (firsts.has(key)) continue;
    const hit = project.hits[t.hitId];
    const sample = hit === undefined ? undefined : project.samples[hit.sampleId];
    const tier = sample?.bars === null ? 2 : isPlain(project, t) ? 0 : 1;
    firsts.set(key, { trigger: t, seconds: triggerSeconds(t), order: [tier, sampleOrder.indexOf(hit?.sampleId ?? ''), hit?.slice ?? -1, t.time] });
  }
  const byOrder = (a: readonly number[], b: readonly number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  };
  const hits = [...firsts.entries()].sort(([, a], [, b]) => byOrder(a.order, b.order));
  const pieces: Piece[] = [...hits.map(([, p]): Piece => ({ kind: 'hit', trigger: p.trigger, seconds: p.seconds })), ...cutPieces];
  if (pieces.length > MAX_PIECES) {
    throw new MidiExportError(`The song has ${pieces.length} different sounds; a MIDI export has room for ${MAX_PIECES}, from C1 up`);
  }

  const index = new Map(hits.map(([key], i) => [key, i]));
  const notes: Note[] = [
    ...triggers.map((t): Note => {
      const next = cuts.find((c) => c > t.time + EPSILON);
      return { time: t.time, length: Math.min(triggerSeconds(t), next === undefined ? Infinity : next - t.time), piece: index.get(soundKey(project, t))! };
    }),
    ...cutPieces.map((p, i): Note => ({ time: cutTime(p), length: p.seconds, piece: hits.length + i })),
  ].sort((a, b) => a.time - b.time);
  return { pieces, notes };
}

/** Where a piece cut from the song starts in it. */
function cutTime(piece: Piece): number {
  return piece.kind === 'tape' ? piece.tape.time : piece.kind === 'audio' ? piece.time : piece.trigger.time;
}

/** Where a piece cut from the song is in it, in seconds; null for a hit, rendered on its own. */
export function cutSpan(piece: Piece): { readonly time: number; readonly end: number } | null {
  return piece.kind === 'tape' ? { time: piece.tape.time, end: piece.tape.end } : piece.kind === 'audio' ? { time: piece.time, end: piece.end } : null;
}

/** How many equal slots the WAV has for `count` pieces: up to a grid size, or exactly `count` past the largest. */
export function slotCount(count: number): number {
  return SLOT_GRIDS.find((g) => g >= count) ?? count;
}

/** A variable-length quantity, as MIDI writes delta times. */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  for (let v = value >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

/**
 * A standard MIDI file, format 0, with the song's tempo and the notes on
 * channel 1. Where a note ends as another starts, the end comes first.
 */
export function encodeMidi(bpm: number, notes: readonly Note[]): Uint8Array {
  const ticks = (seconds: number) => Math.round((seconds * bpm * MIDI_PPQ) / 60);
  const events = notes.flatMap((n) => {
    const on = ticks(n.time);
    const off = Math.max(on + 1, ticks(n.time + n.length));
    const key = FIRST_NOTE + n.piece;
    return [
      { tick: on, order: 1, bytes: [0x90, key, MIDI_VELOCITY] },
      { tick: off, order: 0, bytes: [0x80, key, 0] },
    ];
  });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const tempo = Math.round(60_000_000 / bpm);
  const name = [...'Breakseq'].map((c) => c.charCodeAt(0));
  const track: number[] = [
    ...[0, 0xff, 0x03, name.length, ...name],
    ...[0, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff],
    ...[0, 0xff, 0x58, 0x04, 4, 2, 24, 8],
  ];
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0);

  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return Uint8Array.from([
    ...text('MThd'),
    ...u32(6),
    0, 0, 0, 1,
    (MIDI_PPQ >> 8) & 0xff, MIDI_PPQ & 0xff,
    ...text('MTrk'),
    ...u32(track.length),
    ...track,
  ]);
}
