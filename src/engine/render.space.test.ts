// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { Command, Hit, Project, StepEffect } from '../model';
import { addSample, createLoop, createMod, createProject, hitSpace, setBpm, setSongBars, setSongCell, setStep, updateHit } from '../model';
import { constantAudio, sequentialIds, withRng } from '../test/fixtures';
import { generateTake } from './generate';
import { renderTakeWithTail, spaceRing } from './render';
import { midiExport, renderSlices } from './render-slices';
import { midiPlan } from './midi';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/**
 * A one-bar song at 60 BPM (a step is 0.25 s) with one-shot A, of `seconds`,
 * on the steps in `a`, and one-shot B, 1 s long, on the steps in `b`.
 */
function song(a: { seconds: number; steps: number[]; change?: Partial<Hit> }, b: number[] = []) {
  let project = run(
    createProject(),
    setBpm(60),
    setSongBars(1),
    addSample({ name: 'a.wav', audio: constantAudio(a.seconds) }),
    addSample({ name: 'b.wav', audio: constantAudio(1) }),
    createLoop('L', 'main', 1),
  );
  const [hitA] = Object.values(project.hits);
  const [padA, padB] = Object.values(project.pads);
  const loop = Object.values(project.loops)[0]!;
  project = run(
    project,
    updateHit(hitA!.id, a.change ?? {}),
    ...a.steps.map((s) => setStep(loop.id, s, { padId: padA!.id })),
    ...b.map((s) => setStep(loop.id, s, { padId: padB!.id })),
    setSongCell('main', 0, loop.id),
  );
  return { project, hitA: hitA! };
}

/** The loudest sample between two times, in both channels. */
const peak = (buffer: AudioBuffer, from: number, to: number) => {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = Math.round(from * SAMPLE_RATE); i < Math.min(data.length, Math.round(to * SAMPLE_RATE)); i++) max = Math.max(max, Math.abs(data[i]!));
  }
  return max;
};

const withMod = (project: Project, ...effects: StepEffect[]) => {
  const next = run(project, createMod('m', effects));
  return run(next, setSongCell('modA', 0, Object.keys(next.mods).find((k) => !(k in project.mods))!));
};

describe('reverb and delay on a hit', () => {
  it('a slice with none takes its matrix\'s', () => {
    const { project, hitA } = song({ seconds: 0.1, steps: [0] });
    expect(hitSpace(project, hitA)).toEqual({ reverb: null, delay: null });
  });

  it('the reverb rings on after the next hit cuts the hit that sent to it', async () => {
    // A, 1 s long with all of it sent to a mid-sized reverb, is cut at 0.5 s by B, which sends nothing.
    const { project } = song({ seconds: 1, steps: [0], change: { reverb: { amount: 1, size: 0.5 } } }, [2]);
    const take = generateTake(project, withRng(() => 0));
    const space = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'space');
    // B is heard until 1.5 s; after it only A's reverb can be heard.
    expect(peak(space.full, 1.6, 2.0)).toBeGreaterThan(0.001);
    const dry = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'dry');
    expect(peak(dry.full, 1.6, 2.0)).toBe(0);
  });

  it('a delay echoes at its time in the song\'s tempo, and with no feedback once', async () => {
    // At 60 BPM a 1/8 is 0.5 s.
    const { project } = song({ seconds: 0.05, steps: [0], change: { delay: { amount: 1, steps: 2, feedback: 0 } } });
    const { full } = await renderTakeWithTail(generateTake(project, withRng(() => 0)), project, SAMPLE_RATE, undefined, 'space');
    expect(peak(full, 0, 0.45)).toBe(0);
    expect(peak(full, 0.5, 0.55)).toBeCloseTo(0.5, 2);
    expect(peak(full, 0.6, 1.2)).toBe(0);
  });

  it('what rings past the end comes in at the start of the looped take; the full take rings on after it', async () => {
    // A on the last step, 3.75 s, with a large reverb.
    const { project } = song({ seconds: 0.1, steps: [15], change: { reverb: { amount: 1, size: 1 } } });
    const take = generateTake(project, withRng(() => 0));
    expect(spaceRing(take.triggers, 60)).toBe(4);
    const { buffer, full } = await renderTakeWithTail(take, project, SAMPLE_RATE);
    expect(buffer.duration).toBeCloseTo(4, 5);
    expect(full.duration).toBeCloseTo(8, 5);
    expect(peak(full, 0, 0.5)).toBe(0);
    expect(peak(buffer, 0, 0.5)).toBeGreaterThan(0.0005);
    // The start of the looped take is the song's start plus what rang past the end.
    const at = Math.round(0.25 * SAMPLE_RATE);
    expect(buffer.getChannelData(0)[at]).toBeCloseTo(full.getChannelData(0)[at]! + full.getChannelData(0)[at + 4 * SAMPLE_RATE]!, 6);
  });

  it('with nothing sent the take is as it was: as long as the song, nothing after', async () => {
    const { project } = song({ seconds: 0.1, steps: [0, 8] });
    const { buffer, full } = await renderTakeWithTail(generateTake(project, withRng(() => 0)), project, SAMPLE_RATE);
    expect(full).toBe(buffer);
    expect(buffer.duration).toBeCloseTo(4, 5);
  });
});

