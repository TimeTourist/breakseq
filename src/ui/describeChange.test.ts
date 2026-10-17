import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, removeBreak, setBpm, setSongBars, updateHit } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { describeChange } from './describeChange';

const ctx = sequentialIds();
const apply = (project: Project, command: Command) => {
  const r = command(project, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.project;
};

describe('describeChange', () => {
  it('names what changed, in a few words', () => {
    const empty = createProject();
    const one = apply(empty, addSample({ name: 'amen.wav', audio: constantAudio(0.1) }));
    expect(describeChange(empty, one)).toBe('add sample amen');
    const hit = Object.values(one.hits)[0]!;
    expect(describeChange(one, apply(one, updateHit(hit.id, { pitch: 2 })))).toBe('change hit amen');
    expect(describeChange(one, apply(one, setBpm(140)))).toBe('change the tempo');
    expect(describeChange(one, apply(one, setSongBars(4)))).toBe('change the song');
  });
});

describe('describeChange for a removed break', () => {
  it('names the break, not its sample', () => {
    const one = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(0.5) }));
    const id = Object.keys(one.breaks)[0]!;
    expect(describeChange(one, apply(one, removeBreak(id)))).toBe('remove break amen');
  });
});
