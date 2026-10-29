// Web Audio in Node, with views that keep their buffers alive.
import '../../test/web-audio';
import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../../model';
import { addSample, createLoop, createProject, setBpm, setSongCell, setStep, updateHit } from '../../model';
import { constantAudio, sequentialIds } from '../../test/fixtures';
import type { ClipField, Frozen, Host } from '../services';
import { noteName, runSongToAudio, runSongToMidi } from './song-to';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

function twoSounds(): Project {
  let project = run(createProject(), setBpm(60), addSample({ name: 'a.wav', audio: constantAudio(0.1) }), addSample({ name: 'b.wav', audio: constantAudio(0.2) }), createLoop('L', 'main', 1));
  const [a, b] = Object.values(project.pads);
  const loop = Object.values(project.loops)[0]!;
  project = run(project, setStep(loop.id, 0, { padId: a!.id }), setStep(loop.id, 8, { padId: b!.id }), setSongCell('main', 0, loop.id));
  return project;
}

/** The plugin as far as the bar goes: what is frozen, the fields and the last status. */
function fakeHost() {
  const state = { frozen: null as Frozen | null, freezes: 0, fields: new Map<ClipField, string | null>(), status: '' };
  const host: Host = {
    onTempo: () => () => {},
    onSongTo: () => () => {},
    sampleRate: () => Promise.resolve(44100),
    frozen: () => Promise.resolve(state.frozen),
    freeze: (pieces, _rate, bpm, fingerprint) => {
      state.freezes++;
      state.frozen = { fingerprint, bpm, count: pieces.length };
      return Promise.resolve();
    },
    clip: (field, file) => {
      state.fields.set(field, file?.label ?? null);
      return Promise.resolve();
    },
    status: (text) => {
      state.status = text;
    },
  };
  return { host, state };
}

describe('Song to MIDI', () => {
  it('freezes the pieces the first time without asking, and fills the MIDI field', async () => {
    const { host, state } = fakeHost();
    let asked = 0;
    await runSongToMidi(twoSounds(), host, () => (asked++, Promise.resolve(true)));
    expect(asked).toBe(0);
    expect(state.freezes).toBe(1);
    expect(state.fields.get('midi')).toBe('MIDI · 8 bars · 2 sounds · C1–C#1');
    expect(state.fields.get('space')).toBeNull();
  });

  it('does not ask again for the same song', async () => {
    const { host, state } = fakeHost();
    const project = twoSounds();
    await runSongToMidi(project, host, () => Promise.resolve(true));
    let asked = 0;
    await runSongToMidi(project, host, () => (asked++, Promise.resolve(true)));
    expect(asked).toBe(0);
    expect(state.freezes).toBe(1);
  });

  it('asks when the sounds change; Cancel leaves the frozen pieces and the fields as they were', async () => {
    const { host, state } = fakeHost();
    const project = twoSounds();
    await runSongToMidi(project, host, () => Promise.resolve(true));
    const before = { ...state.frozen! };
    const label = state.fields.get('midi');
    const hit = Object.keys(project.hits)[0]!;
    const changed = run(project, updateHit(hit, { volume: -6 }));
    let asked = 0;
    await runSongToMidi(changed, host, () => (asked++, Promise.resolve(false)));
    expect(asked).toBe(1);
    expect(state.frozen).toEqual(before);
    expect(state.fields.get('midi')).toBe(label);
    await runSongToMidi(changed, host, () => Promise.resolve(true));
    expect(state.frozen!.fingerprint).not.toBe(before.fingerprint);
  });
});

describe('Song to Audio', () => {
  it('fills the Audio field and freezes nothing', async () => {
    const { host, state } = fakeHost();
    await runSongToAudio(twoSounds(), host);
    expect(state.fields.get('audio')).toBe('Audio · 8 bars');
    expect(state.freezes).toBe(0);
  });
});

describe('noteName', () => {
  it('names notes as Reason does: 36 is C1', () => {
    expect([36, 37, 48, 127].map(noteName)).toEqual(['C1', 'C#1', 'C2', 'G8']);
  });
});