describe('reverb and delay as mods', () => {
  const reverb = (values: number[], size: number): StepEffect => ({ target: 'reverb', step: '1/16', lane: values.map((v) => ({ v })), reverb: { size } });

  it('a Reverb mod sends the hits under it, in place of the hit\'s own; 0 sends none', () => {
    const { project } = song({ seconds: 0.1, steps: [0, 1, 2], change: { reverb: { amount: 0.2, size: 0.1 } } });
    const triggers = generateTake(withMod(project, reverb([60, 0], 0.8)), withRng(() => 0)).triggers;
    expect(triggers.map((t) => t.reverb)).toEqual([{ amount: 0.6, size: 0.8 }, null, { amount: 0.6, size: 0.8 }]);
  });

  it('amounts from A and B add up, to 100 %, and B\'s settings win', () => {
    const { project } = song({ seconds: 0.1, steps: [0] });
    const a = run(project, createMod('a', [reverb([70], 0.2)]));
    const b = run(a, createMod('b', [reverb([50], 0.9)]));
    const [modA, modB] = Object.keys(b.mods);
    const both = run(b, setSongCell('modA', 0, modA!), setSongCell('modB', 0, modB!));
    expect(generateTake(both, withRng(() => 0)).triggers[0]!.reverb).toEqual({ amount: 1, size: 0.9 });
  });

  it('a Delay mod at random sends some hits and not others', () => {
    const { project } = song({ seconds: 0.1, steps: [0, 1, 2, 3] });
    const delay: StepEffect = { target: 'delay', step: '1/16', lane: [{ lo: 50, hi: 50, chance: 50 }], delay: { steps: 3, feedback: 0.4 } };
    // The rng gives a chance roll, then a value, for each step: below 0.5 sends.
    const rolls = [0.1, 0, 0.9, 0.1, 0, 0.9];
    let i = 0;
    const triggers = generateTake(withMod(project, delay), withRng(() => rolls[i++ % rolls.length]!)).triggers;
    expect(triggers.map((t) => t.delay?.amount ?? 0)).toEqual([0.5, 0, 0.5, 0]);
  });
});

describe('exports with reverb and delay', () => {
  it('the slices are dry, and the reverb and delay come as a WAV of their own; none when nothing is sent', async () => {
    const dry = song({ seconds: 0.1, steps: [0] }).project;
    const wet = song({ seconds: 0.1, steps: [0], change: { reverb: { amount: 1, size: 0.3 } } }).project;
    const exported = async (project: Project) => {
      const take = generateTake(project, withRng(() => 0));
      const { buffer } = await renderTakeWithTail(take, project, SAMPLE_RATE);
      return { take, buffer, out: await midiExport(project, { ...take, buffer }, SAMPLE_RATE) };
    };
    const plain = await exported(dry);
    const spaced = await exported(wet);
    expect(plain.out.space).toBeNull();
    expect(spaced.out.space).not.toBeNull();
    // The same piece either way: the reverb is not in it.
    const pieceOf = async (x: Awaited<ReturnType<typeof exported>>, project: Project) =>
      (await renderSlices(project, midiPlan(project, x.take), x.buffer, SAMPLE_RATE)).audio.channels[0]!.slice(0, 4410);
    expect(await pieceOf(spaced, wet)).toEqual(await pieceOf(plain, dry));
  });
});
