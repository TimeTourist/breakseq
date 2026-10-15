import type { AudioData, Direction, Hit, Project, Sample } from '../model';
import { effectiveHit, songDuration } from '../model';
import type { Take, Trigger } from './generate';
import type { Tape } from './tape';
import { tapePasses } from './tape';

/** Seconds a choked voice takes to fade out when the next trigger starts. */
export const CHOKE_FADE = 0.003;

const dbToGain = (db: number) => 10 ** (db / 20);

/** The sample's own audio as a buffer, reversed for 'reverse'. */
function sampleBuffer(context: BaseAudioContext, sample: Sample, audio: AudioData, direction: Direction): AudioBuffer {
  // Both ends are rounded, so neighbouring slices share their boundary frame exactly.
  const from = Math.round(sample.offset * audio.sampleRate);
  const length = Math.max(1, Math.round((sample.offset + sample.duration) * audio.sampleRate) - from);
  const buffer = context.createBuffer(audio.channels.length, length, audio.sampleRate);
  audio.channels.forEach((channel, i) => {
    const data = channel.slice(from, from + length);
    if (direction === 'reverse') data.reverse();
    buffer.copyToChannel(data, i);
  });
  return buffer;
}

/** What one voice plays: a hit with its final settings, as a trigger carries them. */
export type HitPlay = Pick<Trigger, 'hitId' | 'pitch' | 'volume' | 'direction' | 'region'>;

/** Sample buffers made on one context, per sample and direction. */
export type BufferCache = Map<string, AudioBuffer>;

/** A hit played as it is, with no mods: its own settings plus its parent's. */
export function hitPlay(project: Project, hit: Hit): HitPlay {
  const own = effectiveHit(project, hit);
  return { hitId: own.id, pitch: own.pitch, volume: own.volume, direction: own.direction, region: own.region };
}

/**
 * Schedules one voice on any context, offline or live: region, direction,
 * pitch as playback rate, volume and fade out. If `chokeAt` comes before the
 * voice ends, it fades out from there over CHOKE_FADE.
 */
export function scheduleHit(
  context: BaseAudioContext,
  cache: BufferCache,
  project: Project,
  play: HitPlay,
  start: number,
  chokeAt = Infinity,
): AudioBufferSourceNode | null {
  const hit = project.hits[play.hitId];
  const sample = hit === undefined ? undefined : project.samples[hit.sampleId];
  const audio = sample === undefined ? undefined : project.audio[sample.audioId];
  if (hit === undefined || sample === undefined || audio === undefined) return null;

  // Backwards buffers are worked out once per sample.
  const key = `${sample.id}:${play.direction}`;
  let buffer = cache.get(key);
  if (buffer === undefined) {
    buffer = sampleBuffer(context, sample, audio, play.direction);
    cache.set(key, buffer);
  }

  // In a reversed buffer the region is mirrored.
  const region =
    play.direction === 'forward'
      ? play.region
      : { start: sample.duration - play.region.end, end: sample.duration - play.region.start };
  const rate = 2 ** (play.pitch / 12);
  const naturalEnd = start + Math.max(0, region.end - region.start) / rate;
  const choked = chokeAt < naturalEnd;

  const level = dbToGain(play.volume);
  // The parent's fade applies where the slice has none.
  const fadeOut = effectiveHit(project, hit).fadeOut / 1000;
  const fadeStart = fadeOut > 0 ? Math.max(start, naturalEnd - fadeOut) : naturalEnd;
  const levelAt = (t: number) => (t <= fadeStart ? level : (level * (naturalEnd - t)) / (naturalEnd - fadeStart));

  const gain = context.createGain();
  gain.gain.setValueAtTime(level, start);
  if (choked) {
    if (fadeStart < chokeAt) {
      gain.gain.setValueAtTime(level, fadeStart);
      gain.gain.linearRampToValueAtTime(levelAt(chokeAt), chokeAt);
    } else {
      gain.gain.setValueAtTime(level, chokeAt);
    }
    gain.gain.linearRampToValueAtTime(0, chokeAt + CHOKE_FADE);
  } else if (fadeOut > 0) {
    gain.gain.setValueAtTime(level, fadeStart);
    gain.gain.linearRampToValueAtTime(0, naturalEnd);
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(gain).connect(context.destination);
  source.start(start, region.start);
  source.stop(choked ? chokeAt + CHOKE_FADE : naturalEnd);
  return source;
}

/** Plays triggers on a context, one voice: each trigger is cut where the next sound starts. */
function scheduleTriggers(context: BaseAudioContext, project: Project, triggers: readonly Trigger[], cuts: readonly number[], sampleRate: number) {
  const cache: BufferCache = new Map();
  const sorted = [...triggers].sort((a, b) => a.time - b.time);
  // Starts are placed on whole sample frames. Between frames Web Audio interpolates,
  // which dulls a slice by a varying amount; on a frame a slice plays back bit for bit.
  const onFrame = (time: number) => Math.round(time * sampleRate) / sampleRate;
  const starts = [...sorted.map((t) => onFrame(t.time)), ...cuts.map(onFrame)].sort((a, b) => a - b);
  sorted.forEach((trigger) => {
    const start = onFrame(trigger.time);
    const next = starts.find((s) => s > start);
    scheduleHit(context, cache, project, trigger, start, next ?? Infinity);
  });
}

/** Renders triggers alone into a buffer of `duration` seconds. */
async function renderPart(triggers: readonly Trigger[], project: Project, duration: number, sampleRate: number, cutAt: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  // The recording ends at the segment's end: what still rings is cut there.
  scheduleTriggers(context, project, triggers, [cutAt], sampleRate);
  return context.startRendering();
}

const reversed = (context: BaseAudioContext, buffer: AudioBuffer): AudioBuffer => {
  const copy = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let i = 0; i < buffer.numberOfChannels; i++) copy.copyToChannel(buffer.getChannelData(i).slice().reverse(), i);
  return copy;
};

