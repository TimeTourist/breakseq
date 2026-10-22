// Web Audio in Node, with views that keep their buffers alive.
import '../test/web-audio';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Id, ModEffect, Project, StepEffect } from '../model';
import { addClip, addSample, createLoop, createMod, createProject, newScratch, newStepEffect, setBpm, setHitSource, setSongBars, setSongCell, setStep } from '../model';
import { constantAudio, seededRng, sequentialIds, withRng } from '../test/fixtures';
import { decodeAudioFile, readCues } from './codec';
import { generateTake } from './generate';
import { midiPlan } from './midi';
import { hitSeconds } from './preview';
import { renderTake, renderTakeWithTail } from './render';
import { SLOT_GAP, midiExport, renderSlices, rexExport } from './render-slices';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

describe('MIDI export', () => {
  it('lays each sound in an equal slot, the longest plus a gap, with a cue at every slot and silence after each sound', async () => {
    // A 0.1 s and a 0.2 s one-shot, on steps 1 and 9 of a bar at 60 BPM (a step is 0.25 s).
    let project = run(createProject(), setBpm(60), addSample({ name: 'a.wav', audio: constantAudio(0.1) }), addSample({ name: 'b.wav', audio: constantAudio(0.2) }), createLoop('L', 'main', 1));
    const [a, b] = Object.values(project.pads);
    const loop = Object.values(project.loops)[0]!;
    project = run(project, setStep(loop.id, 0, { padId: a!.id }), setStep(loop.id, 8, { padId: b!.id }), setSongCell('main', 0, loop.id));
    const take = generateTake(project, withRng(() => 0));
    const buffer = await renderTake(take, project, SAMPLE_RATE);
    const { wav, midi, pieces } = await midiExport(project, { ...take, buffer }, SAMPLE_RATE);

    expect(pieces).toBe(2);
    expect(String.fromCharCode(...midi.slice(0, 4))).toBe('MThd');
    const slot = Math.round(0.2 * SAMPLE_RATE) + Math.round(SLOT_GAP * SAMPLE_RATE);
    const audio = decodeAudioFile(wav);
    // Two sounds round up to four slots.
    expect(audio.channels[0]!.length).toBe(slot * 4);
    expect(readCues(wav).map((s) => Math.round(s * SAMPLE_RATE))).toEqual([0, slot, slot * 2, slot * 3]);
    const at = (seconds: number, offset = 0) => audio.channels[0]![offset + Math.round(seconds * SAMPLE_RATE)]!;
    // Sound 1 for 0.1 s, then silence to the next slot; sound 2 for 0.2 s.
    expect(at(0.05)).toBeGreaterThan(0.1);
    expect(at(0.15)).toBe(0);
    expect(at(0.1, slot)).toBeGreaterThan(0.1);
    expect(at(0.205, slot)).toBe(0);
    // The same level as the song: both are 0.5, brought to −0.3 dBFS.
    expect(at(0.05)).toBeCloseTo(at(0.1, slot), 4);
  });

  it('REX: one slice per sound, laid one after another, the loop padded to whole beats at the song tempo', async () => {
    let project = run(createProject(), setBpm(60), addSample({ name: 'a.wav', audio: constantAudio(0.1) }), addSample({ name: 'b.wav', audio: constantAudio(0.2) }), createLoop('L', 'main', 1));
    const [a, b] = Object.values(project.pads);
    const loop = Object.values(project.loops)[0]!;
    project = run(project, setStep(loop.id, 0, { padId: a!.id }), setStep(loop.id, 8, { padId: b!.id }), setSongCell('main', 0, loop.id));
    const take = generateTake(project, withRng(() => 0));
    const buffer = await renderTake(take, project, SAMPLE_RATE);
    const { rex, midi, pieces } = await rexExport(project, { ...take, buffer }, SAMPLE_RATE);

    expect(pieces).toBe(2);
    expect(String.fromCharCode(...midi.slice(0, 4))).toBe('MThd');
    const view = new DataView(rex.buffer);
    const chunks = (id: string) => [...rex.keys()].filter((i) => String.fromCharCode(...rex.slice(i, i + 4)) === id).map((i) => i + 8);
    // Starts and lengths: 0.1 s, then 0.2 s padded to the end of the beat (1 s at 60 BPM).
    expect(chunks('SLCE').map((at) => [view.getUint32(at), view.getUint32(at + 4)])).toEqual([
      [0, 0.1 * SAMPLE_RATE],
      [0.1 * SAMPLE_RATE, 0.9 * SAMPLE_RATE],
    ]);
    const glob = chunks('GLOB')[0]!;
    // The tempo, in thousandths of a BPM.
    expect(view.getUint32(glob + 16)).toBe(60000);
  });
});

