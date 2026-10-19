// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, copyHits, createLoop, createMatrix, createProject } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import { NAME_MAX, middleEllipsis } from './labels';
import type { Take } from './playback';
import type { Services } from './services';
import type { AppState } from './store';
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

const FILE = 'Alvin_Cash_Scott_Bros_Orch_-_Keep_On_Dancing_(Instrumental).wav';
const LOOP = 'A loop with a very long name indeed';

/** A file with a long name, a matrix Kit with a copy of its hit, and a loop with a long name. */
function longNames() {
  const sampled = apply(createProject(), addSample({ name: FILE, audio: constantAudio(0.2) }), createMatrix('Kit'), createLoop(LOOP, 'main', 1));
  const hit = Object.values(sampled.hits)[0]!;
  const kit = Object.values(sampled.matrices).find((m) => m.name === 'Kit')!;
  const own = Object.values(sampled.matrices).find((m) => m.name !== 'Kit')!;
  return { project: apply(sampled, copyHits([hit.id], kit.pads[0]!)), kit, own };
}

async function setup(project: Project, state: Partial<AppState>) {
  const store = createStore({ ...initialState(project), ...state });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('long names are shortened the same way everywhere', () => {
  it(`middleEllipsis keeps ${NAME_MAX} characters: the start, …, and the end with the extension`, () => {
    expect(NAME_MAX).toBe(20);
    const short = middleEllipsis(FILE);
    expect(short).toHaveLength(NAME_MAX);
    expect(short).toContain('…');
    expect(short.startsWith('Alvin_Cash_S')).toBe(true);
    expect(short.endsWith('l).wav')).toBe(true);
    expect(middleEllipsis('amen.wav')).toBe('amen.wav');
  });

  it('a file name in Samples, with the whole name over it', async () => {
    await setup(longNames().project, { view: 'samples' });
    const name = within(screen.getByRole('region', { name: 'Files' })).getByText(middleEllipsis(FILE));
    expect(name.title).toBe(FILE);
  });

  it('a hit in the Pads timeline and on the Take from shelf, with the whole name over it', async () => {
    const { project, kit, own } = longNames();
    const hit = Object.values(project.hits).find((h) => project.pads[kit.pads[0]!]!.members.includes(h.id))!;
    expect(hit.name.length).toBeGreaterThan(NAME_MAX);
    await setup(project, { view: 'pads', focus: { matrix: kit.id, takeFrom: [own.id] } });
    const chip = within(screen.getByRole('list', { name: /^Hits of/ })).getByRole('button');
    const shown = chip.querySelector('.hit-label')!.textContent!;
    expect(shown.length).toBeLessThanOrEqual(NAME_MAX);
    expect(shown).toContain('…');
    expect(chip.title.startsWith(hit.name)).toBe(true);
    const shelf = within(screen.getByRole('region', { name: 'Take from shelf' }));
    const onShelf = shelf.getAllByRole('button').find((b) => b.classList.contains('hit-chip'))!;
    expect(onShelf.textContent!.length).toBeLessThanOrEqual(NAME_MAX);
    expect(onShelf.textContent).toContain('…');
  });

  it("a loop in Loops' menu: one line, shortened, the whole name over it", async () => {
    await setup(longNames().project, { view: 'loops' });
    const menu = within(screen.getByRole('complementary', { name: 'Loops' }));
    const item = menu.getByTitle(LOOP);
    expect(item.classList.contains('loop-item')).toBe(true);
    expect(item.querySelector('.loop-name')!.textContent).toBe(middleEllipsis(LOOP));
  });
});
