// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioData, Command, Project } from '../model';
import { addSample, createLoop, createMod, createProject, setBreak, setSongCell, setStep } from '../model';
import { sequentialIds } from '../test/fixtures';
import { App } from './App';
import { CLIP_MIME } from './SongView';
import { clip, dropOn } from '../test/timeline';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function services(): Services {
  const player: Player = {
    play: vi.fn(),
    replace: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    currentPosition: () => null,
    audition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    stopAudition: vi.fn(),
    playHit: vi.fn(),
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

/** Two seconds with sharp hits at 0.25, 0.8 and 1.4 s. */
function hits(): AudioData {
  const sr = 44100;
  const x = new Float32Array(2 * sr);
  for (const at of [0.25, 0.8, 1.4]) {
    for (let i = 0; i < 0.1 * sr; i++) x[Math.round(at * sr) + i] = Math.sin(i * 1.3) * Math.exp(-i / 800) * 0.8;
  }
  return { sampleRate: sr, channels: [x] };
}

describe('Transients in Slice', () => {
  it('puts markers on the hits', async () => {
    const project = apply(createProject(), addSample({ name: 'break.wav', audio: hits() }));
    const store = await setup(apply(project, setBreak(Object.keys(project.breaks)[0]!, 1)), 'slice');

    fireEvent.click(button('Transients'));

    // Markers are parts of the 2 s break.
    const markers = Object.values(present(store).breaks)[0]!.markers;
    expect(markers.map((m) => Math.round(m * 200) / 100)).toEqual([0, 0.25, 0.8, 1.4]);
  });
});

describe('Dragging in Song', () => {
  function placed() {
    const project = apply(createProject(), createLoop(null, 'main', 1));
    const loop = Object.values(project.loops)[0]!;
    const withClip = apply(project, setSongCell('main', 1, loop.id));
    return { project: withClip, id: withClip.song.clips[0]!.id };
  }
  const starts = (store: Store) => present(store).song.clips.map((c) => [c.row, c.start]);

  it('dragging a clip moves it; one undo puts it back', async () => {
    const { project, id } = placed();
    const store = await setup(project, 'song');

    dropOn('Main', 64, CLIP_MIME, JSON.stringify({ id, grab: 0 }));

    expect(starts(store)).toEqual([['main', 64]]);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(starts(store)).toEqual([['main', 16]]);
  });

  it('with Alt it copies, and the grabbed step stays under the pointer', async () => {
    const { project, id } = placed();
    const store = await setup(project, 'song');

    dropOn('Main', 70, CLIP_MIME, JSON.stringify({ id, grab: 6 }), true);

    expect(starts(store)).toEqual([
      ['main', 16],
      ['main', 64],
    ]);
  });
});

describe('Double-click opens the editor', () => {
  it('a loop in Song opens Loops, a mod opens Mods, a step opens its pad in Hits', async () => {
    let project = apply(createProject(), addSample({ name: 'snare.wav', audio: hits() }), createLoop(null, 'main', 2));
    const pad = Object.values(project.pads)[0]!;
    const hit = Object.values(project.hits)[0]!;
    const loop = Object.values(project.loops)[0]!;
    project = apply(
      project,
      setStep(loop.id, 4, { padId: pad.id }),
      setSongCell('main', 0, loop.id),
      createMod('Roll', [{ target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [2] } }]),
    );
    const mod = Object.values(project.mods)[0]!;
    const store = await setup(apply(project, setSongCell('modA', 0, mod.id)), 'song');
    const state = () => store.getState();

    fireEvent.doubleClick(clip(/^M1, /));
    expect(state().view).toBe('loops');
    expect(state().selection.loop).toBe(loop.id);

    fireEvent.doubleClick(button(/^Bar 1, step 5:/));
    expect(state().view).toBe('hits');
    expect(state().selection.pad).toBe(pad.id);

    // In Hits, a hit of the pad opens it for editing.
    fireEvent.click(within(screen.getByRole('list', { name: 'Hits in this pad' })).getByRole('button', { name: 'snare' }));
    expect(state().selection.hit).toBe(hit.id);
    expect(screen.getByLabelText('Hit name')).toHaveProperty('value', hit.name);

    fireEvent.keyDown(window, { key: '6' });
    fireEvent.doubleClick(clip(/^Roll, /));
    expect(state().view).toBe('mods');
    expect(state().selection.mod).toBe(mod.id);
  });
});

describe('Double-clicking a mod in Song', () => {
  it('picks the loop playing in that bar for Try on: the fill there, else the main', async () => {
    let project = apply(createProject(), createLoop(null, 'main', 4), createLoop(null, 'fill', 1));
    const [main, fill] = Object.values(project.loops);
    project = apply(
      project,
      setSongCell('main', 0, main!.id),
      setSongCell('fill', 3, fill!.id),
      createMod('Roll', [{ target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [2] } }]),
    );
    const mod = Object.values(project.mods)[0]!;
    const store = await setup(apply(project, setSongCell('modA', 1, mod.id), setSongCell('modA', 3, mod.id)), 'song');

    fireEvent.doubleClick(clip(/^Roll, 2\.1\.1/));
    expect(store.getState().selection).toMatchObject({ mod: mod.id, previewLoop: main!.id });
    expect(store.getState().view).toBe('mods');

    fireEvent.keyDown(window, { key: '6' });
    fireEvent.doubleClick(clip(/^Roll, 4\.1\.1/));
    expect(store.getState().selection.previewLoop).toBe(fill!.id);
  });
});

describe('Dragging mods between rows', () => {
  it('a mod clip moves from Mod A to Mod B, but not into a loop row', async () => {
    let project = apply(createProject(), createMod('Roll', [{ target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [2] } }]));
    const mod = Object.values(project.mods)[0]!;
    project = apply(project, setSongCell('modA', 0, mod.id));
    const id = project.song.clips[0]!.id;
    const store = await setup(project, 'song');

    dropOn('Mod B', 32, CLIP_MIME, JSON.stringify({ id, grab: 0 }));
    expect(present(store).song.clips.map((c) => [c.row, c.start])).toEqual([['modB', 32]]);

    dropOn('Main', 0, CLIP_MIME, JSON.stringify({ id, grab: 0 }));
    expect(present(store).song.clips.map((c) => [c.row, c.start])).toEqual([['modB', 32]]);
    expect(screen.getByRole('alert').textContent).toBe('Mods go in Mod A or Mod B');
  });
});
