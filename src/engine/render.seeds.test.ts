// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { Project } from '../model';
import { randomSong } from './fixtures/random-song';
import { generateTake } from './generate';
import { readProjectFile, writeProjectFile } from './project-file';
import { renderTakeWithTail } from './render-chunks';

describe('seeds: the same project sounds the same', () => {
  it('in Export WAV: the rendered audio is the same, also after Save and Load', async () => {
    const { project } = randomSong();
    const render = async (p: Project) => {
      const { full } = await renderTakeWithTail(generateTake(p), p, 8000);
      return Array.from({ length: full.numberOfChannels }, (_, i) => Array.from(full.getChannelData(i)));
    };
    const first = await render(project);
    expect(await render(project)).toEqual(first);
    expect(await render(readProjectFile(writeProjectFile(project)))).toEqual(first);
    expect(first[0]!.some((v) => v !== 0)).toBe(true);
    // Three renders of four bars with reverb and tape: give it time on a busy machine.
  }, 20_000);
});
