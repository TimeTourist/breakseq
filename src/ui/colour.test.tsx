// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createMod, createProject } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
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


async function setup(project: Project, view: 'hits' | 'mods', selection: Partial<Selection>) {
  const start = initialState(project);
  const store = createStore({ ...start, view, selection: { ...start.selection, ...selection } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('dist and filter in the GUI', () => {
  it('Hits sets a hit to Crush with an amount, and a low-pass with a cutoff', async () => {
    const project = apply(createProject(), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
    const hit = Object.values(project.hits)[0]!;
    const store = await setup(project, 'hits', { hit: hit.id });
    fireEvent.click(within(screen.getByRole('group', { name: 'Dist mode' })).getByRole('button', { name: 'Crush' }));
    expect(screen.getByRole('slider', { name: /^Amount/ })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter type' })).getByRole('button', { name: 'Low-pass' }));
    fireEvent.change(screen.getByRole('slider', { name: /^Cutoff/ }), { target: { value: String(Math.log10(500)) } });
    expect(store.getState().history.present.hits[hit.id]).toMatchObject({ dist: { mode: 'crush' }, filter: { type: 'lowpass', cutoff: 500 } });
  });

  it('a Dist mod chooses its mode, and a Filter mod its type', async () => {
    const project = apply(
      createProject(),
      createMod('m', [
        { target: 'dist', rate: 'step', shape: { kind: 'list', values: [0.5] } },
        { target: 'filter', rate: 'step', shape: { kind: 'list', values: [800] } },
      ]),
    );
    const mod = Object.values(project.mods)[0]!;
    const store = await setup(project, 'mods', { mod: mod.id });
    fireEvent.click(within(screen.getByRole('group', { name: 'Dist mode' })).getByRole('button', { name: 'Decimate' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Effects' })).getByRole('button', { name: 'Filter' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter type' })).getByRole('button', { name: 'High-pass' }));
    const effects = store.getState().history.present.mods[mod.id]!.effects;
    expect(effects.find((e) => e.target === 'dist')).toMatchObject({ dist: { mode: 'decimate' } });
    expect(effects.find((e) => e.target === 'filter')).toMatchObject({ filter: { type: 'highpass', resonance: 0.2 } });
  });
});
