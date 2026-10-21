import type { DelayPlay, Id, Project } from '../model';
import { STEPS_PER_BAR, effectiveHit, hitSound, songDuration, stepDuration } from '../model';
import type { Take, Trigger } from './generate';
import type { Mix, PlacedVoice, Rendered, Route } from './render';
import { audioKey, createSpace, delayKey, folded, placeVoices, renderTakeWhole, reverbKey, scheduleVoices, spaceRing, voiceEnd } from './render';
import { finishHeard } from './render-heard';

/**
 * Rendering in parts. Everything a take sounds is a sum of voices, each
 * started on a whole frame, and of a reverb and delay that are the same at any
 * time: so the take can be rendered a few bars at a time, each part on its own
 * context, and the parts added up give the same audio as one long render.
 *
 * A part holds the voices that start in it, for as long as they sound (a voice
 * that rings on into the next part is in this one only). What the voices send
 * to the reverb and delay comes out of the part as it is sent, one stereo pair
 * per room or delay; those sends are added up over the whole take and played
 * through the rooms and delays once at the end, as one long render would.
 *
 * Parts are kept by what is in them, so a render after a small change renders
 * only the parts that changed. One long OfflineAudioContext slows down far
 * more than its length grows; parts keep each context short.
 */

/** The length of a part, in bars of the song's tempo. */
export const CHUNK_BARS = 2;
/** Web Audio renders in blocks of this many frames. */
const QUANTUM = 128;
/** Parts rendered at once. */
const PARALLEL = 4;
/** An OfflineAudioContext has at most this many channels: the dry pair and one pair per room or delay. */
const MAX_CHANNELS = 32;

/** One part as rendered: its dry sound and its sends, from the frame it starts on. */
export interface ChunkAudio {
  readonly dry: readonly Float32Array[];
  readonly sends: ReadonlyMap<string, readonly Float32Array[]>;
  /** Floats it holds, for the cache's limit. */
  readonly size: number;
}

/** Parts and whole takes kept between renders: the most recently used, up to a limit in floats. */
export interface RenderCache {
  readonly chunks: Map<string, ChunkAudio>;
  readonly takes: Map<string, Rendered>;
  readonly limit: number;
  /** Floats held by the parts now. */
  size: number;
}

/** Whole takes kept: the last few, so a change undone or a render with nothing changed is there at once. */
const KEPT_TAKES = 4;

/** A cache for renders, holding parts of up to `limit` floats in all (32 M floats: 128 MB). */
export function createRenderCache(limit = 32 * 1024 * 1024): RenderCache {
  return { chunks: new Map(), takes: new Map(), limit, size: 0 };
}

export const remember = <T>(map: Map<string, T>, key: string): T | undefined => {
  const value = map.get(key);
  if (value !== undefined) {
    // Most recently used last.
    map.delete(key);
    map.set(key, value);
  }
  return value;
};

export function keepChunk(cache: RenderCache, key: string, chunk: ChunkAudio): void {
  if (cache.chunks.has(key)) return;
  cache.chunks.set(key, chunk);
  cache.size += chunk.size;
  for (const [oldKey, old] of cache.chunks) {
    if (cache.size <= cache.limit || oldKey === key) break;
    cache.chunks.delete(oldKey);
    cache.size -= old.size;
  }
}

function keepTake(cache: RenderCache, key: string, rendered: Rendered): void {
  cache.takes.delete(key);
  cache.takes.set(key, rendered);
  for (const oldKey of cache.takes.keys()) {
    if (cache.takes.size <= KEPT_TAKES) break;
    cache.takes.delete(oldKey);
  }
}

/** What a render may be told: where to keep parts, and when to give up because it is no longer wanted. */
export interface RenderOptions {
  readonly cache?: RenderCache;
  readonly signal?: AbortSignal;
  /** The length of a part in seconds; CHUNK_BARS of the song's tempo when left out. */
  readonly chunkSeconds?: number;
}

