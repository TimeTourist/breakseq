import { describe, expect, it, vi } from 'vitest';
import type { PickState } from '../engine';
import type { Project } from '../model';
import { createProject } from '../model';
import type { Take } from './playback';
import type { RenderRequest } from './services';
import { createVarv } from './varv';

/** Block n of a subject: a project whose bpm says which block it is. */
const blocksOf = (version: number) => (block: number): Project => ({ ...createProject(), song: { ...createProject().song, bpm: 100 + block, bars: version } });
const takeOf = (project: Project, from?: PickState): Take => ({
  buffer: { duration: 4 } as AudioBuffer,
  triggers: [],
  tapes: [],
  step: 0.25,
  end: { turns: { [`v${project.song.bars}`]: (from?.turns[`v${project.song.bars}`] ?? 0) + 1 }, last: {} },
});

function setup() {
  const rendered: { project: Project; request: RenderRequest | undefined }[] = [];
  const render = vi.fn(async (project: Project, request?: RenderRequest) => {
    rendered.push({ project, request });
    return takeOf(project, request?.from);
  });
  const queued: { take: Take | null; onStart: (() => void) | undefined }[] = [];
  const player = {
    queue: vi.fn((take: Take | null, onStart?: () => void) => queued.push({ take, onStart })),
    replace: vi.fn(),
  };
  const varv = createVarv({ render, player, start: (blocks, block) => ({ turns: { [`v${blocks(0).song.bars}`]: block }, last: {} }) });
  return { varv, render, rendered, player, queued };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('varv: Play in Matrices, Loops and Mods renders the passes as they play', () => {
  it('when a block starts, the next is rendered from where it ended and queued', async () => {
    const { varv, rendered, queued } = setup();
    const blocks = blocksOf(1);
    varv.start(blocks, takeOf(blocks(0)));
    await settle();
    expect(rendered.map((r) => r.project.song.bpm)).toEqual([101]);
    // Block 0 ended with Round robin one further: block 1 starts there.
    expect(rendered[0]!.request?.from).toEqual({ turns: { v1: 1 }, last: {} });
    expect(queued).toHaveLength(1);
    expect(varv.block()).toBe(0);
    queued[0]!.onStart!();
    expect(varv.block()).toBe(1);
    await settle();
    expect(rendered.map((r) => r.project.song.bpm)).toEqual([101, 102]);
    expect(rendered[1]!.request?.from).toEqual({ turns: { v1: 2 }, last: {} });
    expect(queued).toHaveLength(2);
  });

  it('a change in block 0 swaps in its new render and queues block 1 anew', async () => {
    const { varv, rendered, player, queued } = setup();
    varv.start(blocksOf(1), takeOf(blocksOf(1)(0)));
    await settle();
    const changed = blocksOf(2);
    const first = takeOf(changed(0));
    varv.update(changed, first);
    expect(player.replace).toHaveBeenCalledWith(first);
    await settle();
    expect(rendered.at(-1)!.project.song.bars).toBe(2);
    expect(rendered.at(-1)!.project.song.bpm).toBe(101);
    expect(queued.at(-1)!.take).not.toBeNull();
    // The block queued before the change is never started.
    queued[0]!.onStart?.();
    expect(varv.block()).toBe(0);
  });

  it('a change in a later block renders that block anew from where it starts, swaps it in and queues the next', async () => {
    const { varv, rendered, player, queued } = setup();
    varv.start(blocksOf(1), takeOf(blocksOf(1)(0)));
    await settle();
    queued[0]!.onStart!();
    await settle();
    expect(varv.block()).toBe(1);
    const changed = blocksOf(2);
    varv.update(changed, takeOf(changed(0)));
    // The block queued for the old project is taken away at once.
    expect(queued.at(-1)!.take).toBeNull();
    await settle();
    const again = rendered.find((r) => r.project.song.bars === 2 && r.project.song.bpm === 101)!;
    expect(again.request?.from).toEqual({ turns: { v2: 1 }, last: {} });
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(vi.mocked(player.replace).mock.calls[0]![0].end).toEqual({ turns: { v2: 2 }, last: {} });
    expect(rendered.at(-1)!.project.song.bpm).toBe(102);
    expect(queued.at(-1)!.take).not.toBeNull();
  });

  it('Stop leaves nothing to follow', async () => {
    const { varv, queued } = setup();
    varv.start(blocksOf(1), takeOf(blocksOf(1)(0)));
    varv.stop();
    await settle();
    expect(queued).toHaveLength(0);
  });
});
