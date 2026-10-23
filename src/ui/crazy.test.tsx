// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, goCrazy, newProject, setMode, setSlicing } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import { describeChange } from './describeChange';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState, reduce } from './store';

afterEach(cleanup);

const take = { buffer: { duration: 1, numberOfChannels: 1, sampleRate: 44100, getChannelData: () => new Float32Array(1) } as unknown as AudioBuffer, triggers: [], tapes: [] } satisfies Take;

function services(): Services {
  const player = {
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
  } satisfies Player;
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: () => Promise.resolve(take),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

const ctx = sequentialIds();
const apply = (project: Project, ...commands: Command[]) =>
  commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);

/** A project with one file, not sliced yet; and its sample's id. */
function withFile(project: Project) {
  const p = apply(project, addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  return { project: p, sampleId: Object.keys(p.samples)[0]! };
}

function mount(project: Project): Store {
  const store = createStore(initialState(project));
  render(<App store={store} services={services()} />);
  return store;
}

describe('slicing through the store', () => {
  it('builds the song in Crazy madness, in one undo step', () => {
    const { project, sampleId } = withFile(newProject(ctx));
    const sliced = reduce(initialState(project), { type: 'run', command: setSlicing(sampleId, 1) }).state;
    expect(sliced.history.present.song.clips.length).toBeGreaterThan(0);
    expect(reduce(sliced, { type: 'undo' }).state.history.present).toBe(project);
  });

  it('does only the automatic chain in Total control', () => {
    const { project, sampleId } = withFile(createProject());
    const sliced = reduce(initialState(project), { type: 'run', command: setSlicing(sampleId, 1) }).state;
    expect(sliced.history.present.song.clips).toEqual([]);
  });
});

describe('the mode button', () => {
  it('shows the mode and switches on a click; Undo switches back', () => {
    const store = mount(newProject(ctx));
    const button = screen.getByRole('button', { name: 'Crazy madness. Click for Total control' });
    expect(button.getAttribute('title')).toBe('Crazy madness. Click for Total control');
    act(() => fireEvent.click(button));
    expect(store.getState().history.present.mode).toBe('total');
    expect(screen.getByRole('button', { name: 'Total control. Click for Crazy madness' })).toBeTruthy();
    act(() => store.dispatch({ type: 'undo' }));
    expect(store.getState().history.present.mode).toBe('crazy');
  });

  it('comes first among the header’s buttons on the right, before the tempo, with Go crazy right after it', () => {
    mount(newProject(ctx));
    const transport = document.querySelector('.transport')!;
    const controls = [...transport.querySelectorAll('button, input')];
    expect(controls[0]!.getAttribute('aria-label')).toBe('Crazy madness. Click for Total control');
    expect(controls[1]!.textContent).toContain('Go crazy');
    expect(controls[2]!.getAttribute('aria-label')).toBe('Tempo in BPM');
  });

  it('an old project is in Total control', () => {
    mount(createProject());
    expect(screen.getByRole('button', { name: 'Total control. Click for Crazy madness' })).toBeTruthy();
  });
});

describe('Go crazy', () => {
  const tip =
    'Go crazy: throw away matrices, loops and the song and build it all again from a new recipe. Samples and your own mods stay. Undo brings it back.';

  it('builds again from a new recipe, in both modes, and Undo brings it all back', () => {
    const { project, sampleId } = withFile(newProject(ctx));
    const sliced = apply(project, setMode('total'), setSlicing(sampleId, 1));
    const store = mount(sliced);
    const button = screen.getByRole('button', { name: /Go crazy/ });
    expect(button.getAttribute('title')).toBe(tip);
    act(() => fireEvent.click(button));
    const now = store.getState().history.present;
    expect(now.recipeSeed).not.toBe(sliced.recipeSeed);
    expect(now.song.clips.length).toBeGreaterThan(0);
    act(() => store.dispatch({ type: 'undo' }));
    expect(store.getState().history.present).toBe(sliced);
  });
});

describe('Undo says what happened', () => {
  it('names the mode and Go crazy', () => {
    const project = newProject(ctx);
    expect(describeChange(project, apply(project, setMode('total')))).toBe('switch to Total control');
    expect(describeChange(apply(project, setMode('total')), project)).toBe('switch to Crazy madness');
    const { project: file, sampleId } = withFile(project);
    const sliced = apply(file, setSlicing(sampleId, 1));
    expect(describeChange(sliced, apply(sliced, goCrazy()))).toBe('go crazy');
  });
});