const CANCELLED = 'RenderCancelled';

/** Whether an error is a render given up because its signal aborted. */
export const isRenderCancelled = (e: unknown): boolean => e instanceof Error && e.name === CANCELLED;

function checkSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const error = new Error('The render was cancelled');
    error.name = CANCELLED;
    throw error;
  }
}

/** A send's key: a room by its size, a delay by its steps and feedback. */
const sendKeys = (trigger: Trigger): string[] => [
  ...(trigger.reverb === null ? [] : [`r${reverbKey(trigger.reverb.size)}`]),
  ...(trigger.delay === null ? [] : [`d${delayKey(trigger.delay)}`]),
];

/** What a hit's sound depends on beyond its trigger: its sample's audio, trim and channel, and its fade. */
function soundKeys(project: Project): (hitId: Id) => string {
  const keys = new Map<Id, string>();
  return (hitId) => {
    let key = keys.get(hitId);
    if (key === undefined) {
      const hit = project.hits[hitId];
      const sample = hit === undefined ? undefined : hitSound(project, hit)?.sample;
      const raw = sample === undefined ? undefined : project.audio[sample.audioId];
      key =
        hit === undefined || sample === undefined || raw === undefined
          ? '-'
          : `${audioKey(raw)}:${sample.offset}:${sample.duration}:${sample.channel}:${effectiveHit(project, hit).fadeOut}`;
      keys.set(hitId, key);
    }
    return key;
  };
}

/** A trigger as it sounds, without when: its hit's sound and every setting. */
const triggerKey = (trigger: Trigger, sound: (hitId: Id) => string): string => {
  const { time, bar, step, hitId, ...settings } = trigger;
  void time;
  void bar;
  void step;
  return `${sound(hitId)}|${JSON.stringify(settings)}`;
};

interface Chunk {
  /** The song frame it starts on. */
  readonly origin: number;
  /** Its length in frames: as long as anything in it sounds, at least to the next part. */
  readonly frames: number;
  readonly voices: readonly PlacedVoice[];
  readonly sends: readonly string[];
  readonly key: string;
}

/** The triggers what is heard is made of: all of them, also those under tapes. */
const heardOf = (take: Take): readonly Trigger[] => take.heard ?? take.triggers;

/**
 * What is heard split into parts of `chunkFrames`, each with the voices that
 * start in it and a key for what it holds. Tapes and audio mods are played
 * over the parts once they are added up (finishHeard).
 */
function chunksOf(take: Take, project: Project, sampleRate: number, length: number, total: number, chunkFrames: number): Chunk[] {
  const count = Math.max(1, Math.ceil(length / chunkFrames));
  const voices: PlacedVoice[][] = Array.from({ length: count }, () => []);
  const index = (frame: number) => Math.max(0, Math.min(count - 1, Math.floor(frame / chunkFrames)));
  for (const v of placeVoices(heardOf(take), [], sampleRate)) voices[index(v.frame)]!.push(v);
  const sound = soundKeys(project);

  return voices.map((inChunk, i): Chunk => {
    const origin = i * chunkFrames;
    let end = Math.min(total, (i + 1) * chunkFrames);
    for (const v of inChunk) {
      const over = voiceEnd(project, v.trigger, v.frame / sampleRate, v.chokeFrame / sampleRate, sampleRate);
      if (over !== null) end = Math.max(end, Math.ceil(over * sampleRate) + 1);
    }
    const frames = Math.max(1, Math.min(total, end) - origin);
    const sends = [...new Set(inChunk.flatMap((v) => sendKeys(v.trigger)))].sort();
    // Voices by their frames in the song: a sound that falls between frames, as a grain, is placed from where it is in the song.
    const voiceKeys = inChunk.map((v) => `${v.frame},${v.chokeFrame === Infinity ? '-' : v.chokeFrame},${triggerKey(v.trigger, sound)}`);
    return { origin, frames, voices: inChunk, sends, key: [sampleRate, origin, frames, ...voiceKeys].join('\n') };
  });
}

