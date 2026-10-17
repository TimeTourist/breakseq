// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBreak } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function fakeServices(): Services {
  return services ?? (services = makeServices());
}

let services: Services | null = null;
afterEach(() => {
  services = null;
});

function makeServices(): Services {
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
    download: vi.fn(),
    rng: () => () => 0,
  };
}

function build(...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
}

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={fakeServices()} />);
  await act(async () => {});
  return store;
}

const sample = (store: Store) => Object.values(store.getState().history.present.samples)[0]!;
const brk = (store: Store) => Object.values(store.getState().history.present.breaks)[0]!;
/** The break's markers in seconds: it is 2 s long. */
const markers = (store: Store) => brk(store).markers.map((m) => m * 2);
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Trim in Import', () => {
  it('the start and end fields set the window, and one edit is one undo step', async () => {
    const store = await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'import');
    fireEvent.click(button('Trim amen trim 1'));

    fireEvent.change(screen.getByLabelText('Start ms'), { target: { value: '25' } });
    fireEvent.blur(screen.getByLabelText('Start ms'));
    fireEvent.change(screen.getByLabelText('End ms'), { target: { value: '1900' } });

    expect(sample(store).offset).toBeCloseTo(0.025);
    expect(sample(store).duration).toBeCloseTo(1.875);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(sample(store).duration).toBeCloseTo(1.975);
  });
});

