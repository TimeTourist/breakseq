// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Mod, Project } from '../model';
import { MOD_PRESETS, START_FROM_PRESETS, addClip, addSample, createMod, newProject, setSlicing } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

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

/** A new project (with the presets), a sliced sample, a mod of one's own Mine, and Gate in Mod A. */
function project(): Project {
  let p = apply(newProject(ctx), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  p = apply(p, setSlicing(Object.keys(p.samples)[0]!, 1), createMod('Mine', [{ target: 'pan', step: '1/16', lane: [{ v: 0 }] }]));
  return apply(p, addClip('modA', preset(p, 'Gate').id, 0, 16));
}

const preset = (p: Project, name: string): Mod => Object.values(p.mods).find((m) => m.isPreset === true && m.name === name)!;
const present = (store: Store) => store.getState().history.present;
const own = (store: Store) => Object.values(present(store).mods).filter((m) => m.isPreset !== true);

async function setup(p: Project, view: 'mods' | 'song') {
  const store: Store = createStore({ ...initialState(p), view });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const sidebar = () => within(screen.getByRole('complementary', { name: 'Mods' }));
const presetsGroup = () => within(sidebar().getByRole('group', { name: 'Presets' }));
const title = () => screen.getByRole('heading', { level: 1 }).textContent;
const openPreset = (name: string) => fireEvent.click(presetsGroup().getByRole('button', { name: new RegExp(`^${name} `) }));

describe('the presets in Mods (Mod-förval)', () => {
  it('are listed last, in their own group Presets, each with the preset mark', async () => {
    await setup(project(), 'mods');
    const rows = presetsGroup().getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.mod-name')?.textContent)).toEqual(MOD_PRESETS.map((p) => p.name));
    for (const row of rows) expect(within(row).getByLabelText('preset')).toBeTruthy();
    // Mine, one's own, comes before the group, without the mark.
    const mine = sidebar().getByRole('button', { name: /^Mine / });
    expect(within(mine).queryByLabelText('preset')).toBeNull();
    expect(mine.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('with no mod of one’s own, Mods opens the first preset', async () => {
    await setup(newProject(ctx), 'mods');
    expect(title()).toBe('Tape rock');
  });

  it('a preset has Clone and 🎲, but no Rename or Delete', async () => {
    await setup(project(), 'mods');
    openPreset('Gate');
    expect(title()).toBe('Gate');
    expect(screen.queryByRole('button', { name: 'Rename Gate' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reroll this mod' })).toBeTruthy();
  });

  it('a change to a preset makes a mod of one’s own, selected, which takes its clips; Undo takes it all back', async () => {
    const store = await setup(project(), 'mods');
    const before = present(store);
    const gate = preset(before, 'Gate');
    openPreset('Gate');
    fireEvent.click(within(screen.getByRole('article', { name: 'Volume' })).getByRole('button', { name: 'Clear' }));
    expect(title()).toBe('Gate 2');
    const made = own(store).find((m) => m.name === 'Gate 2')!;
    expect(present(store).mods[gate.id]).toBe(gate);
    expect(present(store).song.clips.map((c) => c.ref)).toEqual([made.id]);
    expect(store.getState().history.past).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(present(store)).toBe(before);
  });

  it('🎲 on a preset makes a mod of one’s own, selected', async () => {
    const store = await setup(project(), 'mods');
    openPreset('Gate');
    fireEvent.click(screen.getByRole('button', { name: 'Reroll this mod' }));
    expect(title()).toBe('Gate 2');
    expect(own(store).map((m) => m.name)).toEqual(['Mine', 'Gate 2']);
  });

  it('Start from makes a mod of one’s own from a preset, as before', async () => {
    const store = await setup(project(), 'mods');
    const startFrom = within(sidebar().getByRole('group', { name: 'Start from' }));
    expect(startFrom.getAllByRole('button').map((b) => b.textContent)).toEqual(START_FROM_PRESETS.map((p) => p.name));
    fireEvent.click(startFrom.getByRole('button', { name: 'Tape stop' }));
    expect(title()).toBe('Tape stop 2');
    expect(own(store).map((m) => m.name)).toEqual(['Mine', 'Tape stop 2']);
  });

  it('+ New mod is numbered by the mods of one’s own', async () => {
    const store = await setup(project(), 'mods');
    fireEvent.click(sidebar().getByRole('button', { name: '+ New mod' }));
    expect(own(store).map((m) => m.name)).toEqual(['Mine', 'Mod 2']);
  });
});

describe('the presets in Song (Mod-förval)', () => {
  const list = () => within(screen.getByRole('region', { name: 'List' }));
  const shelf = () => within(screen.getByRole('region', { name: 'Loops and mods' }));

  it('are not in Song’s list', async () => {
    await setup(project(), 'song');
    expect(within(list().getByRole('group', { name: 'Mods' })).getAllByRole('button', { name: /^Hear / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Hear Mine']);
    expect(list().queryByRole('group', { name: 'Presets' })).toBeNull();
  });

  it('are on the shelf in a fixed group Presets, last, always there and without pins', async () => {
    await setup(project(), 'song');
    expect(shelf().getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Main', 'Mods', 'Presets']);
    const group = within(shelf().getByRole('group', { name: 'Presets' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(MOD_PRESETS.map((p) => p.name));
    // Unpinning everything in the list leaves the presets on the shelf, and still asks for a pin.
    for (const button of list().getAllByRole('button', { name: /^Unpin / })) fireEvent.click(button);
    expect(shelf().getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Presets']);
    expect(shelf().getByText(/Pin a loop or mod in the list/)).toBeTruthy();
  });
});
