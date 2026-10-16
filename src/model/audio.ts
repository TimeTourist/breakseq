import type { AudioData, Project, Sample, SampleChannel } from './types';

const made = new WeakMap<AudioData, Map<SampleChannel, AudioData>>();

/**
 * Audio with a channel choice, always in stereo: Stereo as it is (a mono file
 * in both), Left or Right that channel in both, Mono the channels averaged in
 * both. Worked out once per audio and choice; the arrays are shared, never
 * changed.
 */
export function channelAudio(audio: AudioData, channel: SampleChannel): AudioData {
  let byChoice = made.get(audio);
  if (byChoice === undefined) {
    byChoice = new Map();
    made.set(audio, byChoice);
  }
  const known = byChoice.get(channel);
  if (known !== undefined) return known;
  const left = audio.channels[0] ?? new Float32Array(0);
  const right = audio.channels[1] ?? left;
  let channels: Float32Array[];
  switch (channel) {
    case 'stereo':
      channels = [left, right];
      break;
    case 'left':
      channels = [left, left];
      break;
    case 'right':
      channels = [right, right];
      break;
    case 'mono': {
      const both = new Float32Array(left.length);
      for (let i = 0; i < both.length; i++) both[i] = (left[i]! + (right[i] ?? 0)) / 2;
      channels = [both, both];
      break;
    }
  }
  const out: AudioData = { sampleRate: audio.sampleRate, channels };
  byChoice.set(channel, out);
  return out;
}

/** A sample's audio as it plays: its file with its channel choice. */
export function sampleAudio(project: Project, sample: Sample): AudioData | undefined {
  const audio = project.audio[sample.audioId];
  return audio === undefined ? undefined : channelAudio(audio, sample.channel);
}
