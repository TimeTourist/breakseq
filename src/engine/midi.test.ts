import { describe, expect, it } from 'vitest';
import type { Command, Project, StepEffect } from '../model';
import { addSample, createLoop, createMod, createProject, setBpm, setBreak, setSongCell, setStep, stepDuration } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import type { Trigger } from './generate';
import { FIRST_NOTE, MAX_PIECES, MIDI_PPQ, MidiExportError, encodeMidi, midiPlan, slotCount } from './midi';
import type { Tape } from './tape';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** A one-bar break of 2 s in 16 slices (120 BPM), M1 in a one-bar song at 120 BPM, and a 0.05 s snare. */
function song() {
  const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.05) }));
  const amen = Object.values(start.breaks).find((b) => b.name === 'amen 1')!;
  const project = run(start, setBreak(amen.id, 1), setBpm(120));
  const m1 = Object.values(project.loops)[0]!;
  const snarePad = Object.values(project.pads).find((p) => p.name.startsWith('snare'))!;
  return { project: run(project, setSongCell('main', 0, m1.id)), m1, snarePad };
}
const take = (project: Project) => generateTake(project, () => 0);
const nameOf = (project: Project, t: Trigger) => project.hits[t.hitId]!.name;

describe('MIDI plan', () => {
  it('a sliced break gives one piece per slice in slot order, and a note per hit from C1 up', () => {
    const { project } = song();
    const plan = midiPlan(project, take(project));
    expect(plan.pieces.map((p) => (p.kind === 'hit' ? nameOf(project, p.trigger) : 'tape'))).toEqual(
      Array.from({ length: 16 }, (_, i) => `amen 1 ${String(i + 1).padStart(2, '0')}`),
    );
    expect(plan.notes.map((n) => n.piece)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(plan.notes[3]!.time).toBeCloseTo(3 * stepDuration(120));
  });

  it('the same sound twice is one piece; a mod that changes it makes a variant, after the plain slices', () => {
    const { project, m1 } = song();
    // Step 3 plays slice 1 again; a pitch mod on beat 2 changes steps 5–8.
    const pitch: StepEffect = { target: 'pitch', rate: 'beat', shape: { kind: 'list', values: [0, 5] } };
    let p = run(project, setStep(m1.id, 2, { padId: project.breaks[Object.keys(project.breaks)[0]!]!.pads[0]! }));
    const withMod = run(p, createMod('up', [pitch]));
    const mod = Object.keys(withMod.mods)[0]!;
    p = run(withMod, setSongCell('modA', 0, mod));
    const plan = midiPlan(p, take(p));
    const names = plan.pieces.map((x) => (x.kind === 'hit' ? `${nameOf(p, x.trigger)}${x.trigger.pitch === 0 ? '' : ` +${x.trigger.pitch}`}` : 'tape'));
    // Slice 03 is not heard (slice 01 is on its step); beats 2 and 4 (0 5 0 5) are only heard pitched up.
    expect(names).toEqual([
      'amen 1 01', 'amen 1 02', 'amen 1 04', 'amen 1 09', 'amen 1 10', 'amen 1 11', 'amen 1 12',
      'amen 1 05 +5', 'amen 1 06 +5', 'amen 1 07 +5', 'amen 1 08 +5', 'amen 1 13 +5', 'amen 1 14 +5', 'amen 1 15 +5', 'amen 1 16 +5',
    ]);
    expect(plan.notes[2]!.piece).toBe(0);
  });

  it('one-shots come after the breaks, and a note lasts until the sound ends or the next one cuts it', () => {
    const { project, snarePad } = song();
    const next = run(project, createLoop('S', 'main', 1));
    const loop = Object.keys(next.loops).find((k) => !(k in project.loops))!;
    // Snare on steps 1 and 2: the first rings 0.05 s, shorter than a step; the break plays after.
    const p = run(next, setStep(loop, 0, { padId: snarePad.id }), setStep(loop, 1, { padId: Object.values(next.pads).find((x) => x.name === 'amen 1 05')!.id }), setSongCell('main', 0, loop));
    const plan = midiPlan(p, take(p));
    expect(plan.pieces.map((x) => (x.kind === 'hit' ? nameOf(p, x.trigger) : 'tape'))).toEqual(['amen 1 05', 'snare 1']);
    expect(plan.notes[0]).toMatchObject({ piece: 1, time: 0 });
    expect(plan.notes[0]!.length).toBeCloseTo(0.05);
    // amen 1 05 is 0.125 s long and nothing cuts it.
    expect(plan.notes[1]!.length).toBeCloseTo(0.125);
  });

  it('a tape segment is a piece of its own, after the hits', () => {
    const { project } = song();
    const t = take(project);
    const tape = { time: 1.5, end: 2, start: 1.5, source: [], length: 0.5 } as unknown as Tape;
    const plan = midiPlan(project, { triggers: t.triggers.filter((x) => x.time < 1.5), tapes: [tape] });
    expect(plan.pieces.at(-1)).toMatchObject({ kind: 'tape', seconds: 0.5 });
    expect(plan.notes.at(-1)).toMatchObject({ time: 1.5, length: 0.5, piece: plan.pieces.length - 1 });
    // The hit before the tape is cut where it starts.
    expect(plan.notes.at(-2)!.time + plan.notes.at(-2)!.length).toBeCloseTo(1.5);
  });

  it(`more than ${MAX_PIECES} sounds do not fit`, () => {
    const { project } = song();
    const one = take(project).triggers[0]!;
    const many = Array.from({ length: MAX_PIECES + 1 }, (_, i) => ({ ...one, time: i * 0.01, pitch: i }));
    expect(() => midiPlan(project, { triggers: many, tapes: [] })).toThrow(MidiExportError);
  });

  it('slots round up to a grid a sampler can split evenly', () => {
    expect([1, 3, 4, 5, 16, 17, 33, 64, 65, 92].map(slotCount)).toEqual([4, 4, 4, 8, 16, 32, 64, 64, 65, 92]);
  });
});

describe('MIDI file', () => {
  /** Note events read back: [tick, status, key]. */
  function events(bytes: Uint8Array): [number, number, number][] {
    let at = 22;
    const end = at + new DataView(bytes.buffer).getUint32(18);
    let tick = 0;
    const out: [number, number, number][] = [];
    while (at < end) {
      let delta = 0;
      let b: number;
      do {
        b = bytes[at++]!;
        delta = (delta << 7) | (b & 0x7f);
      } while (b & 0x80);
      tick += delta;
      const status = bytes[at]!;
      if (status === 0xff) {
        at += 3 + bytes[at + 2]!;
        continue;
      }
      out.push([tick, status, bytes[at + 1]!]);
      at += 3;
    }
    return out;
  }

  it('is format 0 with the tempo, notes from C1, and a note off before a note on at the same tick', () => {
    const bytes = encodeMidi(120, [
      { time: 0, length: 0.5, piece: 0 },
      { time: 0.5, length: 0.25, piece: 2 },
    ]);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    expect(new DataView(bytes.buffer).getUint16(8)).toBe(0);
    expect(new DataView(bytes.buffer).getUint16(12)).toBe(MIDI_PPQ);
    // 120 BPM: 500 000 µs per quarter.
    const tempoAt = [...bytes].findIndex((b, i) => b === 0xff && bytes[i + 1] === 0x51);
    expect([...bytes.slice(tempoAt + 3, tempoAt + 6)]).toEqual([0x07, 0xa1, 0x20]);
    // Half a second at 120 BPM is one beat.
    expect(events(bytes)).toEqual([
      [0, 0x90, FIRST_NOTE],
      [MIDI_PPQ, 0x80, FIRST_NOTE],
      [MIDI_PPQ, 0x90, FIRST_NOTE + 2],
      [MIDI_PPQ * 1.5, 0x80, FIRST_NOTE + 2],
    ]);
  });
});
