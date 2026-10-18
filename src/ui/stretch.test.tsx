// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createMod, createProject, ownMatrix, setSlicing } from '../model';
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
  it('Pads sets a matrix to Fit to tempo, and Factor shows its slider; a hit of a sample that is not sliced cannot fit', async () => {
    const sampled = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
    const amen = Object.values(sampled.samples).find((s) => s.name === 'amen.wav')!;
    const project = apply(sampled, setSlicing(amen.id, 1));
    const matrix = ownMatrix(project, amen.id)!.id;
    const store = await setup(project, 'pads', { matrix });
    const modes = screen.getByRole('group', { name: 'Stretch mode' });
    fireEvent.click(within(modes).getByRole('button', { name: 'Fit to tempo' }));
    expect(store.getState().history.present.matrices[matrix]!.config.stretch.mode).toBe('fit');
    fireEvent.click(within(modes).getByRole('button', { name: 'Factor' }));
    expect(screen.getByRole('slider', { name: /^Factor/ })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Grains from' })).getByRole('button', { name: 'Hit' }));
    expect(store.getState().history.present.matrices[matrix]!.config.stretch).toMatchObject({ mode: 'factor', from: 'hit' });

    const snare = Object.values(project.hits).find((h) => h.name.startsWith('snare'))!;
    cleanup();
    await setup(project, 'pads', { hit: snare.id });
    expect(within(screen.getByRole('group', { name: 'Stretch mode' })).getByRole('button', { name: 'Fit to tempo' }).hasAttribute('disabled')).toBe(true);
  });

  it('a Stretch mod chooses Multiply or Replace', async () => {
    const project = apply(createProject(), createMod('m', [{ target: 'stretch', rate: 'beat', shape: { kind: 'list', values: [2] } }]));
    const mod = Object.values(project.mods)[0]!;
    const store = await setup(project, 'mods', { mod: mod.id });
    const group = screen.getByRole('group', { name: "With the hit's own stretch" });
    expect(within(group).getByRole('button', { name: 'Multiply' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Replace' }));
    const effect = store.getState().history.present.mods[mod.id]!.effects[0]!;
    expect(effect.target === 'stretch' && 'stretch' in effect ? effect.stretch : undefined).toEqual({ grain: 30, combine: 'replace' });
  });
});
