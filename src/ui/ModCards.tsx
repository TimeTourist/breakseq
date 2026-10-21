import type { ReactNode } from 'react';
import type { SwapEffect, TapeEffect, TempoEffect } from '../model';
import { TrashIcon } from './icons';
import { TARGET_LABELS } from './modLabels';
import { SwapSentence, TapeSentence, TempoSentence } from './ModSentence';

/** A card for an effect without a lane: its name, a word for what it is, Remove, and its own controls. */
function PlainCard({ name, unit, onRemove, children }: { name: string; unit: string; onRemove: () => void; children: ReactNode }) {
  return (
    <article className="mod-card" aria-label={name}>
      <div className="mod-card-head">
        <h3>{name}</h3>
        <span className="mod-unit">{unit}</span>
        <button type="button" className="icon-button small push" aria-label={`Remove ${name}`} title={`Remove ${name} from the mod`} onClick={onRemove}>
          <TrashIcon />
        </button>
      </div>
      <div className="mod-card-body">{children}</div>
    </article>
  );
}

interface CardProps<E> {
  readonly effect: E;
  readonly onChange: (effect: E, key?: string) => void;
  readonly onCommit: () => void;
  readonly onRemove: () => void;
}

/** Swap keeps its controls on a card (Magnus beslut). */
export function SwapCard({ effect, onChange, onCommit, onRemove }: CardProps<SwapEffect>) {
  return (
    <PlainCard name={TARGET_LABELS.swap} unit="hits" onRemove={onRemove}>
      <SwapSentence effect={effect} onChange={onChange} onCommit={onCommit} />
    </PlainCard>
  );
}

/** Tempo (slip) keeps its controls on a card (Magnus beslut). */
export function TempoCard({ effect, onChange, onCommit, onRemove }: CardProps<TempoEffect>) {
  return (
    <PlainCard name={TARGET_LABELS.tempo} unit="speed" onRemove={onRemove}>
      <TempoSentence effect={effect} onChange={onChange} onCommit={onCommit} />
    </PlainCard>
  );
}

/** Tape keeps its controls on a card (Magnus beslut). */
export function TapeCard({ effect, onChange, onCommit, onRemove }: CardProps<TapeEffect>) {
  return (
    <PlainCard name={TARGET_LABELS.tape} unit="audio" onRemove={onRemove}>
      <TapeSentence tape={effect} onChange={onChange} onCommit={onCommit} />
    </PlainCard>
  );
}
