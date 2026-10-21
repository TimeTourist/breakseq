import type { PickState } from '../engine';
import { blockStart, isRenderCancelled } from '../engine';
import type { Project } from '../model';
import type { Player, Take } from './playback';
import type { RenderRequest } from './services';

/** The song of block n of what plays: passes block·k … block·k + k − 1 (see matrixBlock). */
export type Blocks = (block: number) => Project;

export interface VarvDeps {
  readonly render: (project: Project, request?: RenderRequest) => Promise<Take>;
  readonly player: Pick<Player, 'queue' | 'replace'>;
  /** Where the pads' choices stand when a block starts; blockStart unless a test injects its own. */
  readonly start?: (blocks: Blocks, block: number) => PickState;
  /** A render that failed for another reason than being cancelled. */
  readonly onError?: (error: unknown) => void;
}

export interface Varv {
  /** Play has started block 0 of `blocks`, rendered as `first`: from now each block is followed by the next. */
  readonly start: (blocks: Blocks, first: Take) => void;
  /**
   * What plays has changed, and `first` is block 0 rendered anew: the block
   * playing takes the change as soon as it can (replace), and the next one is
   * queued anew.
   */
  readonly update: (blocks: Blocks, first: Take) => void;
  readonly stop: () => void;
  /** The block playing now. */
  readonly block: () => number;
}

/**
 * Play in Matrices, Loops and Mods with Loop on: new passes each time round
 * (see Varv i loop). One block plays while the next renders; when it reaches
 * its end the next takes over (Player.queue) and the one after it renders. A
 * block starts where the last ended, so Round robin goes on counting, and the
 * same seeds give the same series of blocks. (Claudes val.)
 */
export function createVarv(deps: VarvDeps): Varv {
  const startOf = deps.start ?? blockStart;
  let blocks: Blocks | null = null;
  let block = 0;
  // Each start, change or stop begins a new run: what an older one renders is dropped.
  let run = 0;
  let controller: AbortController | null = null;

  const fail = (e: unknown) => {
    if (!isRenderCancelled(e)) deps.onError?.(e);
  };

  const begin = () => {
    controller?.abort();
    controller = new AbortController();
    return { id: ++run, signal: controller.signal };
  };

  /** Renders the block after the one playing, which ended at `from`, and queues it. */
  const queueNext = (id: number, signal: AbortSignal, from: PickState | undefined) => {
    const of = blocks;
    if (of === null) return;
    const next = block + 1;
    deps
      .render(of(next), { signal, ...(from === undefined ? {} : { from }) })
      .then((take) => {
        if (id !== run) return;
        deps.player.queue(take, () => {
          if (id !== run) return;
          block = next;
          queueNext(id, signal, take.end);
        });
      })
      .catch(fail);
  };

  return {
    start: (next, first) => {
      const { id, signal } = begin();
      blocks = next;
      block = 0;
      queueNext(id, signal, first.end);
    },
    update: (next, first) => {
      const { id, signal } = begin();
      blocks = next;
      // The block queued for what played before is not it any more.
      deps.player.queue(null);
      if (block === 0) {
        deps.player.replace(first);
        queueNext(id, signal, first.end);
        return;
      }
      const from = startOf(next, block);
      deps
        .render(next(block), { signal, from })
        .then((take) => {
          if (id !== run) return;
          deps.player.replace(take);
          queueNext(id, signal, take.end);
        })
        .catch(fail);
    },
    stop: () => {
      controller?.abort();
      controller = null;
      run++;
      blocks = null;
      block = 0;
    },
    block: () => block,
  };
}