/** Renders one part: its dry sound in channels 0–1 and each send in a pair after it. */
async function renderChunk(chunk: Chunk, project: Project, sampleRate: number, signal: AbortSignal | undefined): Promise<ChunkAudio> {
  // Nothing starts in it: silence, without a context.
  if (chunk.voices.length === 0) return { dry: [], sends: new Map(), size: 0 };
  checkSignal(signal);
  const channels = 2 + 2 * chunk.sends.length;
  const context = new OfflineAudioContext({ numberOfChannels: channels, length: chunk.frames, sampleRate });
  const merger = context.createChannelMerger(channels);
  merger.connect(context.destination);
  /** A stereo bus into channels `first` and `first + 1`: mono is heard in both, as on a stereo destination. */
  const bus = (first: number): AudioNode => {
    const input = context.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    const split = context.createChannelSplitter(2);
    input.connect(split);
    split.connect(merger, 0, first);
    split.connect(merger, 1, first + 1);
    return input;
  };
  const dry = bus(0);
  const sends = new Map(chunk.sends.map((key, i) => [key, bus(2 + 2 * i)]));
  const sendTo = (key: string): AudioNode => sends.get(key)!;
  const route: Route = { dry, space: { reverb: (size) => sendTo(`r${reverbKey(size)}`), delay: (delay) => sendTo(`d${delayKey(delay)}`) } };
  scheduleVoices(context, project, chunk.voices, route, chunk.origin);
  const rendered = await context.startRendering();
  // Copies, not views: the part is added up later, after other parts have rendered, and in Node
  // (node-web-audio-api) a view does not keep its AudioBuffer alive: once the buffer is collected,
  // a view reads freed memory, and now and then a few frames came out wrong.
  const pair = (first: number) => [rendered.getChannelData(first).slice(), rendered.getChannelData(first + 1).slice()];
  return { dry: pair(0), sends: new Map(chunk.sends.map((key, i) => [key, pair(2 + 2 * i)])), size: channels * chunk.frames };
}

/** Adds `from` into `to` starting at frame `at`, as far as `to` goes. */
function addAt(to: Float32Array, from: Float32Array, at: number): void {
  const n = Math.min(from.length, to.length - at);
  for (let i = 0; i < n; i++) to[at + i]! += from[i]!;
}

/** Runs `jobs` with at most `width` at a time. */
async function inParallel(jobs: readonly (() => Promise<void>)[], width: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]!();
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
}

/** The sends of a whole take played through their rooms and delays, as long as `total`. */
async function renderSpace(sends: ReadonlyMap<string, readonly Float32Array[]>, take: Take, project: Project, sampleRate: number, total: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: total, sampleRate });
  const space = createSpace(context, context.destination, project.song.bpm);
  const reverbs = new Map<string, number>(heardOf(take).flatMap((t) => (t.reverb === null ? [] : [[`r${reverbKey(t.reverb.size)}`, t.reverb.size] as const])));
  const delays = new Map<string, DelayPlay>(heardOf(take).flatMap((t) => (t.delay === null ? [] : [[`d${delayKey(t.delay)}`, t.delay] as const])));
  for (const [key, pair] of sends) {
    const source = context.createBufferSource();
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate });
    pair.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    source.buffer = buffer;
    const size = reverbs.get(key);
    const delay: DelayPlay | undefined = delays.get(key);
    if (size !== undefined) source.connect(space.reverb(size));
    else if (delay !== undefined) source.connect(space.delay(delay));
    source.start(0);
  }
  return context.startRendering();
}

/**
 * Renders a take to audio offline, in parts (see above): the same audio as
 * renderTakeWhole. One voice: a new trigger or tape cuts the sound before it
 * with a short fade. Beside it the reverb and delay ring out. Tapes record the
 * hits alone. With a cache, parts that have not changed are not rendered
 * again; with a signal, the render gives up between parts once it aborts.
 */
