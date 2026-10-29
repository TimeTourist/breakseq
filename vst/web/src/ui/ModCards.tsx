import type { ReactNode } from 'react';
import type { HalftimeEffect, SwapEffect, TapeEffect, TempoEffect } from '../model';
import { HALFTIME_SPEEDS } from '../model';
import { GATE_SOURCE_NOTE, SOURCE_NOTE, SOURCE_TITLE, halftimeSentence, speedText } from './audioText';
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

/** The line on every audio mod's card: what it samples. */
export function SourceNote({ gate = false }: { gate?: boolean }) {
  return (
    <p className="mod-card-source" title={gate ? undefined : SOURCE_TITLE}>
      {gate ? GATE_SOURCE_NOTE : SOURCE_NOTE}
    </p>
  );
}

/** A row of choices, as on the cards: a label and buttons, the chosen one pressed. */
export function Choices<T extends string | number | boolean>({
  label,
  options,
  value,
  onPick,
  titles,
}: {
  readonly label: string;
  readonly options: readonly (readonly [T, string])[];
  readonly value: T | undefined;
  readonly onPick: (v: T) => void;
  readonly titles?: Partial<Record<string, string>>;
}) {
  return (
    <div className="lane-extra">
      <span className="lane-extra-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} title={titles?.[String(v)]} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Halftime has no lane: it plays the whole clip at its speed (see Mods som samplar det som hörs). */
export function HalftimeCard({ effect, onChange, onRemove }: CardProps<HalftimeEffect>) {
  return (
    <article className="mod-card" aria-label="Halftime">
      <div className="mod-card-head">
        <h3>Halftime</h3>
        <span className="mod-unit">no lane</span>
        <button type="button" className="icon-button small push" aria-label="Remove Halftime" title="Remove Halftime from the mod" onClick={onRemove}>
          <TrashIcon />
        </button>
      </div>
      <p className="mod-card-sentence" aria-live="polite">
        {halftimeSentence(effect)}
      </p>
      <SourceNote />
      <div className="mod-card-controls">
        <Choices
          label="Speed"
          options={HALFTIME_SPEEDS.map((v) => [v, speedText(v)] as const)}
          value={effect.speed}
          onPick={(speed) => onChange({ ...effect, speed })}
          titles={{ '0.5': 'Half speed: an octave down unless the pitch is kept', '0.75': 'Three quarters speed', '2': 'Double speed: an octave up unless the pitch is kept' }}
        />
        <Choices
          label="Keep pitch (stretch, off by default)"
          options={
            [
              [false, 'Off'],
              [true, 'On'],
            ] as const
          }
          value={effect.keepPitch}
          onPick={(keepPitch) => onChange({ ...effect, keepPitch })}
          titles={{ false: 'The pitch follows the speed, like a record', true: 'The pitch stays: stretched in short grains' }}
        />
      </div>
    </article>
  );
}