/**
 * Plays a tape: its recording round and round as its passes say, with the
 * speed ramping as playback rate, so pitch and length follow like tape. It
 * fades out over CHOKE_FADE at its end.
 */
function scheduleTape(context: BaseAudioContext, tape: Tape, recording: AudioBuffer) {
  const backwards = reversed(context, recording);
  const gain = context.createGain();
  gain.gain.setValueAtTime(1, tape.time);
  gain.gain.setValueAtTime(1, Math.max(tape.time, tape.end - CHOKE_FADE));
  gain.gain.linearRampToValueAtTime(0, tape.end);
  gain.connect(context.destination);
  // Like tape, it gets quieter as it slows below 1×, so at 0× it is silent: a
  // stopped buffer would otherwise hold its last sample.
  const level = context.createGain();
  const { start: s0, end: s1 } = tape.speed;
  level.gain.setValueAtTime(Math.min(1, s0), tape.time);
  if ((s0 - 1) * (s1 - 1) < 0) level.gain.linearRampToValueAtTime(1, tape.time + ((1 - s0) / (s1 - s0)) * (tape.end - tape.time));
  level.gain.linearRampToValueAtTime(Math.min(1, s1), tape.end);
  level.connect(gain);
  for (const pass of tapePasses(tape)) {
    if (pass.end - pass.time <= 0) continue;
    const source = context.createBufferSource();
    source.buffer = pass.direction === 'forward' ? recording : backwards;
    source.playbackRate.setValueAtTime(pass.speedStart, pass.time);
    source.playbackRate.linearRampToValueAtTime(pass.speedEnd, pass.end);
    source.connect(level);
    // A backwards pass plays the reversed recording, so both start `from` into their buffer.
    source.start(pass.time, pass.from);
    source.stop(pass.end);
  }
}

/**
 * Renders a take to audio offline. One voice: a new trigger or tape cuts the
 * sound before it with a short fade. The buffer is exactly as long as the song.
 */
export async function renderTake(take: Take, project: Project, sampleRate: number): Promise<AudioBuffer> {
  const recordings = await Promise.all(take.tapes.map((tape) => renderPart(tape.source, project, tape.length, sampleRate, tape.length)));
  const length = Math.round(songDuration(project.song) * sampleRate);
  const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  scheduleTriggers(context, project, take.triggers, take.tapes.map((t) => t.time), sampleRate);
  take.tapes.forEach((tape, i) => scheduleTape(context, tape, recordings[i]!));
  return context.startRendering();
}

/** Renders triggers to audio offline, with no tapes. */
export async function renderTriggers(triggers: readonly Trigger[], project: Project, sampleRate: number): Promise<AudioBuffer> {
  return renderTake({ triggers, tapes: [] }, project, sampleRate);
}
