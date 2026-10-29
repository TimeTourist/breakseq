// Web Audio in Node, with views that keep their buffers alive.
import '../test/web-audio';
import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, setBpm, setSongCell, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { decodeAudioFile } from './codec';
import { fingerprint, songToAudio, songToMidi } from './render-song-to';

const SAMPLE_RATE = 48000;
const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** A 0.1 s and a 0.2 s one-shot on steps 1 and 9 of one bar at 60 BPM, both at 0.5. */
function twoSounds(): Project {
  let project = run(createProject(), setBpm(60), addSample({ name: 'a.wav', audio: constantAudio(0.1) }), addSample({ name: 'b.wav', audio: constantAudio(0.2) }), createLoop('L', 'main', 1));
  const [a, b] = Object.values(project.pads);
  const loop = Object.values(project.loops)[0]!;
  project = run(project, setStep(loop.id, 0, { padId: a!.id }), setStep(loop.id, 8, { padId: b!.id }), setSongCell('main', 0, loop.id));
  return project;
}

describe('songToMidi', () => {
  it('gives one stereo piece per sound, at the level Play has, a MIDI file and no reverb/delay when none is sent', async () => {
    const result = await songToMidi(twoSounds(), SAMPLE_RATE);
    expect(result.pieces).toHaveLength(2);
    expect(result.pieces.map((p) => p.length)).toEqual([2, 2]);
    expect(result.pieces[1]![0]!.length).toBe(Math.round(0.2 * SAMPLE_RATE));
    // Not normalized: the sample's own 0.5.
    expect(result.pieces[0]![0]![100]).toBeCloseTo(0.5, 3);
    expect(String.fromCharCode(...result.midi.slice(0, 4))).toBe('MThd');
    expect(result.space).toBeNull();
  });

  it('gives the same fingerprint for the same song, and another when a sound changes', async () => {
    const project = twoSounds();
    const first = await songToMidi(project, SAMPLE_RATE);
    const again = await songToMidi(project, SAMPLE_RATE);
    expect(again.fingerprint).toBe(first.fingerprint);
    const quieter = first.pieces.map((p, i) => (i === 0 ? p.map((c) => c.map((v) => v / 2)) : p));
    expect(fingerprint(quieter, SAMPLE_RATE)).not.toBe(first.fingerprint);
  });
});

describe('songToAudio', () => {
  it('is the song as heard, at the level Play has', async () => {
    const audio = decodeAudioFile(await songToAudio(twoSounds(), SAMPLE_RATE));
    expect(audio.sampleRate).toBe(SAMPLE_RATE);
    // One bar at 60 BPM is 4 s; the second sound starts at 2 s.
    expect(audio.channels[0]!.length).toBeGreaterThanOrEqual(4 * SAMPLE_RATE);
    expect(audio.channels[0]![Math.round(2.1 * SAMPLE_RATE)]).toBeCloseTo(0.5, 3);
  });
});
