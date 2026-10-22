import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, copyHits, createLoop, createMod, createProject, ownMatrix, setStep, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Trail } from './crumbs';
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
/** The row as one reads it: each step, a link's file before it, the current step in [brackets], ♪ Song last. */
const text = (t: Trail) =>
  [
    ...t.steps.map((st) => {
      if (st.kind === 'current') return `${st.current.context === undefined ? '' : `${st.current.context.label} · `}[${st.current.label}${st.current.detail === undefined ? '' : ` ${st.current.detail}`}]`;
      const c = st.crumb;
      return isMenu(c) ? `${c.label} ▾` : `${c.context === undefined ? '' : `${c.context.label} · `}${c.label}`;
    }),
    ...(t.song ? ['♪ Song →'] : []),
  ].join(' › ');
const links = (t: Trail) => t.steps.flatMap((st) => (st.kind === 'link' ? [st.crumb] : []));

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

describe('the row under the tabs: one chain, one step per tab (Magnus beslut)', () => {
  it('Samples: the file as text · [sample 1] › 1 matrix → › 1 loop →, the names on hover', () => {
    const p = chain();
    const t = trail(state(p, { view: 'samples', sliceTarget: named(p, 'amen.wav').id }));
    expect(text(t)).toBe('amen.wav · [sample 1] › 1 matrix → › 1 loop →');
    expect(links(t)[0]).toMatchObject({ title: 'Matrix amen 1 (4 pads), in Matrices', go: [{ type: 'focus', matrix: amenMatrix(p).id }, {}] });
  });

  it('Samples: several matrices playing the sample are a menu with their pads; ♪ Song when heard', () => {
    const base = chain();
    const amenHit = base.pads[amenMatrix(base).pads[1]!]!.members[0]!;
    const p = on(base, (q) => copyHits([amenHit], thinkMatrix(q).pads[0]!), (q) => addClip('main', amenMatrix(q).loop!, 0));
    const t = trail(state(p, { view: 'samples', sliceTarget: named(p, 'amen.wav').id }));
    expect(text(t)).toBe('amen.wav · [sample 1] › 2 matrices ▾ › 2 loops ▾ › ♪ Song →');
    const menu = links(t)[0]!;
    expect(isMenu(menu) && menu.items.map((i) => i.label)).toEqual(['amen 1 · 4 pads', 'think 1 · 4 pads']);
  });

  it('Matrices: the samples before the matrix, its loops after; a pad and a hit are the detail (Claudes val.)', () => {
    const p = chain();
    const m = amenMatrix(p);
    const pad = p.pads[m.pads[1]!]!;
    const hit = pad.members[0]!;
    expect(text(trail(state(p, { view: 'pads', focus: { matrix: m.id, loopUnpins: [] } })))).toBe('amen.wav · sample 1 › [amen 1] › 1 loop →');
    const padState = state(p, { view: 'pads', focus: { matrix: m.id, loopUnpins: [] }, selection: { ...initialState().selection, pad: pad.id } });
    expect(text(trail(padState))).toBe('amen.wav · sample 1 › [amen 1 pad 02] › 1 loop →');
    const hitState = state(p, { view: 'pads', focus: { matrix: m.id, loopUnpins: [] }, selection: { ...initialState().selection, pad: pad.id, hit } });
    expect(text(trail(hitState))).toBe('amen.wav · sample 1 › [amen 1 pad 02 · hit 1] › 1 loop →');
  });

  it('Matrices: hits from two samples make the samples a menu; a hit shows only its own', () => {
    const base = chain();
    const thinkHit = base.pads[thinkMatrix(base).pads[0]!]!.members[0]!;
    const p = on(base, (q) => copyHits([thinkHit], amenMatrix(q).pads[0]!));
    const focus = { matrix: amenMatrix(p).id, loopUnpins: [] };
    const t = trail(state(p, { view: 'pads', focus }));
    expect(text(t)).toBe('2 samples ▾ › [amen 1] › 1 loop →');
    const menu = links(t)[0]!;
    expect(isMenu(menu) && menu.items.map((i) => i.label)).toEqual(['amen.wav · sample 1', 'think.wav · sample 1']);
    const pad = p.pads[amenMatrix(p).pads[0]!]!;
    expect(text(trail(state(p, { view: 'pads', focus, selection: { ...initialState().selection, pad: pad.id, hit: pad.members[1]! } })))).toBe('think.wav · sample 1 › [amen 1 pad 01 · hit 2] › 1 loop →');
  });

  it('Matrices: nothing without a matrix in focus; Project: nothing', () => {
    const p = chain();
    expect(text(trail(state(p, { view: 'pads' })))).toBe('');
    expect(text(trail(state(p, { view: 'project' })))).toBe('');
  });

  it('Loops: back to the samples and matrices it plays, a menu where there are several', () => {
    const base = chain();
    const own = amenMatrix(base);
    expect(text(trail(state(base, { view: 'loops', selection: { ...initialState().selection, loop: own.loop } })))).toBe('amen.wav · sample 1 › 1 matrix → › [amen 1]');
    // The selected step, weaker, after the loop (Magnus beslut).
    const withStep = trail(state(base, { view: 'loops', selection: { ...initialState().selection, loop: own.loop, step: 4 } }));
    const now = withStep.steps.find((st) => st.kind === 'current');
    expect(now?.kind === 'current' && now.current.detail).toBe('T1 · step 05');
    const p = on(
      base,
      () => createLoop('Mixed', 'main', 1),
      (q) => setStep(Object.values(q.loops).find((l) => l.name === 'Mixed')!.id, 0, { padId: amenMatrix(q).pads[0]! }),
      (q) => setStep(Object.values(q.loops).find((l) => l.name === 'Mixed')!.id, 4, { padId: thinkMatrix(q).pads[0]! }),
    );
    const mixed = Object.values(p.loops).find((l) => l.name === 'Mixed')!;
    const t = trail(state(p, { view: 'loops', selection: { ...initialState().selection, loop: mixed.id } }));
    expect(text(t)).toBe('2 samples ▾ › 2 matrices ▾ › [Mixed]');
    const menu = links(t)[1]!;
    expect(isMenu(menu) && menu.items.map((i) => i.label)).toEqual(['amen 1 · 4 pads', 'think 1 · 4 pads']);
  });

  it('Mods: the mod alone, then ♪ Song; Song: a loop clip with its chain, a mod clip with just the mod (Magnus beslut)', () => {
    const base = chain();
    const loop = amenMatrix(base).loop!;
    const p = on(
      base,
      () => createMod('Wobble', []),
      (q) => addClip('modA', Object.values(q.mods)[0]!.id, 0),
      () => addClip('main', loop, 0),
    );
    expect(text(trail(state(p, { view: 'mods', selection: { ...initialState().selection, previewLoop: loop } })))).toBe('[Wobble] › ♪ Song →');
    const modClip = p.song.clips.find((c) => c.ref === Object.values(p.mods)[0]!.id)!;
    expect(text(trail(state(p, { view: 'song', selection: { ...initialState().selection, clip: modClip.id } })))).toBe('Wobble → › [Song]');
    const clip = p.song.clips.find((c) => c.ref === loop)!;
    expect(text(trail(state(p, { view: 'song', selection: { ...initialState().selection, clip: clip.id } })))).toBe('amen.wav · sample 1 › 1 matrix → › 1 loop → › [Song]');
    expect(text(trail(state(p, { view: 'song' })))).toBe('[Song]');
  });

  it('the file is never a link: only the sample is, and it goes to Samples with it selected', () => {
    const p = chain();
    const store = createStore(state(p, { view: 'pads', focus: { matrix: amenMatrix(p).id, loopUnpins: [] } }));
    const sample = links(trail(store.getState()))[0]!;
    if (isMenu(sample)) throw new Error('one sample is one place');
    expect(sample).toMatchObject({ label: 'sample 1', context: { label: 'amen.wav' } });
    sample.go.forEach((a) => store.dispatch(a));
    expect(store.getState()).toMatchObject({ view: 'samples', sliceTarget: named(p, 'amen.wav').id });
  });
});
