import type { AudioData, Direction, Project, Sample } from '../model';
import { songDuration } from '../model';
import type { Trigger } from './generate';

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

/**
 * Renders triggers to audio offline. One voice: a new trigger cuts the
 * previous one with a short fade. The buffer is exactly as long as the song.
 */
export async function renderTriggers(triggers: readonly Trigger[], project: Project, sampleRate: number): Promise<AudioBuffer> {
  const length = Math.round(songDuration(project.song) * sampleRate);
  const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const buffers = new Map<string, AudioBuffer>();
  const sorted = [...triggers].sort((a, b) => a.time - b.time);
  // Starts are placed on whole sample frames. Between frames Web Audio interpolates,
  // which dulls a slice by a varying amount; on a frame a slice plays back bit for bit.
  const onFrame = (time: number) => Math.round(time * sampleRate) / sampleRate;

  sorted.forEach((trigger, i) => {
    const hit = project.hits[trigger.hitId];
    const sample = hit === undefined ? undefined : project.samples[hit.sampleId];
    const audio = sample === undefined ? undefined : project.audio[sample.audioId];
    if (hit === undefined || sample === undefined || audio === undefined) return;

    // Backwards buffers are worked out once per sample.
    const key = `${sample.id}:${trigger.direction}`;
    let buffer = buffers.get(key);
    if (buffer === undefined) {
      buffer = sampleBuffer(context, sample, audio, trigger.direction);
      buffers.set(key, buffer);
    }

    // In a reversed buffer the region is mirrored.
    const region =
      trigger.direction === 'forward'
        ? trigger.region
        : { start: sample.duration - trigger.region.end, end: sample.duration - trigger.region.start };
    const rate = 2 ** (trigger.pitch / 12);
    const start = onFrame(trigger.time);
    const naturalEnd = start + Math.max(0, region.end - region.start) / rate;
    const following = sorted[i + 1];
    const next = following === undefined ? Infinity : onFrame(following.time);
    const choked = next < naturalEnd;

    const level = dbToGain(trigger.volume);
    const fadeOut = hit.fadeOut / 1000;
    const fadeStart = fadeOut > 0 ? Math.max(start, naturalEnd - fadeOut) : naturalEnd;
    const levelAt = (t: number) =>
      t <= fadeStart ? level : (level * (naturalEnd - t)) / (naturalEnd - fadeStart);

    const gain = context.createGain();
    gain.gain.setValueAtTime(level, start);
    if (choked) {
      if (fadeStart < next) {
        gain.gain.setValueAtTime(level, fadeStart);
        gain.gain.linearRampToValueAtTime(levelAt(next), next);
      } else {
        gain.gain.setValueAtTime(level, next);
      }
      gain.gain.linearRampToValueAtTime(0, next + CHOKE_FADE);
    } else if (fadeOut > 0) {
      gain.gain.setValueAtTime(level, fadeStart);
      gain.gain.linearRampToValueAtTime(0, naturalEnd);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(gain).connect(context.destination);
    source.start(start, region.start);
    source.stop(choked ? next + CHOKE_FADE : naturalEnd);
  });

  return context.startRendering();
}
