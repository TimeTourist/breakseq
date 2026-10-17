// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBreak, sliceBreak } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import { LOOP_MIME } from './SongView';
import { clickLane, clip, dropOn } from '../test/timeline';
import type { View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

function fakeServices(): Services {
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
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

/** A project with a sliced one-bar break, so M1 exists. */
function withM1(): Project {
  const ctx = sequentialIds();
  const run = (project: Project, command: Command) => {
    const result = command(project, ctx);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.project;
  };
  let project = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(0.5) }));
  const id = Object.keys(project.breaks)[0]!;
  project = run(project, setBreak(id, 1));
  return run(project, sliceBreak(id, 1, 4));
}

async function setup(project: Project = createProject(), view: View = 'import') {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={fakeServices()} />);
  // Let the initial (empty) load settle.
  await act(async () => {});
  return store;
}

const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('App', () => {
  it('switches views with the keys 1–6', async () => {
    await setup();
    expect(heading()).toBe('Import');
    fireEvent.keyDown(window, { key: '6' });
    expect(heading()).toBe('Song');
    fireEvent.keyDown(window, { key: '2' });
    expect(heading()).toMatch(/^Slice/);
    fireEvent.keyDown(window, { key: '3' });
    expect(heading()).toBe('Hits');
  });

  it('ignores the number keys while typing in a field', async () => {
    await setup();
    fireEvent.keyDown(screen.getByLabelText('Tempo in BPM'), { key: '6' });
    expect(heading()).toBe('Import');
  });
});

describe('Song', () => {
  const clips = (store: ReturnType<typeof createStore>) =>
    store.getState().history.present.song.clips.map((c) => [c.row, c.start, c.length]);

  it("dropping a loop on a lane makes a clip of the loop's length there; Delete removes it", async () => {
    const store = await setup(withM1(), 'song');
    const m1 = Object.values(store.getState().history.present.loops)[0]!;

    dropOn('Main', 16, LOOP_MIME, m1.id);

    expect(clips(store)).toEqual([['main', 16, 16]]);
    fireEvent.keyDown(clip(/^amen 1, 2\.1\.1, 1 bar/), { key: 'Delete' });
    expect(clips(store)).toEqual([]);
  });

  it('places a selected loop by clicking the lane, and undo takes it back', async () => {
    const store = await setup(withM1(), 'song');
    fireEvent.click(screen.getByRole('button', { name: 'amen 1' }));
    clickLane('Main', 0);
    expect(clips(store)).toEqual([['main', 0, 16]]);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(clips(store)).toEqual([]);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(clips(store)).toEqual([['main', 0, 16]]);
  });

  it('←/→ move a selected clip a step, Shift a beat', async () => {
    const store = await setup(withM1(), 'song');
    dropOn('Main', 8, LOOP_MIME, Object.keys(store.getState().history.present.loops)[0]!);
    const m1 = clip(/^amen 1, /);
    fireEvent.keyDown(m1, { key: 'ArrowRight' });
    fireEvent.keyDown(clip(/^amen 1, /), { key: 'ArrowLeft', shiftKey: true });
    expect(clips(store)).toEqual([['main', 5, 16]]);
  });
});

describe('Slice', () => {
  /** A project with an unsliced one-bar break. */
  function withBreak(): Project {
    const ctx = sequentialIds();
    const added = addSample({ name: 'amen.wav', audio: constantAudio(0.5) })(createProject(), ctx);
    if (!added.ok) throw new Error('addSample failed');
    const id = Object.keys(added.project.breaks)[0]!;
    const asBreak = setBreak(id, 1)(added.project, ctx);
    if (!asBreak.ok) throw new Error('setBreak failed');
    return asBreak.project;
  }

  it('plays the whole break, and the button stops it while it plays', async () => {
    const services = fakeServices();
    const project = withBreak();
    render(<App store={createStore({ ...initialState(project), view: 'slice' })} services={services} />);
    await act(async () => {});
    const sample = Object.values(project.samples)[0]!;

    fireEvent.click(screen.getByRole('button', { name: 'Play break' }));

    expect(services.player.audition).toHaveBeenCalledWith(
      project.audio[sample.audioId],
      sample.offset,
      sample.duration,
      expect.any(Function),
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop break' }));
    expect(services.player.stopAudition).toHaveBeenCalled();

    // The player reports the end; the button goes back to Play.
    const onEnded = vi.mocked(services.player.audition).mock.calls[0]![3]!;
    act(() => onEnded());
    expect(screen.getByRole('button', { name: 'Play break' })).toBeTruthy();
  });
});

describe('Undo and redo buttons', () => {
  it('say what they undo, are off when there is nothing to undo, and work', async () => {
    const store = await setup(createProject(), 'song');
    const undo = () => screen.getByRole('button', { name: /^(Undo|Nothing to undo)/ });
    expect(undo()).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Tempo in BPM'), { target: { value: '150' } });
    fireEvent.blur(screen.getByLabelText('Tempo in BPM'));
    expect(undo().getAttribute('aria-label')).toBe('Undo: change the tempo (Ctrl+Z)');

    fireEvent.click(undo());
    expect(store.getState().history.present.song.bpm).toBe(170);
    fireEvent.click(screen.getByRole('button', { name: /^Redo:/ }));
    expect(store.getState().history.present.song.bpm).toBe(150);
  });
});