export async function renderTakeWithTail(
  take: Take,
  project: Project,
  sampleRate: number,
  seconds = songDuration(project.song),
  mix: Mix = 'all',
  options: RenderOptions = {},
): Promise<Rendered> {
  const { signal } = options;
  const cache = options.cache ?? createRenderCache();
  checkSignal(signal);
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const ring = mix === 'dry' ? 0 : spaceRing(heardOf(take), project.song.bpm);
  const total = length + Math.round(ring * sampleRate);
  const chunkSeconds = options.chunkSeconds ?? CHUNK_BARS * STEPS_PER_BAR * stepDuration(project.song.bpm);
  // Parts start on whole render quanta, so k-rate automation such as a tape's speed is sampled where it is in one long render.
  const chunkFrames = Math.max(1, Math.round((chunkSeconds * sampleRate) / QUANTUM)) * QUANTUM;
  const chunks = chunksOf(take, project, sampleRate, length, total, chunkFrames);
  // More rooms and delays than a context has channels for: one long render, as before.
  if (chunks.some((c) => 2 + 2 * c.sends.length > MAX_CHANNELS)) return renderTakeWhole(take, project, sampleRate, seconds, mix);

  const takeKey = [mix, sampleRate, length, total, project.song.bpm, JSON.stringify(take.tapes), JSON.stringify(take.splices ?? []), ...chunks.map((c) => `${c.origin}\n${c.key}`)].join('\n@');
  const kept = remember(cache.takes, takeKey);
  if (kept !== undefined) return kept;

  const audio = new Map<Chunk, ChunkAudio>();
  const missing: Chunk[] = [];
  for (const chunk of chunks) {
    const found = remember(cache.chunks, chunk.key);
    if (found === undefined) missing.push(chunk);
    else audio.set(chunk, found);
  }
  await inParallel(
    missing.map((chunk) => async () => {
      checkSignal(signal);
      const rendered = await renderChunk(chunk, project, sampleRate, signal);
      audio.set(chunk, rendered);
      keepChunk(cache, chunk.key, rendered);
    }),
    PARALLEL,
  );
  checkSignal(signal);

  const out = [new Float32Array(total), new Float32Array(total)];
  const sends = new Map<string, Float32Array[]>();
  for (const chunk of chunks) {
    const part = audio.get(chunk)!;
    if (mix !== 'space') part.dry.forEach((data, c) => addAt(out[c]!, data, chunk.origin));
    if (mix === 'dry') continue;
    for (const [key, pair] of part.sends) {
      let into = sends.get(key);
      if (into === undefined) {
        into = [new Float32Array(total), new Float32Array(total)];
        sends.set(key, into);
      }
      pair.forEach((data, c) => addAt(into[c]!, data, chunk.origin));
    }
  }
  if (sends.size > 0) {
    const space = await renderSpace(sends, take, project, sampleRate, total);
    checkSignal(signal);
    out.forEach((data, c) => addAt(data, space.getChannelData(c), 0));
  }
  const finished = await finishHeard(out, take, sampleRate, mix, cache);
  checkSignal(signal);
  const full = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate });
  finished.forEach((data, c) => full.copyToChannel(data as Float32Array<ArrayBuffer>, c));
  const rendered = { full, buffer: total === length ? full : folded(full, length) };
  keepTake(cache, takeKey, rendered);
  return rendered;
}

/** Renders a take to audio offline, exactly as long as the song or `seconds`: ready to loop. */
export async function renderTake(take: Take, project: Project, sampleRate: number, seconds = songDuration(project.song)): Promise<AudioBuffer> {
  return (await renderTakeWithTail(take, project, sampleRate, seconds)).buffer;
}

/** Renders triggers to audio offline, with no tapes. */
export async function renderTriggers(triggers: readonly Trigger[], project: Project, sampleRate: number): Promise<AudioBuffer> {
  return renderTake({ triggers, tapes: [] }, project, sampleRate);
}
