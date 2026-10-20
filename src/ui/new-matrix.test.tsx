// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, renameMatrix } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Take } from './playback';
import type { Services } from './services';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const services = () => {
  const playHit = vi.fn();
  const s: Services = {
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
      playHit,
    },
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
  return { s, playHit };
};

/** Two one-shots, kick and snare. */
const shots = () => apply(createProject(), addSample({ name: 'kick.wav', audio: constantAudio(0.1) }), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));

async function open() {
  const project = shots();
  const { s, playHit } = services();
  const store = createStore({ ...initialState(project), view: 'loops' });
  render(<App store={store} services={s} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '+ New matrix' }));
  return { store, playHit, project, player: s.player };
}

const dialog = () => within(screen.getByRole('alertdialog'));

describe('+ New matrix', () => {
  it('new matrix from ticked one-shots', async () => {
    const { store, project } = await open();
    const name = dialog().getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Matrix 1');
    fireEvent.change(name, { target: { value: 'Drums' } });
    fireEvent.click(dialog().getByRole('checkbox', { name: /kick/ }));
    fireEvent.click(dialog().getByRole('checkbox', { name: /snare/ }));
    fireEvent.click(dialog().getByRole('button', { name: 'Create' }));
    const now = store.getState().history.present;
    const made = Object.values(now.matrices).find((m) => m.name === 'Drums')!;
    expect(made.pads).toHaveLength(1);
    const pad = now.pads[made.pads[0]!]!;
    expect(pad.members).toHaveLength(2);
    expect(pad.choice).toBe('roundRobin');
    // Copies: the originals stay, the pad holds new hits.
    expect(Object.keys(now.hits).length).toBe(Object.keys(project.hits).length + 2);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a click plays a one-shot in the list', async () => {
    const { playHit, project } = await open();
    fireEvent.click(dialog().getByRole('button', { name: /^Play kick/ }));
    const kick = Object.values(project.hits).find((h) => h.name.startsWith('kick'))!;
    expect(playHit).toHaveBeenCalledWith(expect.anything(), kick.id);
  });

  it('the new matrix gets focus', async () => {
    const { store } = await open();
    fireEvent.click(dialog().getByRole('checkbox', { name: /kick/ }));
    fireEvent.click(dialog().getByRole('button', { name: 'Create' }));
    const made = Object.values(store.getState().history.present.matrices).find((m) => m.name === 'Matrix 1')!;
    expect(store.getState().focus.matrix).toBe(made.id);
  });

  it('no ticks makes an empty matrix', async () => {
    const { store, project } = await open();
    fireEvent.click(dialog().getByRole('button', { name: 'Create' }));
    const now = store.getState().history.present;
    const made = Object.values(now.matrices).find((m) => m.name === 'Matrix 1')!;
    expect(made.pads).toHaveLength(1);
    expect(now.pads[made.pads[0]!]!.members).toEqual([]);
    expect(Object.keys(now.hits)).toEqual(Object.keys(project.hits));
  });

  it('Escape cancels and makes nothing', async () => {
    const { store, project } = await open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(Object.keys(store.getState().history.present.matrices)).toEqual(Object.keys(project.matrices));
  });

  it('an empty name is refused and keeps the dialog', async () => {
    await open();
    fireEvent.change(dialog().getByRole('textbox', { name: 'Name' }), { target: { value: ' ' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Create' }));
    expect(dialog().getByRole('alert').textContent).toMatch(/needs a name/);
  });

  it("the app's keys stay out of the open dialog: Space ticks, digits and Ctrl+Z do nothing there", async () => {
    const { store, player } = await open();
    const matrix = Object.values(store.getState().history.present.matrices)[0]!;
    store.dispatch({ type: 'run', command: renameMatrix(matrix.id, 'renamed') });
    const checkbox = dialog().getByRole('checkbox', { name: /kick/ });
    checkbox.focus();
    // Not prevented: the browser ticks the box (checked in Chromium).
    expect(fireEvent.keyDown(checkbox, { key: ' ' })).toBe(true);
    expect(player.play).not.toHaveBeenCalled();
    fireEvent.keyDown(checkbox, { key: '2' });
    expect(store.getState().view).toBe('loops');
    fireEvent.keyDown(checkbox, { key: 'z', ctrlKey: true });
    expect(store.getState().history.present.matrices[matrix.id]!.name).toBe('renamed');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    // Escape stays the dialog's.
    fireEvent.keyDown(checkbox, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
