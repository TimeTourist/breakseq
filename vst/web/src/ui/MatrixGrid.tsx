import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type { Id, Matrix, Pad } from '../model';
import { hitSound, padSteps, sampleAudio, stepDuration } from '../model';
import { matrixPassSteps } from '../engine';
import { useApp, useOpen, useProject } from './context';
import { HIT_MIME, PAD_MIME } from './dnd';
import { InSongMark, useHeard } from './InSong';
import { NAME_MAX, middleEllipsis, padSilent } from './labels';
import type { DropTarget, Over, PadsOpen, Placing, Zoom } from './pads';
import { PADS_PER_ROW, dropLabel, dropTarget, hitLabel, rowNumber, sideOf, zoneOf } from './pads';
import { Waveform } from './Waveform';

interface MatrixGridProps {
  readonly matrix: Matrix;
  readonly open: PadsOpen;
  readonly zoom: Zoom;
  /** Seconds into the matrix while Play plays it, else null. */
  readonly playedSeconds: number | null;
  readonly placing: Placing;
  /** Plays a pad one pick, as it picks. */
  readonly onPlayPad: (pad: Pad) => void;
}

/** What the pointer is over in pad `padId`'s tile: a hit chip and its upper or lower half, or the pad; and the side of the tile. */
function overAt(e: DragEvent, padId: Id): Over {
  const tile = e.currentTarget.getBoundingClientRect();
  const side = sideOf(e.clientX, tile.left, tile.width);
  const chip = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-hit]') : null;
  if (chip === null || chip.dataset.hit === undefined) return { kind: 'pad', padId, hitId: null, zone: 'after', side };
  const rect = chip.getBoundingClientRect();
  return { kind: 'pad', padId, hitId: chip.dataset.hit, zone: zoneOf(e.clientY, rect.top, rect.height), side };
}

/** In a gap of the grid: the side of the nearest pad in the pointer's row, or null off any row. */
function gapOver(e: DragEvent): Over | null {
  const tiles = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.pad-tile[data-pad]')).map((t) => ({ id: t.dataset.pad!, rect: t.getBoundingClientRect() }));
  const row = tiles.filter((t) => e.clientY >= t.rect.top && e.clientY <= t.rect.bottom);
  const near = row.reduce<(typeof row)[number] | null>((best, t) => {
    const d = Math.abs(e.clientX - (t.rect.left + t.rect.width / 2));
    return best === null || d < Math.abs(e.clientX - (best.rect.left + best.rect.width / 2)) ? t : best;
  }, null);
  if (near === null) return null;
  return { kind: 'pad', padId: near.id, hitId: null, zone: 'after', side: e.clientX < near.rect.left + near.rect.width / 2 ? 'before' : 'after' };
}

const sameOver = (a: Over | null, b: Over) =>
  a !== null && (a.kind === 'new' ? b.kind === 'new' : b.kind === 'pad' && a.padId === b.padId && a.hitId === b.hitId && a.zone === b.zone && a.side === b.side);

/**
 * The matrix's pads as a grid that wraps downward (Magnus beslut): each pad a
 * tile with its number (and ♪) and its hits under it, each hit with its own
 * waveform. A click on a pad's number selects and plays it, a click on a hit
 * selects and plays the hit. Drops (see `dropTarget`): copies onto a pad, a
 * hit reordered within its pad, a pad dragged by its number moved beside
 * another or copied into one, and a new pad on the place after the pads.
 * While dragging, the target says what happens, and a line shows where a
 * moved hit or pad goes.
 */
