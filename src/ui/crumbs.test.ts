import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, copyHits, createLoop, createMod, createProject, ownMatrix, setStep, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Crumb, Trail } from './crumbs';
import { isMenu, trail } from './crumbs';
import type { AppState } from './store';
import { createStore, initialState } from './store';

const ctx = sequentialIds();
/** The commands run in turn on `from`. */
function on(from: Project, ...commands: ((p: Project) => Command)[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p)(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, from);
}

const named = (p: Project, name: string) => Object.values(p.samples).find((s) => s.name === name)!;
const labels = (crumbs: readonly Crumb[]) => crumbs.map((c) => c.label);
/** The row as one reads it: back › current → forward, ♪ Song last. */
const text = (t: Trail) =>
  [...labels(t.back), t.current?.label ?? '', ...(t.forward.length > 0 || t.song ? ['→', ...labels(t.forward)] : []), ...(t.song ? ['♪ Song →'] : [])].join(' | ');

/** amen.wav sliced in 4, think.wav sliced in 4, and a loop M1 with amen's pad 2 and think's pad 1, in the song. */
function chain(): Project {
  return on(
    createProject(),
    () => addSample({ name: 'amen.wav', audio: constantAudio(2) }),
    (p) => sliceSample(named(p, 'amen.wav').id, 1, 4),
    () => addSample({ name: 'think.wav', audio: constantAudio(2) }),
    (p) => sliceSample(named(p, 'think.wav').id, 1, 4),
  );
}
const amenMatrix = (p: Project) => ownMatrix(p, named(p, 'amen.wav').id)!;
const thinkMatrix = (p: Project) => ownMatrix(p, named(p, 'think.wav').id)!;
const state = (project: Project, patch: Partial<AppState>): AppState => ({ ...initialState(project), ...patch });

describe('the row under the tabs (Magnus beslut)', () => {
  it('Samples: the selected trim, back to its file, on to its matrix, its loop and ♪ Song', () => {
    const p = chain();
    expect(text(trail(state(p, { view: 'samples', sliceTarget: named(p, 'amen.wav').id })))).toBe('amen.wav | trim 1 | → | amen 1 | 1 loop');
  });

  it('Samples: ♪ Song when its loop is in the song, and the file jumps to the file’s first trim', () => {
    const base = chain();
    const loop = amenMatrix(base).loop!;
    const p = on(base, () => addClip('main', loop, 0));
    const t = trail(state(p, { view: 'samples', sliceTarget: named(p, 'amen.wav').id }));
    expect(t.song).toBe(true);
    expect(t.back[0]).toMatchObject({ go: [{ type: 'sliceTarget', sampleId: named(p, 'amen.wav').id }, { type: 'view', view: 'samples' }] });
  });

  it('Pads: the matrix, a pad and a hit, each further down the path', () => {
    const p = chain();
    const m = amenMatrix(p);
    const pad = p.pads[m.pads[1]!]!;
    const hit = pad.members[0]!;
    expect(text(trail(state(p, { view: 'pads', focus: { matrix: m.id, takeFrom: [] } })))).toBe('amen.wav | trim 1 | amen 1 | → | 1 loop');
    const padState = state(p, { view: 'pads', focus: { matrix: m.id, takeFrom: [] }, selection: { ...initialState().selection, pad: pad.id } });
    expect(text(trail(padState))).toBe('amen.wav | trim 1 | amen 1 | 02 | → | 1 loop');
    const hitState = state(p, { view: 'pads', focus: { matrix: m.id, takeFrom: [] }, selection: { ...initialState().selection, pad: pad.id, hit } });
    expect(text(trail(hitState))).toBe('amen.wav | trim 1 | amen 1 | 02 | hit 1 | → | 1 loop');
    // The pad jumps to itself in Pads, with its matrix in focus.
    expect(trail(hitState).back[3]).toMatchObject({ go: [{ type: 'focus', matrix: m.id }, { type: 'select', selection: { pad: pad.id, hit: null }, view: 'pads' }] });
  });

  it('Pads: a hit that plays another trim links to that trim too', () => {
    const base = chain();
    const thinkHit = base.pads[thinkMatrix(base).pads[0]!]!.members[0]!;
    const p = on(base, (q) => copyHits([thinkHit], amenMatrix(q).pads[0]!));
    const pad = p.pads[amenMatrix(p).pads[0]!]!;
    const t = trail(state(p, { view: 'pads', focus: { matrix: amenMatrix(p).id, takeFrom: [] }, selection: { ...initialState().selection, pad: pad.id, hit: pad.members[1]! } }));
    expect(labels(t.forward)[0]).toBe('plays think trim 1');
  });

  it('Pads: nothing without a matrix in focus; Project: nothing', () => {
    const p = chain();
    expect(text(trail(state(p, { view: 'pads' })))).toBe('');
    expect(text(trail(state(p, { view: 'project' })))).toBe('');
  });

  it('Loops: back to its one matrix with its trim, or a menu of its matrices', () => {
    const base = chain();
    const own = amenMatrix(base);
    expect(text(trail(state(base, { view: 'loops', selection: { ...initialState().selection, loop: own.loop } })))).toBe('amen.wav | trim 1 | amen 1 | amen 1');
    const p = on(
      base,
      () => createLoop('Mixed', 'main', 1),
      (q) => setStep(Object.values(q.loops).find((l) => l.name === 'Mixed')!.id, 0, { padId: amenMatrix(q).pads[0]! }),
      (q) => setStep(Object.values(q.loops).find((l) => l.name === 'Mixed')!.id, 4, { padId: thinkMatrix(q).pads[0]! }),
    );
    const mixed = Object.values(p.loops).find((l) => l.name === 'Mixed')!;
    const t = trail(state(p, { view: 'loops', selection: { ...initialState().selection, loop: mixed.id } }));
    expect(text(t)).toBe('2 matrices | Mixed');
    const menu = t.back[0]!;
    expect(isMenu(menu) && menu.items.map((i) => i.label)).toEqual(['amen 1', 'think 1']);
  });

  it('Mods: the mod and ♪ Song; Song: the selected clip’s loop', () => {
    const base = chain();
    const loop = amenMatrix(base).loop!;
    const p = on(
      base,
      () => createMod('Wobble', []),
      (q) => addClip('modA', Object.values(q.mods)[0]!.id, 0),
      () => addClip('main', loop, 0),
    );
    expect(text(trail(state(p, { view: 'mods' })))).toBe('Wobble | → | ♪ Song →');
    const clip = p.song.clips.find((c) => c.ref === loop)!;
    expect(text(trail(state(p, { view: 'song', selection: { ...initialState().selection, clip: clip.id } })))).toBe('amen.wav | trim 1 | amen 1 | amen 1 | Song');
    expect(text(trail(state(p, { view: 'song' })))).toBe('Song');
  });

  it('every jump is a valid move of the store', () => {
    const p = chain();
    const store = createStore(state(p, { view: 'pads', focus: { matrix: amenMatrix(p).id, takeFrom: [] } }));
    const t = trail(store.getState());
    const file = t.back[0]!;
    if (isMenu(file)) throw new Error('a file is one place');
    file.go.forEach((a) => store.dispatch(a));
    expect(store.getState()).toMatchObject({ view: 'samples', sliceTarget: named(p, 'amen.wav').id });
  });
});
