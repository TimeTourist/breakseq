// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createMod, createProject, ownMatrix, setSlicing, setSongCell, setStep, updateHit } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { focusOn } from '../test/focus';
import { App } from './App';
import type { Take } from './playback';
import type { Services } from './services';
import type { Selection } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

const services = (): Services => ({
  storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
  player: {
    play: vi.fn(),
    replace: vi.fn(),
    queue: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    currentPosition: () => null,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  },
  renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
  renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
  exportWav: vi.fn(),
  exportMidi: vi.fn(),
  exportRex: vi.fn(),
  download: vi.fn(),
  rng: () => () => 0,
});

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}


async function setup(project: Project, view: 'pads' | 'mods', selection: Partial<Selection>) {
  const start = initialState(project);
  const store = createStore({ ...start, view, focus: focusOn(project, selection), selection: { ...start.selection, ...selection } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('stretch in the GUI', () => {
  it('Pitch has Fit to tempo of its own: a matrix fits by pitch, and the semitones still add', async () => {
    const sampled = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const amen = Object.values(sampled.samples)[0]!;
    const project = apply(sampled, setSlicing(amen.id, 1));
    const matrix = ownMatrix(project, amen.id)!.id;
    const store = await setup(project, 'pads', { matrix });
    const pitch = screen.getByRole('slider', { name: /^Pitch/ }).closest('.slider') as HTMLElement;
    fireEvent.click(within(pitch).getByRole('button', { name: 'Fit to tempo' }));
    expect(store.getState().history.present.matrices[matrix]!.config.pitchFit).toBe(true);
    expect(within(pitch).getByRole('button', { name: 'Fit to tempo' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(pitch).getByText('0 st + fit')).toBeTruthy();
  });

  it('Pads sets a matrix to Fit to tempo, and Factor shows its slider; a one-shot fits too', async () => {
    const sampled = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
    const amen = Object.values(sampled.samples).find((s) => s.name === 'amen.wav')!;
    const project = apply(sampled, setSlicing(amen.id, 1));
    const matrix = ownMatrix(project, amen.id)!.id;
    const store = await setup(project, 'pads', { matrix });
    const modes = screen.getByRole('group', { name: 'Stretch mode' });
    // Grain only shows while it stretches.
    expect(screen.queryByRole('slider', { name: /^Grain/ })).toBeNull();
    fireEvent.click(within(modes).getByRole('button', { name: 'Fit to tempo' }));
    expect(store.getState().history.present.matrices[matrix]!.config.stretch.mode).toBe('fit');
    fireEvent.click(within(modes).getByRole('button', { name: 'Factor' }));
    expect(screen.getByRole('slider', { name: /^Factor/ })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /^Grain/ })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Grains from' })).getByRole('button', { name: 'Hit' }));
    expect(store.getState().history.present.matrices[matrix]!.config.stretch).toMatchObject({ mode: 'factor', from: 'hit' });

    const snare = Object.values(project.hits).find((h) => h.name.startsWith('snare'))!;
    cleanup();
    await setup(project, 'pads', { hit: snare.id });
    expect(within(screen.getByRole('group', { name: 'Stretch mode' })).getByRole('button', { name: 'Fit to tempo' }).hasAttribute('disabled')).toBe(false);
  });

  it('a Stretch mod chooses Multiply or Replace', async () => {
    const project = apply(createProject(), createMod('m', [{ target: 'stretch', step: 'beat', lane: [{ v: 2 }] }]));
    const mod = Object.values(project.mods)[0]!;
    const store = await setup(project, 'mods', { mod: mod.id });
    const group = screen.getByRole('group', { name: "With the hit's own stretch" });
    expect(within(group).getByRole('button', { name: 'Multiply' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Replace' }));
    const effect = store.getState().history.present.mods[mod.id]!.effects[0]!;
    expect(effect.target === 'stretch' && 'stretch' in effect ? effect.stretch : undefined).toEqual({ grain: 30, combine: 'replace' });
  });

  it('a hit’s Grain is greyed with why when a Stretch mod is over it wherever it plays in the song', async () => {
    let project = apply(createProject(), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }), createLoop('M1', 'main', 1));
    const hit = Object.values(project.hits)[0]!;
    const pad = Object.values(project.pads)[0]!;
    const loop = Object.values(project.loops)[0]!;
    project = apply(project, updateHit(hit.id, { stretch: { mode: 'factor', factor: 2, grain: 40, from: null } }), setStep(loop.id, 0, { padId: pad.id }), setSongCell('main', 0, loop.id));
    await setup(project, 'pads', { hit: hit.id });
    expect(screen.queryByText(/Under a Stretch mod wherever it plays/)).toBeNull();
    cleanup();
    const before = project;
    project = apply(project, createMod('smear', [{ target: 'stretch', step: 'bar', lane: [{ v: 2 }] }]));
    const mod = Object.keys(project.mods).find((k) => !(k in before.mods))!;
    project = apply(project, setSongCell('modA', 0, mod));
    await setup(project, 'pads', { hit: hit.id });
    const why = screen.getByText('Under a Stretch mod wherever it plays in the song: the mod’s grain is heard there');
    expect(why.closest('.unheard')!.querySelector('input[type="range"]')).not.toBeNull();
  });
});

