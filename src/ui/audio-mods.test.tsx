// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, setSongCell, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function services(): Services {
  const player: Player = {
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
    exportRex: vi.fn(),
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

/** A snare on every 1/8 of a one-bar main loop, placed in the song. */
function project(): Project {
  const p = apply(createProject(), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }), createLoop(null, 'main', 1));
  const pad = Object.values(p.pads)[0]!.id;
  const loop = Object.values(p.loops)[0]!.id;
  return apply(p, ...[0, 2, 4, 6, 8, 10, 12, 14].map((i) => setStep(loop, i, { padId: pad })), setSongCell('main', 0, loop));
}

async function setup(): Promise<Store> {
  const store = createStore({ ...initialState(project()), view: 'mods' });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '+ New mod' }));
  return store;
}

const present = (store: Store) => store.getState().history.present;
const mod = (store: Store) => Object.values(present(store).mods)[0]!;
const effect = (store: Store, target: string) => mod(store).effects.find((e) => e.target === target) as Record<string, unknown> | undefined;
const add = (target: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Add effect' }), { target: { value: target } });
const card = (name: string) => screen.getByRole('article', { name });
const choose = (inCard: HTMLElement, group: string, option: string) =>
  fireEvent.click(within(within(inCard).getByRole('group', { name: group })).getByRole('button', { name: option }));
const SOURCE = 'Source: what’s heard (step mods, reverb/delay, tape), never itself or another audio mod. Every roll is seeded.';

describe('audio mods in Mods', () => {
  it('+ Add effect has them after Tape, in the spec’s order (Scratch comes later)', async () => {
    await setup();
    const options = within(screen.getByRole('combobox', { name: 'Add effect' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options.slice(-7)).toEqual(['Tape', 'Scramble', 'Stutter', 'Freeze', 'Reverse', 'Rewind', 'Halftime']);
  });

  it('Scramble: its sentence, the Source line, Around the clip greyed until Take from is ± bars, and the picture with 🎲 Reroll', async () => {
    const store = await setup();
    add('scramble');
    const scramble = card('Scramble');
    expect(within(scramble).getByText('Scramble · cells of 1/16 from the whole song · 4 steps of 1 beat (1 bar), loops · 50% swap · 0% reversed')).toBeTruthy();
    expect(within(scramble).getByText(SOURCE)).toBeTruthy();
    expect(within(scramble).getByText('Only with Take from ± bars')).toBeTruthy();

    choose(scramble, 'Take from', '± bars');
    expect(within(scramble).queryByText('Only with Take from ± bars')).toBeNull();
    choose(scramble, 'Around the clip', '± 1');
    choose(scramble, 'Cell', '1/8');
    choose(scramble, 'Reverse chance', '25%');
    expect(effect(store, 'scramble')!.scramble).toEqual({ cell: 2, from: 'around', around: 1, reverse: 25 });
    expect(within(scramble).getByText('Scramble · cells of 1/8 from ± 1 bar around the clip · 4 steps of 1 beat (1 bar), loops · 50% swap · 25% reversed')).toBeTruthy();

    expect(within(scramble).getByText('Where each cell comes from')).toBeTruthy();
    expect(within(scramble).getByText(/^\d+ of 8 cells swapped$/)).toBeTruthy();
    const seed = mod(store).seed;
    fireEvent.click(within(scramble).getByRole('button', { name: '🎲 Reroll' }));
    expect(mod(store).seed).not.toBe(seed);
  });

  it('Stutter: Roll draws 1/16 → 1/32 → 1/64 over a beat; Grabs, Pitch per repeat and Gate', async () => {
    const store = await setup();
    add('stutter');
    const stutter = card('Stutter');
    expect(within(stutter).getByText('Stutter · grabs 1/16 · 4 steps of 1 beat (1 bar), loops · off · no pitch drift, gate 100%')).toBeTruthy();
    fireEvent.click(within(stutter).getByRole('button', { name: 'Roll' }));
    expect(effect(store, 'stutter')).toMatchObject({ step: '1/16', lane: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 3 }] });
    choose(stutter, 'Grabs', 'beat');
    choose(stutter, 'Pitch per repeat', '−1 st');
    choose(stutter, 'Gate', '75%');
    expect(within(stutter).getByText('Stutter · grabs beat · 4 steps of 1/16 (1 beat), loops · repeats 1/16 → 1/64 · −1 st per repeat, gate 75%')).toBeTruthy();
    // Its choices have an order, so Ramp draws a line through them.
    expect(within(stutter).getByRole('button', { name: /Ramp/ }).hasAttribute('disabled')).toBe(false);
  });

  it('Freeze, Reverse and Rewind: on/off lanes with their own settings; Ramp greyed', async () => {
    const store = await setup();
    add('freeze');
    add('reverse');
    add('rewind');
    const freeze = card('Freeze');
    choose(freeze, 'Grain', '80 ms');
    choose(freeze, 'Spread', '25%');
    choose(freeze, 'Level', '−3 dB');
    expect(within(freeze).getByText('Freeze · 4 steps of 1 beat (1 bar), loops · frozen on 0 of 4 · grain 80 ms, spread 25%, −3 dB')).toBeTruthy();
    choose(card('Reverse'), 'Cell', 'beat');
    expect(within(card('Reverse')).getByText('Reverse · cells of beat · 4 steps of 1 beat (1 bar), loops · reversed on 0 of 4')).toBeTruthy();
    const rewind = card('Rewind');
    choose(rewind, 'Pulls back', '1 bar');
    choose(rewind, 'Curve', 'Spin-back');
    expect(effect(store, 'rewind')!.rewind).toEqual({ pullBack: 16, curve: 'spinBack' });
    expect(within(rewind).getByText('Rewind · pulls back 1 bar, Spin-back · 4 steps of 1 beat (1 bar), loops · never fires')).toBeTruthy();
    for (const name of ['Freeze', 'Reverse', 'Rewind']) {
      expect(within(card(name)).getByText('An on/off lane has no slope')).toBeTruthy();
      expect(within(card(name)).getByText(SOURCE)).toBeTruthy();
    }
  });

  it('Halftime has no lane: Speed and Keep pitch, and its sentence', async () => {
    const store = await setup();
    add('halftime');
    const halftime = card('Halftime');
    expect(within(halftime).getByText('Halftime · ×0.5 under the whole clip, no ramp · pitch drops like a record')).toBeTruthy();
    expect(within(halftime).queryByRole('group', { name: 'Step size' })).toBeNull();
    choose(halftime, 'Speed', '×2');
    expect(within(halftime).getByText('Halftime · ×2 under the whole clip, no ramp · double time, pitch up like a record')).toBeTruthy();
    choose(halftime, 'Keep pitch (stretch, off by default)', 'On');
    expect(effect(store, 'halftime')).toEqual({ target: 'halftime', speed: 2, keepPitch: true });
    expect(within(halftime).getByText('Halftime · ×2 under the whole clip, no ramp · pitch kept (stretch)')).toBeTruthy();
    expect(within(halftime).getByText(SOURCE)).toBeTruthy();
  });
});
