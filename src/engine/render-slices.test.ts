// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, setBpm, setSongCell, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { decodeAudioFile, readCues } from './codec';
import { generateTake } from './generate';
import { renderTake } from './render';
import { SLOT_GAP, midiExport, rexExport } from './render-slices';

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
    const take = generateTake(project, () => 0);
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
    const take = generateTake(project, () => 0);
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

