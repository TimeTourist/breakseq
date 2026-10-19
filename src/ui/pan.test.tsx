// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject } from '../model';
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


async function setup(project: Project, view: 'pads' | 'mods' | 'samples', selection: Partial<Selection>) {
  const start = initialState(project);
  const store = createStore({ ...start, view, focus: focusOn(project, selection), selection: { ...start.selection, ...selection } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('channel choice and pan in the GUI', () => {
  it('the Trim row in Samples chooses which channels a sample plays', async () => {
    const project = apply(createProject(), addSample({ name: 'wide.wav', audio: constantAudio(0.2, [0.5, -0.25]) }));
    const sample = Object.values(project.samples)[0]!;
    const store = await setup(project, 'samples', {});
    const channel = screen.getByRole('group', { name: 'Channel' });
    expect(within(channel).getByRole('button', { name: 'Stereo' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(channel).getByRole('button', { name: 'Left' }));
    expect(store.getState().history.present.samples[sample.id]!.channel).toBe('left');
  });

  it('Pads pans a hit', async () => {
    const project = apply(createProject(), addSample({ name: 'hat.wav', audio: constantAudio(0.1) }));
    const hit = Object.values(project.hits)[0]!;
    const store = await setup(project, 'pads', { hit: hit.id });
    const pan = screen.getByRole('slider', { name: /^Pan/ });
    expect(pan.closest('.slider')!.textContent).toContain('C');
    fireEvent.change(pan, { target: { value: '-40' } });
    expect(store.getState().history.present.hits[hit.id]!.pan).toBeCloseTo(-0.4);
    expect(pan.closest('.slider')!.textContent).toContain('L 40');
  });
});
