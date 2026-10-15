import { useState } from 'react';
import type { Id, Sample } from '../model';
import { DEFAULT_TAG_NAMES, MAX_TAGS, addTag, baseName, confirmTags, guessTags, removeTag, updateSample } from '../model';
import { classifyHit, peakLevel } from '../engine';
import { useApp, useOpen, useProject, useRun } from './context';
import { TAG_NAMES, tagColor } from './labels';
import { Waveform } from './Waveform';

type Filter = 'all' | 'untagged' | 'auto';

export function TagView() {
  const project = useProject();
  const { services } = useApp();
  const run = useRun();
  const [filter, setFilter] = useState<Filter>('all');
  const open = useOpen();
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tags = Object.values(project.tags);
  const samples = Object.values(project.samples);
  const untagged = samples.filter((s) => s.mainTag === null);
  const guessed = samples.filter((s) => s.tagGuessed);
  const shown = filter === 'all' ? samples : filter === 'untagged' ? untagged : guessed;

  /** Guesses for untagged samples; a slice is compared with the loudest hit of its break. */
  const guess = () => {
    const loudest = new Map<string, number>();
    const level = (sample: Sample) => {
      const source = (sample.sliceOf === null ? undefined : project.samples[sample.sliceOf]) ?? sample;
      if (!loudest.has(source.id)) {
        const audio = project.audio[source.audioId];
        loudest.set(source.id, audio === undefined ? 0 : peakLevel(audio, source.offset, source.duration));
      }
      return loudest.get(source.id)!;
    };
    setError(
      run(
        guessTags(
          untagged.map((s) => s.id),
          (s) => {
            const audio = project.audio[s.audioId];
            return audio === undefined ? null : classifyHit(audio, s.offset, s.duration, level(s));
          },
        ),
      ),
    );
  };

  /** Plays the sample's own default hit: the first hit made from it. */
  const play = (sample: Sample) => {
    const hit = Object.values(project.hits).find((h) => h.sampleId === sample.id && h.variantOf === null);
    if (hit !== undefined) services.player.playHit(project, hit.id);
  };

  const setMain = (sample: Sample, tagId: Id) =>
    run(
      updateSample(sample.id, {
        mainTag: sample.mainTag === tagId ? null : tagId,
        extraTags: sample.extraTags.filter((t) => t !== tagId),
      }),
    );

  const toggleExtra = (sample: Sample, tagId: Id) =>
    run(
      updateSample(sample.id, {
        extraTags: sample.extraTags.includes(tagId)
          ? sample.extraTags.filter((t) => t !== tagId)
          : [...sample.extraTags, tagId],
      }),
    );

  return (
    <main className="view wide">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>Tag</h1>
          <p className="muted">Give each sample a main tag. Mods use it; extra tags are only notes.</p>
        </div>
        <div className="row push">
          <div className="segmented" role="group" aria-label="Show">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All {samples.length}
            </button>
            <button type="button" aria-pressed={filter === 'untagged'} onClick={() => setFilter('untagged')}>
              Untagged {untagged.length}
            </button>
            <button type="button" aria-pressed={filter === 'auto'} onClick={() => setFilter('auto')}>
              Auto {guessed.length}
            </button>
          </div>
          <button type="button" disabled={untagged.length === 0} onClick={guess}>
            Guess tags
          </button>
          <button type="button" disabled={guessed.length === 0} onClick={() => setError(run(confirmTags(guessed.map((s) => s.id))))}>
            Confirm all auto
          </button>
        </div>
      </div>

      <div className="row">
        {tags.map((t) => (
          <span key={t.id} className="legend mono" style={{ color: tagColor(project, t.id) }}>
            {t.name} {TAG_NAMES[t.name] ?? ''}
            {!(DEFAULT_TAG_NAMES as readonly string[]).includes(t.name) && (
              <button type="button" className="legend-remove" aria-label={`Remove tag ${t.name}`} onClick={() => setError(run(removeTag(t.id)))}>
                ×
              </button>
            )}
          </span>
        ))}
        {tags.length < MAX_TAGS && (
          <form
            className="row add-tag"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newTag.trim();
              if (name === '') return;
              const failed = run(addTag(name));
              setError(failed);
              if (failed === null) setNewTag('');
            }}
          >
            <input aria-label="New tag" placeholder="New tag, e.g. P" maxLength={6} value={newTag} onChange={(e) => setNewTag(e.target.value)} />
            <button type="submit" className="small-button">
              + Add tag
            </button>
          </form>
        )}
      </div>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="muted">{samples.length === 0 ? 'Nothing imported yet.' : 'Every sample has a tag.'}</p>
      ) : (
        <div className="card-grid">
          {shown.map((sample) => {
            const name = baseName(sample.name);
            const audio = project.audio[sample.audioId];
            const color = tagColor(project, sample.mainTag);
            return (
              <div
                key={sample.id}
                className={`card${sample.mainTag === null ? ' attention' : ''}`}
                title="Double-click to edit the hit"
                onDoubleClick={(e) => {
                  // Buttons in the card keep their own clicks.
                  if ((e.target as HTMLElement).closest('button') !== null) return;
                  const hit = Object.values(project.hits).find((h) => h.sampleId === sample.id && h.variantOf === null);
                  if (hit !== undefined) open({ hit: hit.id }, 'hits');
                }}
              >
                <div className="row nowrap">
                  <button type="button" className="icon-button small" aria-label={`Play ${name}`} onClick={() => play(sample)}>
                    <PlayIcon />
                  </button>
                  <span className="mono grow ellipsis" title={sample.name}>
                    {name}
                  </span>
                  <span className={`badge${sample.mainTag === null ? ' warn' : sample.tagGuessed ? ' auto' : ''}`}>
                    {sample.mainTag === null ? 'untagged' : sample.tagGuessed ? 'auto' : 'tagged'}
                  </span>
                </div>
                {audio !== undefined && (
                  <div className="mini-wave">
                    <Waveform audio={audio} offset={sample.offset} duration={sample.duration} height={44} color={color} />
                  </div>
                )}
                <div className="tag-buttons" role="group" aria-label={`Main tag of ${name}`}>
                  {tags.map((t) => {
                    const on = sample.mainTag === t.id;
                    const c = tagColor(project, t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="tag-button mono"
                        aria-pressed={on}
                        aria-label={`${name}: ${TAG_NAMES[t.name] ?? t.name}`}
                        style={on ? { background: c, borderColor: c, color: '#15110A' } : { color: c }}
                        onClick={() => setMain(sample, t.id)}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
                <div className="row also">
                  <span className="muted small">Also</span>
                  {tags
                    .filter((t) => t.id !== sample.mainTag)
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="also-button mono"
                        aria-pressed={sample.extraTags.includes(t.id)}
                        aria-label={`${name} also ${TAG_NAMES[t.name] ?? t.name}`}
                        style={{ color: tagColor(project, t.id) }}
                        onClick={() => toggleExtra(sample, t.id)}
                      >
                        {t.name}
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

export function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}
