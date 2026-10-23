// Web Audio in Node, with views that keep their buffers alive.
import '../test/web-audio';
import { describe, expect, it } from 'vitest';
import type { AudioData, Project } from '../model';
import { STEPS_PER_BAR, addSample, crazyChain, goCrazy, newProject, setSlicing, stepDuration } from '../model';
import { sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import { renderTakeWithTail } from './render-chunks';

/** A one-bar break of 16 decaying tones, each a little higher: something to hear in every slice. */
function tones(seconds = 1.4, rate = 8000): AudioData {
  const length = Math.round(seconds * rate);
  const channel = new Float32Array(length);
  const slice = length / 16;
  for (let i = 0; i < length; i++) {
    const n = Math.floor(i / slice);
    const t = (i - n * slice) / rate;
    channel[i] = 0.6 * Math.sin(2 * Math.PI * (120 + 40 * n) * t) * Math.exp(-t * 12);
  }
  return { sampleRate: rate, channels: [channel, channel] };
}

/** The level of each bar of a rendered song: the loudest sample in it. */
async function barLevels(project: Project): Promise<number[]> {
  const { full } = await renderTakeWithTail(generateTake(project), project, 8000);
  const data = full.getChannelData(0);
  const barLength = Math.round(stepDuration(project.song.bpm) * STEPS_PER_BAR * full.sampleRate);
  return Array.from({ length: project.song.bars }, (_, b) => {
    let peak = 0;
    for (let i = b * barLength; i < Math.min(data.length, (b + 1) * barLength); i++) peak = Math.max(peak, Math.abs(data[i]!));
    return peak;
  });
}

describe('a song Crazy built (the listening proxy)', () => {
  const ctx = sequentialIds();
  const run = (project: Project, command: ReturnType<typeof goCrazy>) => {
    const result = command(project, ctx);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.project;
  };
  const added = run(newProject(ctx), addSample({ name: 'tones.wav', audio: tones() }));
  const song = run(added, crazyChain(setSlicing(Object.keys(added.samples)[0]!, 1)));

  it('is heard: no bar of it is silent', async () => {
    const levels = await barLevels(song);
    expect(levels).toHaveLength(16);
    expect(levels.filter((l) => l > 0.01)).toHaveLength(16);
  }, 60_000);

  it('after Go crazy too', async () => {
    const crazy = run(song, goCrazy());
    expect(crazy.song.clips).not.toEqual(song.song.clips);
    const levels = await barLevels(crazy);
    expect(levels.filter((l) => l > 0.01)).toHaveLength(16);
  }, 60_000);
});
