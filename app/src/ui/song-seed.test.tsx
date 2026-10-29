// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clip, Command, Project } from '../model';
import { addClip, addSample, copyClip, createMod, createProject, resizeClip, setBpm, setSlicing } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import { clipLength, placeText, seedCode, twinsText } from './clipSeed';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

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
  const take = (): Promise<Take> => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] });
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: take,
    renderSong: take,
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

const ctx = sequentialIds();
const run = (p: Project, c: Command) => {
  const r = c(p, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.project;
};

/** 8 bars, amen 1 (16 steps) over bar 1 in Main, and a mod Wobble over bar 1 in Mod A. */
function song(...more: Command[]): Project {
  let project = [addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(120), createMod('Wobble', [])].reduce(run, createProject());
  project = run(project, setSlicing(Object.keys(project.samples)[0]!, 1));
  project = run(project, addClip('main', Object.keys(project.loops)[0]!, 0, 16));
  project = run(project, addClip('modA', Object.keys(project.mods)[0]!, 0, 16));
  return more.reduce(run, project);
}

async function setup(project: Project) {
  const store: Store = createStore({ ...initialState(project), view: 'song' });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const mainClips = (store: Store) => present(store).song.clips.filter((c) => c.row === 'main');
const clipButton = (at: string) => screen.getByRole('button', { name: new RegExp(`^amen 1, ${at.replace(/\./g, '\\.')}`) });
const panel = () => screen.getByRole('region', { name: 'Selected clip' });
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

describe('the seed shown on clips (Song-v2)', () => {
  it('a seed shows as ◆ and three hex digits', () => {
    expect(seedCode(0x12345)).toBe('345');
    expect(seedCode(7)).toBe('007');
  });

  it('where a clip sits: its start as bar.beat as in the ruler (with the 1/16 when off the beat), and its length', () => {
    const clip = { start: 56, length: 16 } as Clip;
    expect(placeText(clip)).toBe('at 4.3 · 1 bar');
    expect(placeText({ ...clip, start: 48, length: 8 })).toBe('at 4.1 · 2 beats');
    expect(placeText({ ...clip, start: 57, length: 24 })).toBe('at 4.3.2 · 1 bar 2 beats');
  });

  it('a clip’s length as a musician says it', () => {
    expect(clipLength(4)).toBe('1 beat');
    expect(clipLength(3)).toBe('3/16');
    expect(clipLength(32)).toBe('2 bars');
    expect(clipLength(20)).toBe('1 bar 1 beat');
    expect(clipLength(35)).toBe('2 bars 3/16');
  });

  it('every clip shows its seed in its corner, and a copy shows the same', async () => {
    const p = song();
    const main = p.song.clips.find((c) => c.row === 'main')!;
    const store = await setup(run(p, copyClip(main.id, 'main', 32)));
    const tag = `◆ ${seedCode(main.seed)}`;
    expect(within(clipButton('1.1.1')).getByText(tag)).toBeTruthy();
    expect(within(clipButton('3.1.1')).getByText(tag)).toBeTruthy();
    const mod = present(store).song.clips.find((c) => c.row === 'modA')!;
    expect(within(screen.getByRole('button', { name: /^Wobble, 1\.1\.1/ })).getByText(`◆ ${seedCode(mod.seed)}`)).toBeTruthy();
  });

  it('the pointer over a clip says its name, bars and seed, and which clips sound the same', async () => {
    const p = song();
    const main = p.song.clips.find((c) => c.row === 'main')!;
    await setup(run(p, copyClip(main.id, 'main', 32)));
    expect(clipButton('1.1.1').title).toMatch(new RegExp(`^amen 1 · at 1\\.1 · 1 bar · seed ◆ ${seedCode(main.seed)} \\(sounds the same as the clip at 3\\.1\\)`));
    expect(screen.getByRole('button', { name: /^Wobble, 1\.1\.1/ }).title).toMatch(/^Wobble · at 1\.1 · 1 bar · seed ◆ [0-9a-f]{3} ·/);
  });
});

describe('the sentence about other clips', () => {
  const clip = (patch: Partial<Clip>): Clip => ({ id: 'a', row: 'main', ref: 'l', start: 0, length: 16, offset: 0, seed: 1, ...patch });

  it('they sound the same, they only share the seed, or it is its own roll', () => {
    const a = clip({});
    expect(twinsText([a, clip({ id: 'b', start: 16 })], a)).toBe('Same seed as the clip at 2.1: they sound the same.');
    expect(twinsText([a, clip({ id: 'b', start: 16, length: 8, offset: 8 })], a)).toBe('Shares its seed with the clip at 2.1.');
    expect(twinsText([a, clip({ id: 'b', start: 16, seed: 2 })], a)).toBe('Its own roll.');
  });

  it('several: all of them; the ones that sound the same go first', () => {
    const a = clip({});
    const twins = [a, clip({ id: 'b', start: 16 }), clip({ id: 'c', start: 48 })];
    expect(twinsText(twins, a)).toBe('Same seed as the clips at 2.1 and 4.1: they sound the same.');
    expect(twinsText([a, clip({ id: 'b', start: 16, length: 4 }), clip({ id: 'c', start: 32, length: 4 }), clip({ id: 'd', start: 48, length: 4 })], a)).toBe(
      'Shares its seed with the clips at 2.1, 3.1 and 4.1.',
    );
  });
});

describe('the selected clip’s panel', () => {
  it('shows nothing until a clip is selected; then its name, row and bars, seed and sentence', async () => {
    const store = await setup(song());
    expect(screen.queryByRole('region', { name: 'Selected clip' })).toBeNull();
    fireEvent.click(clipButton('1.1.1'));
    const main = mainClips(store)[0]!;
    expect(within(panel()).getByText('amen 1').className).toMatch(/loop-name main/);
    expect(within(panel()).getByText('Main · at 1.1 · 1 bar')).toBeTruthy();
    expect(within(panel()).getByText(`◆ ${seedCode(main.seed)}`)).toBeTruthy();
    expect(within(panel()).getByText('Its own roll.')).toBeTruthy();
    // A mod clip: Mod A, in the mod's colour.
    fireEvent.click(screen.getByRole('button', { name: /^Wobble, 1\.1\.1/ }));
    expect(within(panel()).getByText('Wobble').className).toMatch(/mod-name/);
    expect(within(panel()).getByText('Mod A · at 1.1 · 1 bar')).toBeTruthy();
  });

  it('Copy after it puts a copy right after the clip, as Ctrl+D, selects it, and they sound the same', async () => {
    const store = await setup(song());
    fireEvent.click(clipButton('1.1.1'));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Copy after it' }));
    expect(mainClips(store).map((c) => [c.start, c.length])).toEqual([
      [0, 16],
      [16, 16],
    ]);
    const [first, copy] = mainClips(store);
    expect(copy!.seed).toBe(first!.seed);
    expect(store.getState().selection.clip).toBe(copy!.id);
    expect(within(panel()).getByText('Main · at 2.1 · 1 bar')).toBeTruthy();
    expect(within(panel()).getByText('Same seed as the clip at 1.1: they sound the same.')).toBeTruthy();
    // Ctrl+D does the same: the next one.
    press('d', { ctrlKey: true });
    expect(mainClips(store).map((c) => c.start)).toEqual([0, 16, 32]);
    expect(within(panel()).getByText('Same seed as the clips at 1.1 and 2.1: they sound the same.')).toBeTruthy();
    expect(within(clipButton('3.1.1')).getByText(`◆ ${seedCode(first!.seed)}`)).toBeTruthy();
  });

  it('a shortened copy only shares its seed', async () => {
    const p = song();
    const main = p.song.clips.find((c) => c.row === 'main')!;
    const copied = run(p, copyClip(main.id, 'main', 32));
    const copy = copied.song.clips.find((c) => c.row === 'main' && c.start === 32)!;
    await setup(run(copied, resizeClip(copy.id, 'end', 40)));
    fireEvent.click(clipButton('1.1.1'));
    expect(within(panel()).getByText('Shares its seed with the clip at 3.1.')).toBeTruthy();
  });

  it('Copy after it at the song’s end says there is no room, as Ctrl+D', async () => {
    const p = song();
    const main = p.song.clips.find((c) => c.row === 'main')!;
    await setup(run(p, copyClip(main.id, 'main', 112)));
    fireEvent.click(clipButton('8.1.1'));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Copy after it' }));
    expect(screen.getByRole('alert').textContent).toMatch(/No room after it/);
  });

  it('🎲 Reroll this clip gives only it a new seed, so it is its own roll; Undo brings the old one back', async () => {
    const p = song();
    const main = p.song.clips.find((c) => c.row === 'main')!;
    const store = await setup(run(p, copyClip(main.id, 'main', 16)));
    const before = present(store);
    fireEvent.click(clipButton('2.1.1'));
    const dice = within(panel()).getByRole('button', { name: '🎲 Reroll this clip' });
    expect(dice.title).toMatch(/Undo/);
    fireEvent.click(dice);
    const [first, second] = mainClips(store);
    expect(first!.seed).toBe(main.seed);
    expect(second!.seed).not.toBe(main.seed);
    expect(within(panel()).getByText('Its own roll.')).toBeTruthy();
    expect(within(panel()).getByText(`◆ ${seedCode(second!.seed)}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(present(store)).toBe(before);
    expect(within(panel()).getByText('Same seed as the clip at 1.1: they sound the same.')).toBeTruthy();
  });

  it('🎲 on the clip’s edge is still there', async () => {
    await setup(song());
    fireEvent.click(clipButton('1.1.1'));
    expect(within(clipButton('1.1.1')).getByRole('button', { name: 'Reroll this clip' }).title).toMatch(/new random here only/);
  });

  it('Reroll everything keeps copies as copies', async () => {
    const p = song();
    const main = p.song.clips.find((c) => c.row === 'main')!;
    const store = await setup(run(p, copyClip(main.id, 'main', 16)));
    fireEvent.click(screen.getByRole('button', { name: 'Reroll everything' }));
    const [first, second] = mainClips(store);
    expect(first!.seed).not.toBe(main.seed);
    expect(second!.seed).toBe(first!.seed);
  });
});

describe('the help text in the Song box', () => {
  it('says each clip has its own seed, a copy keeps it and sounds the same, 🎲 rolls only that clip, and the song plays the same every time as Export WAV writes it', async () => {
    await setup(song());
    const help = within(screen.getByRole('region', { name: 'Song' })).getByText(/Every clip carries its own seed/);
    expect(help.textContent).toMatch(/A copy keeps it and sounds the same/);
    expect(help.textContent).toMatch(/🎲 on a selected clip rolls new random for that clip only/);
    expect(help.textContent).toMatch(/plays the same every time round, as Export WAV writes it/);
  });
});