export function MatrixGrid({ matrix, open, zoom, playedSeconds, placing, onPlayPad }: MatrixGridProps) {
  const project = useProject();
  const { services } = useApp();
  const select = useOpen();
  const heard = useHeard();
  const pads = matrix.pads.flatMap((id) => (project.pads[id] === undefined ? [] : [project.pads[id]]));
  const selectedPad = open.kind === 'matrix' ? null : open.pad.id;
  const selectedHit = open.kind === 'hit' ? open.hit.id : null;
  // Roving tabindex: the selected pad or hit is the grid's one Tab stop, else the first pad; arrows go on from there.
  const tabPad = selectedHit !== null ? null : (selectedPad ?? pads[0]?.id ?? null);
  const [hover, setHover] = useState<Over | null>(null);
  // A drag that ends, dropped or not, leaves no mark.
  useEffect(() => {
    if (placing.dragging === null) setHover(null);
  }, [placing.dragging]);
  const target: DropTarget | null = placing.dragging === null || hover === null ? null : dropTarget(project, placing.dragging, hover);
  const label = placing.dragging === null || target === null ? null : dropLabel(project, placing.dragging, target);
  /** Where a moved pad goes: a line at that side of the pad the pointer is by. */
  const insertAt = target?.kind === 'movePad' && hover?.kind === 'pad' ? hover : null;

  /** The pad that plays now, while Play plays the matrix: it lights up. (Claudes val.) */
  const playingPad = (() => {
    if (playedSeconds === null) return null;
    const steps = matrixPassSteps(project, matrix.id);
    if (steps === 0) return null;
    const at = (playedSeconds / stepDuration(project.song.bpm)) % steps;
    let start = 0;
    for (const pad of pads) {
      const length = padSteps(project, pad);
      if (length > 0 && at >= start && at < start + length) return pad.id;
      start += length;
    }
    return null;
  })();

  /** Drop handlers for a place: a pad's tile (and the hit chips in it), the gaps of the grid, or the new pad's. */
  const dropOn = (over: (e: DragEvent) => Over | null) => ({
    onDragOver: (e: DragEvent) => {
      if (placing.dragging === null) return;
      const at = over(e);
      const next = at === null ? null : dropTarget(project, placing.dragging, at);
      if (at === null || next === null) {
        if (hover !== null) setHover(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = next.kind === 'reorder' || next.kind === 'movePad' ? 'move' : 'copy';
      if (!sameOver(hover, at)) setHover(at);
    },
    onDrop: (e: DragEvent) => {
      const dragged = placing.dragging;
      setHover(null);
      if (dragged === null) return;
      const at = over(e);
      const target = at === null ? null : dropTarget(project, dragged, at);
      if (target === null) return;
      e.preventDefault();
      placing.place(target);
      placing.endDrag();
    },
  });
  const gaps = dropOn(gapOver);

  return (
    <div
      className="pad-grid"
      role="region"
      aria-label="Pads of the matrix"
      style={{ gridTemplateColumns: `repeat(${PADS_PER_ROW[zoom]}, minmax(0, 1fr))` }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setHover(null);
      }}
      // Only the gaps between the pads are the grid's own: a pad's tile takes its own drops.
      onDragOver={(e) => {
        if (e.target === e.currentTarget) gaps.onDragOver(e);
      }}
      onDrop={(e) => {
        if (e.target === e.currentTarget) gaps.onDrop(e);
      }}
    >
      {pads.map((pad, row) => {
        const dropsHere = target !== null && (target.kind === 'add' || target.kind === 'variant') && target.padId === pad.id;
        const insert = insertAt !== null && insertAt.padId === pad.id ? insertAt.side : null;
        return (
          <div
            key={pad.id}
            className={`pad-tile${pad.id === selectedPad && selectedHit === null ? ' current' : ''}${pad.id === playingPad ? ' playing' : ''}${padSilent(project, pad) ? ' silent' : ''}`}
            data-pad={pad.id}
            data-drop={dropsHere ? label : undefined}
            {...dropOn((e) => overAt(e, pad.id))}
          >
            {insert !== null && (
              <span className={`pad-insert ${insert}`} aria-hidden="true">
                <span className="pad-insert-label">{label}</span>
              </span>
            )}
            <button
              type="button"
              className="pad-head"
              aria-label={`Pad ${pad.name}`}
              aria-current={pad.id === selectedPad && selectedHit === null ? 'true' : undefined}
              tabIndex={pad.id === tabPad ? 0 : -1}
              title={`${pad.name}: click to select and hear it; drag it beside another pad to move it, or onto one to copy its hits there`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PAD_MIME, pad.id);
                e.dataTransfer.effectAllowed = 'copyMove';
                placing.startDrag({ kind: 'pad', padId: pad.id, from: 'grid' });
              }}
              onDragEnd={placing.endDrag}
              onClick={() => {
                select({ pad: pad.id, hit: null }, 'pads');
                onPlayPad(pad);
              }}
            >
              <span className="pad-number mono">{rowNumber(row)}</span>
              <InSongMark heard={heard.pads.has(pad.id)} />
            </button>
            <ol className="pad-hits" aria-label={`Hits of ${pad.name}`}>
              {pad.members.map((id, i) => {
                const hit = project.hits[id];
                if (hit === undefined) return null;
                const sound = hitSound(project, hit);
                const audio = sound === null ? undefined : sampleAudio(project, sound.sample);
                // Its place in the pad first, so the hit does not read as the pad's number (1 08); the two together as long as a name. (Claudes val.)
                const place = String(i + 1);
                const label = hitLabel(project, pad.id, row, hit);
                const shown = `${place} ${middleEllipsis(label, NAME_MAX - place.length - 1)}${hit.direction === 'reverse' ? ' ◂' : ''}`;
                const insert = target?.kind === 'reorder' && hover?.kind === 'pad' && hover.hitId === id ? ` insert-${hover.zone}` : '';
                return (
                  <li key={id} className={insert}>
                    <button
                      type="button"
                      className={`hit-chip mono${i === 0 ? ' first' : ''}${label.includes('→') ? ' replaced' : ''}`}
                      aria-label={`${shown}, ${hit.name}`}
                      aria-current={id === selectedHit ? 'true' : undefined}
                      tabIndex={id === selectedHit ? 0 : -1}
                      title={`${hit.name}${i === 0 ? ' · first: plays by default' : ''} · click plays it; drag it onto another pad to copy it, or up or down in its pad to reorder`}
                      data-hit={id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(HIT_MIME, id);
                        e.dataTransfer.effectAllowed = 'copyMove';
                        placing.startDrag({ kind: 'hit', hitId: id, from: 'grid' });
                      }}
                      onDragEnd={placing.endDrag}
                      onClick={() => {
                        select({ pad: pad.id, hit: id }, 'pads');
                        services.player.playHit(project, id);
                      }}
                    >
                      {audio !== undefined && sound !== null && sound.region.end > sound.region.start && (
                        <span className="hit-wave" aria-hidden="true">
                          <Waveform audio={audio} offset={sound.sample.offset + sound.region.start} duration={sound.region.end - sound.region.start} height={16} />
                        </span>
                      )}
                      <span className="hit-line">
                        <span className="hit-label">
                          <span className="hit-place">{place}</span>
                          {shown.slice(place.length)}
                        </span>
                        <InSongMark heard={heard.hits.has(id)} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {pad.members.length === 0 && <span className="muted small pad-empty">Empty: drop a hit here</span>}
          </div>
        );
      })}
      <div className="pad-tile new-pad" data-drop={target?.kind === 'new' ? label : undefined} {...dropOn(() => ({ kind: 'new', matrixId: matrix.id }))}>
        {placing.dragging === null ? '+ drop here for a new pad' : target?.kind === 'new' ? `${label}: a new pad` : 'Drop here: a new pad'}
      </div>
    </div>
  );
}