describe('a hit past the last slice', () => {
  it('a hit past the last slice is silent in generate, render, MIDI and REX', async () => {
    // b's hit plays slice 5 of a sample with one slice: past its last marker.
    let project = run(createProject(), setBpm(60), addSample({ name: 'a.wav', audio: constantAudio(0.1) }), addSample({ name: 'b.wav', audio: constantAudio(0.2) }), createLoop('L', 'main', 1));
    const [a, b] = Object.values(project.pads);
    const bHit = project.hits[b!.members[0]!]!;
    const loop = Object.values(project.loops)[0]!;
    project = run(project, setHitSource(bHit.id, bHit.sampleId, 5), setStep(loop.id, 0, { padId: a!.id }), setStep(loop.id, 8, { padId: b!.id }), setSongCell('main', 0, loop.id));

    // Generate: only a plays.
    const take = generateTake(project, withRng(() => 0));
    expect(take.triggers.map((t) => t.step)).toEqual([0]);
    // Render: silence where b would be (step 8 is at 2 s).
    const buffer = await renderTake(take, project, SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    expect(data.slice(Math.round(2 * SAMPLE_RATE), Math.round(2.2 * SAMPLE_RATE)).every((v) => Math.abs(v) < 1e-9)).toBe(true);
    expect(hitSeconds(project, project.hits[bHit.id]!)).toBe(0);
    // MIDI and REX: one piece, a's.
    expect(midiPlan(project, take).pieces).toHaveLength(1);
    expect((await midiExport(project, { ...take, buffer }, SAMPLE_RATE)).pieces).toBe(1);
    expect((await rexExport(project, { ...take, buffer }, SAMPLE_RATE)).pieces).toBe(1);
  });
});

describe('a clip with an audio mod or Scratch in the exports (Magnus beslut 2026-10-22)', () => {
  const noise = (seconds: number, seed: number): AudioData => {
    const rng = seededRng(seed);
    const length = Math.round(seconds * SAMPLE_RATE);
    return { sampleRate: SAMPLE_RATE, channels: [0, 1].map(() => Float32Array.from({ length }, () => rng() * 2 - 1)) };
  };
  const withMod = (project: Project, effects: readonly ModEffect[], start: number, length: number, row: 'modA' | 'modB'): Project => {
    const made = run(project, createMod('M', effects));
    return run(made, addClip(row, Object.keys(made.mods).find((k) => !(k in project.mods))! as Id, start, length));
  };
  /** Two bars at 120 BPM (a step is 0.125 s), a hit of noise on every beat, thrown into a reverb in the first two beats. */
  function plain(): Project {
    let project = run(createProject(), setBpm(120), setSongBars(2), addSample({ name: 's', audio: noise(0.6, 4) }), createLoop(null, 'main', 1));
    const pad = Object.values(project.pads)[0]!.id;
    const loop = Object.values(project.loops)[0]!.id;
    project = run(project, ...[0, 4, 8, 12].map((i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 32));
    const reverb: StepEffect = { ...newStepEffect('reverb'), step: 'bar', lane: [{ v: 100 }], reverb: { size: 0.5 } };
    return withMod(project, [reverb], 0, 8, 'modA');
  }
  const roll: StepEffect = { ...newStepEffect('stutter'), step: '1/16', lane: [1, 2, 3, 3].map((v) => ({ v })) };
  /** A Stutter from 1 s to 2 s, and a Scratch from 2.5 s to 3.5 s. */
  const modded = () => withMod(withMod(plain(), [roll], 8, 8, 'modA'), [newScratch()], 20, 8, 'modB');
  const rendered = async (project: Project) => {
    const take = generateTake(project);
    return { take, buffer: (await renderTakeWithTail(take, project, SAMPLE_RATE)).buffer };
  };

  it('each is a piece of its own, after the hits, and its note plays it where the clip is', () => {
    const project = modded();
    const plan = midiPlan(project, generateTake(project));
    expect(plan.pieces.slice(-2)).toEqual([
      { kind: 'audio', time: 1, end: 2, seconds: 1 },
      { kind: 'audio', time: 2.5, end: 3.5, seconds: 1 },
    ]);
    const n = plan.pieces.length;
    expect(plan.notes.filter((x) => x.piece >= n - 2)).toEqual([
      { time: 1, length: 1, piece: n - 2 },
      { time: 2.5, length: 1, piece: n - 1 },
    ]);
  });

  it('the Stutter piece in the WAV of slices sounds as the song under the clip, Stutter and all', async () => {
    const project = modded();
    const { take, buffer } = await rendered(project);
    const plan = midiPlan(project, take);
    const { audio, cues } = await renderSlices(project, plan, buffer, SAMPLE_RATE);
    const at = cues[plan.pieces.length - 2]!;
    const from = SAMPLE_RATE;
    for (let c = 0; c < 2; c++) {
      const piece = audio.channels[c]!.slice(at, at + SAMPLE_RATE);
      expect(piece).toEqual(buffer.getChannelData(c).slice(from, from + SAMPLE_RATE));
    }
    // And the song there is not as without the Stutter.
    const without = (await rendered(plain())).buffer.getChannelData(0).slice(from, from + SAMPLE_RATE);
    expect(Math.max(...without.map((v, i) => Math.abs(v - audio.channels[0]![at + i]!)))).toBeGreaterThan(0.1);
  });

  it('the reverb and delay WAV is silent under the clips, and rings where they are not', async () => {
    const project = modded();
    const { take, buffer } = await rendered(project);
    const { space, pieces } = await midiExport(project, { ...take, buffer }, SAMPLE_RATE);
    const data = decodeAudioFile(space!).channels[0]!;
    const peak = (from: number, to: number) => Math.max(...data.slice(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE)).map(Math.abs));
    expect(peak(0.5, 1)).toBeGreaterThan(0.001);
    expect(peak(1.004, 2)).toBe(0);
    expect(peak(2, 2.5)).toBeGreaterThan(0.0001);
    expect(peak(2.504, 3.5)).toBe(0);
    expect(pieces).toBe(midiPlan(project, take).pieces.length);
  });

  it('REX: each is a slice of its own, as long as its clip', async () => {
    const project = modded();
    const { take, buffer } = await rendered(project);
    const { rex, pieces } = await rexExport(project, { ...take, buffer }, SAMPLE_RATE);
    expect(pieces).toBe(midiPlan(project, take).pieces.length);
    const view = new DataView(rex.buffer);
    const slices = [...rex.keys()].filter((i) => String.fromCharCode(...rex.slice(i, i + 4)) === 'SLCE').map((i) => view.getUint32(i + 12));
    expect(slices).toHaveLength(pieces);
    expect(slices.at(-2)).toBe(SAMPLE_RATE);
  });
});