describe('Markers in Slice', () => {
  /** A 2 s, one-bar break with markers on 1/16, open in Slice. */
  async function sliceSetup() {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const result = setBreak(Object.keys(project.breaks)[0]!, 1)(project, ctx);
    if (!result.ok) throw new Error('setBreak failed');
    return setup(result.project, 'slice');
  }

  it('← Trim opens the break’s Trim in Import', async () => {
    const store = await sliceSetup();
    fireEvent.click(screen.getByRole('button', { name: '← Trim' }));
    const id = Object.keys(store.getState().history.present.breaks)[0]!;
    expect(store.getState()).toMatchObject({ view: 'import', trimming: id });
    expect(screen.getByRole('button', { name: 'Trim amen trim 1' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('←/→ nudges the selected marker by 1 ms, Shift by 10 ms', async () => {
    const store = await sliceSetup();
    const before = markers(store)[2]!;
    const marker = button(/^Marker 03 at/);
    fireEvent.focus(marker);

    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    fireEvent.keyDown(marker, { key: 'ArrowLeft', shiftKey: true });

    expect(markers(store)[2]).toBeCloseTo(before + 0.001 - 0.01, 6);
  });

  it('Add marker splits the selected slice, and Delete marker takes it out again', async () => {
    const store = await sliceSetup();
    fireEvent.click(button('Play slice 04'));
    const [a, b] = [markers(store)[3]!, markers(store)[4]!];

    fireEvent.click(button('Add marker'));
    expect(markers(store)).toHaveLength(17);
    expect(markers(store)[4]).toBeCloseTo((a + b) / 2);
    expect(brk(store).pads).toHaveLength(17);

    fireEvent.click(button('Delete marker'));
    expect(markers(store)).toHaveLength(16);
    // The 17th pad stays, silent.
    expect(brk(store).pads).toHaveLength(17);
  });

  it('there is nothing to apply: the break has its pads and M1 straight away, and markers move while M1 is in use', async () => {
    const store = await sliceSetup();
    expect(screen.queryByRole('button', { name: 'Apply slices' })).toBeNull();
    expect(brk(store).pads).toHaveLength(16);
    expect(Object.values(store.getState().history.present.loops).map((l) => l.name)).toEqual(['amen 1']);

    fireEvent.click(button('Play slice 02'));
    fireEvent.click(button('Delete marker'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(markers(store)).toHaveLength(15);
  });
});

describe('Playing while trimming', () => {
  it('a break plays looped by default, follows the trim while it plays, and Once restarts it once', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(project.breaks)[0]!;
    const asBreak = setBreak(id, 1)(project, ctx);
    if (!asBreak.ok) throw new Error('setBreak failed');
    await setup(asBreak.project, 'import');
    const player = fakeServices().player;
    fireEvent.click(button('Trim amen trim 1'));

    fireEvent.click(button('Play trim'));
    expect(vi.mocked(player.audition).mock.calls.at(-1)?.[4]).toBe(true);

    fireEvent.change(screen.getByLabelText('Start ms'), { target: { value: '100' } });
    expect(player.setAuditionRegion).toHaveBeenCalledWith(0.1, expect.closeTo(1.9, 6));

    fireEvent.click(button('Once'));
    expect(vi.mocked(player.audition).mock.calls.at(-1)?.[4]).toBe(false);
  });

  it('a one-shot loops by default, as everything does', async () => {
    await setup(build(addSample({ name: 'snare.wav', audio: constantAudio(0.3) })), 'import');
    fireEvent.click(button('Trim snare trim 1'));
    fireEvent.click(button('Play trim'));
    expect(vi.mocked(fakeServices().player.audition).mock.calls.at(-1)?.[4]).toBe(true);
  });
});

describe('files, trims and breaks in the GUI', () => {
  async function sliced() {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const result = setBreak(Object.keys(project.breaks)[0]!, 1)(project, ctx);
    if (!result.ok) throw new Error('setBreak failed');
    return result.project;
  }

  it('Import makes a new trim of a file on a row of its own, with its Trim open', async () => {
    const store = await setup(await sliced(), 'import');
    fireEvent.click(screen.getByRole('button', { name: 'New trim of amen.wav' }));
    const breaks = Object.values(store.getState().history.present.breaks);
    expect(breaks.map((b) => b.name)).toEqual(['amen 1', 'amen 2']);
    expect(screen.getByRole('button', { name: 'Trim amen trim 2' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('Hits renames the break from its parent, and shows its slice, trim and file as links', async () => {
    const project = await sliced();
    const brk = Object.values(project.breaks)[0]!;
    const store = createStore({ ...initialState(project), view: 'hits', selection: { ...initialState(project).selection, hit: brk.parent } });
    render(<App store={store} services={fakeServices()} />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Hit name'), { target: { value: 'think' } });
    expect(store.getState().history.present.breaks[brk.id]!.name).toBe('think');
    fireEvent.click(screen.getByRole('button', { name: 'amen slice 1' }));
    expect(store.getState()).toMatchObject({ view: 'slice', sliceTarget: brk.id });
  });

  it('Slice has no Replace sample; Hits → opens the break, and Make one-shot makes a one-shot of the slice', async () => {
    const store = await setup(await sliced(), 'slice');
    expect(screen.queryByRole('button', { name: 'Replace sample…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Make one-shot' }));
    expect(Object.values(store.getState().history.present.breaks).map((b) => b.name)).toEqual(['amen 1', 'amen 2']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Hits →' })[0]!);
    const brk = Object.values(store.getState().history.present.breaks)[0]!;
    expect(store.getState()).toMatchObject({ view: 'hits', selection: { hit: brk.parent } });
  });
});

describe('the open Trim in Import', () => {
  it('opens and closes again and again, even where scrolling returns a promise', async () => {
    // Newer browsers' scroll methods return a promise; an effect that returned one crashed the app.
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => Promise.resolve() as unknown as void);
    const scrollIntoView = vi.fn(() => Promise.resolve());
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
    await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'import');
    for (let i = 0; i < 4; i++) fireEvent.click(button('Trim amen trim 1'));
    expect(button('Trim amen trim 1').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button('Trim amen trim 1'));
    expect(button('Trim amen trim 1').getAttribute('aria-expanded')).toBe('true');
    scrollBy.mockRestore();
  });

  it('closes on a click outside it, but not on a click in it or in the header', async () => {
    const store = await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'import');
    fireEvent.click(button('Trim amen trim 1'));
    fireEvent.pointerDown(screen.getByLabelText('Start ms'));
    fireEvent.pointerDown(document.querySelector('.header')!);
    expect(store.getState().trimming).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Import' }));
    expect(store.getState().trimming).toBeNull();
  });
});

describe('Creates in Import', () => {
  it('counts the slices, pads and the loops that play the break, own loop first', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(project.breaks)[0]!;
    const sliced = setBreak(id, 1)(project, ctx);
    if (!sliced.ok) throw new Error('setBreak failed');
    const brk = sliced.project.breaks[id]!;
    const store = await setup(sliced.project, 'import');
    const row = screen.getByRole('button', { name: 'Slice →' }).closest('tr')!;
    expect(row.textContent).toContain('16 Slice →');
    expect(row.textContent).toContain('16 Hits →');
    expect(row.textContent).toContain('1 Loops →');
    fireEvent.click(screen.getByRole('button', { name: 'Loops →' }));
    expect(store.getState()).toMatchObject({ view: 'loops', selection: { loop: brk.loop } });
  });
});
