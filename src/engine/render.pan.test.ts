// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Hit, Project, StepEffect } from '../model';
import { addSample, channelAudio, createLoop, createMod, createProject, effectiveHit, sampleAudio, setBpm, setMatrixConfig, setSlicing, setSampleChannel, setSongCell, setStep, updateHit } from '../model';
import { constantAudio, sequentialIds, withRng } from '../test/fixtures';
import { panGains } from './colour';
import { generateTriggers } from './generate';
import { renderTriggers } from './render';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** 0.2 s with 0.5 in the left channel and −0.25 in the right: drums left, the rest right. */
const wide: AudioData = { sampleRate: SAMPLE_RATE, channels: [new Float32Array(8820).fill(0.5), new Float32Array(8820).fill(-0.25)] };

/** One one-shot of `audio` on step 1 of a one-bar song at 60 BPM. */
function shot(audio: AudioData, change: Partial<Hit> = {}) {
  let project = run(createProject(), setBpm(60), addSample({ name: 's.wav', audio }), createLoop('L', 'main', 1));
  const hit = Object.values(project.hits)[0]!;
  const sample = Object.values(project.samples)[0]!;
  const loop = Object.values(project.loops)[0]!;
  project = run(project, updateHit(hit.id, change), setStep(loop.id, 0, { padId: Object.values(project.pads)[0]!.id }), setSongCell('main', 0, loop.id));
  return { project, hit, sample };
}

/** Left and right 0.1 s in. */
async function heard(project: Project): Promise<[number, number]> {
  const buffer = await renderTriggers(generateTriggers(project, withRng(() => 0)), project, SAMPLE_RATE);
  const at = Math.round(0.1 * SAMPLE_RATE);
  return [buffer.getChannelData(0)[at]!, buffer.getChannelData(1)[at]!];
}

describe('channel choice', () => {
  it('everything is stereo: Left or Right is that channel in both, Mono the two averaged, and a mono file in both', () => {
    expect(channelAudio(wide, 'left').channels.map((c) => c[0])).toEqual([0.5, 0.5]);
    expect(channelAudio(wide, 'right').channels.map((c) => c[0])).toEqual([-0.25, -0.25]);
    expect(channelAudio(wide, 'mono').channels.map((c) => c[0])).toEqual([0.125, 0.125]);
    expect(channelAudio(wide, 'stereo').channels.map((c) => c[0])).toEqual([0.5, -0.25]);
    const mono = constantAudio(0.1, [0.3]);
    expect(channelAudio(mono, 'stereo').channels).toHaveLength(2);
    // Worked out once.
    expect(channelAudio(wide, 'mono')).toBe(channelAudio(wide, 'mono'));
  });

  it('a sample plays the channels chosen for it', async () => {
    const { project, sample } = shot(wide);
    expect(await heard(project)).toEqual([expect.closeTo(0.5, 4), expect.closeTo(-0.25, 4)]);
    const left = run(project, setSampleChannel(sample.id, 'left'));
    expect(sampleAudio(left, left.samples[sample.id]!)!.channels[1]![0]).toBe(0.5);
    expect(await heard(left)).toEqual([expect.closeTo(0.5, 4), expect.closeTo(0.5, 4)]);
  });
});

describe('pan', () => {
  it('is balance with equal power: the middle as without pan, at one side the other channel silent and this one 3 dB up', () => {
    expect(panGains(0).left).toBeCloseTo(1);
    expect(panGains(0).right).toBeCloseTo(1);
    expect(panGains(1).left).toBeCloseTo(0);
    expect(panGains(1).right).toBeCloseTo(Math.SQRT2);
    // Power is the same everywhere.
    for (const p of [-1, -0.4, 0.3, 1]) expect(panGains(p).left ** 2 + panGains(p).right ** 2).toBeCloseTo(2);
  });

  it('a hit panned right plays the right channel only, louder', async () => {
    const { project } = shot(constantAudio(0.2, [0.4, 0.4]), { pan: 1 });
    const [l, r] = await heard(project);
    expect(l).toBeCloseTo(0, 4);
    expect(r).toBeCloseTo(0.4 * Math.SQRT2, 3);
  });

  it("the matrix's pan adds to a slice's, and mods add theirs in percent, kept within −100 and 100", () => {
    const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(start.samples)[0]!;
    let project = run(start, setSlicing(id, 1));
    const matrix = Object.values(project.matrices)[0]!;
    const slice = Object.values(project.hits).find((h) => h.slice === 0)!;
    project = run(project, setMatrixConfig(matrix.id, { pan: -0.5 }), updateHit(slice.id, { pan: 0.2 }));
    expect(effectiveHit(project, project.hits[slice.id]!).pan).toBeCloseTo(-0.3);

    const m1 = Object.values(project.loops)[0]!;
    project = run(project, setSongCell('main', 0, m1.id));
    const pan = (values: number[]): StepEffect => ({ target: 'pan', step: '1/16', lane: values.map((v) => ({ v })) });
    const a = run(project, createMod('a', [pan([50])]));
    const b = run(a, createMod('b', [pan([100])]));
    const [modA, modB] = Object.keys(b.mods);
    const both = run(b, setSongCell('modA', 0, modA!), setSongCell('modB', 0, modB!));
    const triggers = generateTriggers(both, withRng(() => 0));
    // −0.3 + 0.5 + 1 = 1.2, kept at 1.
    expect(triggers[0]!.pan).toBe(1);
    expect(generateTriggers(run(b, setSongCell('modA', 0, modA!)), withRng(() => 0))[0]!.pan).toBeCloseTo(0.2);
  });
});
