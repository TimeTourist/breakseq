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
import type { View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

function fakeServices(): Services {
  const player: Player = {
    play: vi.fn(),
    replace: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    playHit: vi.fn(),
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [] } satisfies Take),
    exportWav: vi.fn(),
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
  let project = run(createProject(ctx), addSample({ name: 'amen.wav', audio: constantAudio(0.5) }));
  const id = Object.keys(project.samples)[0]!;
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
  it('switches views with the keys 1–8', async () => {
    await setup();
    expect(heading()).toBe('Import');
    fireEvent.keyDown(window, { key: '8' });
    expect(heading()).toBe('Song');
    fireEvent.keyDown(window, { key: '2' });
    expect(heading()).toMatch(/^Slice/);
    fireEvent.keyDown(window, { key: '3' });
    expect(heading()).toBe('Tag');
  });

  it('ignores the number keys while typing in a field', async () => {
    await setup();
    fireEvent.keyDown(screen.getByLabelText('Tempo in BPM'), { key: '8' });
    expect(heading()).toBe('Import');
  });
});

describe('Song', () => {
  const bar = (n: number) => screen.getByRole('button', { name: new RegExp(`^Bar ${n}:`) });

  it('drops a loop on a Main cell, and Delete clears it', async () => {
    const store = await setup(withM1(), 'song');
    const m1 = Object.values(store.getState().history.present.loops)[0]!;

    fireEvent.drop(bar(2), { dataTransfer: { types: [LOOP_MIME], getData: (t: string) => (t === LOOP_MIME ? m1.id : '') } });

    expect(store.getState().history.present.song.rows.main[1]).toBe(m1.id);
    expect(bar(2)).toHaveProperty('textContent', 'M1bar 1');
    expect(bar(3).getAttribute('aria-label')).toBe('Bar 3: M1 bar 1');

    fireEvent.keyDown(bar(2), { key: 'Delete' });
    expect(store.getState().history.present.song.rows.main[1]).toBeNull();
    expect(bar(2).getAttribute('aria-label')).toBe('Bar 2: empty');
  });

  it('places a selected loop by clicking, and undo takes it back', async () => {
    const store = await setup(withM1(), 'song');
    fireEvent.click(screen.getByRole('button', { name: 'M1' }));
    fireEvent.click(bar(1));
    expect(bar(1).getAttribute('aria-label')).toBe('Bar 1: M1 bar 1');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(bar(1).getAttribute('aria-label')).toBe('Bar 1: empty');
    expect(store.getState().history.present.song.rows.main[0]).toBeNull();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(bar(1).getAttribute('aria-label')).toBe('Bar 1: M1 bar 1');
  });
});

describe('Slice', () => {
  /** A project with an unsliced one-bar break. */
  function withBreak(): Project {
    const ctx = sequentialIds();
    const added = addSample({ name: 'amen.wav', audio: constantAudio(0.5) })(createProject(ctx), ctx);
    if (!added.ok) throw new Error('addSample failed');
    const id = Object.keys(added.project.samples)[0]!;
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
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop break' }));
    expect(services.player.stopAudition).toHaveBeenCalled();

    // The player reports the end; the button goes back to Play.
    const onEnded = vi.mocked(services.player.audition).mock.calls[0]![3]!;
    act(() => onEnded());
    expect(screen.getByRole('button', { name: 'Play break' })).toBeTruthy();
  });
});
