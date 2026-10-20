import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, createProject, setBpm, setMatrixConfig, setPadConfig, setSlicing, setSongLoop, updateHit, updateSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { heardOf, sameHeard } from './heard';
import { matrixSongLooped } from './preview';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** Two sliced files, each with its matrix and loop; the first file's loop in the song. */
function twoFiles() {
  let p = run(createProject(), setBpm(120), addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'think.wav', audio: constantAudio(2) }));
  const [a, b] = Object.values(p.samples);
  p = run(p, setSlicing(a!.id, 1, [0, 0.5]), setSlicing(b!.id, 1, [0, 0.5]));
  const [ma, mb] = Object.values(p.matrices);
  p = run(p, addClip('main', ma!.loop!, 0, 16));
  return { p, a: a!, ma: ma!, mb: mb! };
}

const heardSame = (a: Project, b: Project) => sameHeard(heardOf(a), heardOf(b));

describe('what of a project is heard', () => {
  const { p, a, ma, mb } = twoFiles();
  const hitOf = (padId: string) => p.pads[padId]!.members[0]!;

  it('is not changed by names, by the song loop region, or by a matrix the song does not play', () => {
    expect(heardSame(p, run(p, updateSample(a.id, { name: 'renamed' })))).toBe(true);
    expect(heardSame(p, run(p, updateHit(hitOf(ma.pads[0]!), { name: 'kick' })))).toBe(true);
    expect(heardSame(p, run(p, setSongLoop(0, 8)))).toBe(true);
    expect(heardSame(p, run(p, updateHit(hitOf(mb.pads[0]!), { pitch: 5 })))).toBe(true);
  });

  it('is changed by the tempo, a hit it plays, and the pad and matrix laid over that hit', () => {
    expect(heardSame(p, run(p, setBpm(130)))).toBe(false);
    expect(heardSame(p, run(p, updateHit(hitOf(ma.pads[0]!), { pitch: 5 })))).toBe(false);
    expect(heardSame(p, run(p, setPadConfig(ma.pads[1]!, { volume: -6 })))).toBe(false);
    expect(heardSame(p, run(p, setMatrixConfig(ma.id, { pan: 0.5 })))).toBe(false);
  });

  it('a matrix played on its own hears its own changes, not another matrix\'s', () => {
    const own = (q: Project) => heardOf(matrixSongLooped(q, mb.id));
    expect(sameHeard(own(p), own(run(p, updateHit(hitOf(mb.pads[1]!), { volume: -3 }))))).toBe(false);
    expect(sameHeard(own(p), own(run(p, updateHit(hitOf(ma.pads[1]!), { volume: -3 }))))).toBe(true);
  });

  it('compares audio as objects, not sample by sample', () => {
    const data = new Float32Array([1, 2]);
    expect(sameHeard({ a: data }, { a: data })).toBe(true);
    expect(sameHeard({ a: data }, { a: new Float32Array([1, 2]) })).toBe(false);
  });
});
