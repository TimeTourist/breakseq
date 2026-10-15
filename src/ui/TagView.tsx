import { useState } from 'react';
import type { Id, Sample } from '../model';
import { baseName, updateSample } from '../model';
import { useApp, useProject, useRun } from './context';
import { TAG_NAMES, tagColor } from './labels';
import { Waveform } from './Waveform';

type Filter = 'all' | 'untagged';

export function TagView() {
  const project = useProject();
  const { services } = useApp();
  const run = useRun();
  const [filter, setFilter] = useState<Filter>('all');
  const tags = Object.values(project.tags);
  const samples = Object.values(project.samples);
  const untagged = samples.filter((s) => s.mainTag === null);
  const shown = filter === 'all' ? samples : untagged;

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
        <div className="segmented push" role="group" aria-label="Show">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All {samples.length}
          </button>
          <button type="button" aria-pressed={filter === 'untagged'} onClick={() => setFilter('untagged')}>
            Untagged {untagged.length}
          </button>
        </div>
      </div>

      <div className="row">
        {tags.map((t) => (
          <span key={t.id} className="legend mono" style={{ color: tagColor(project, t.id) }}>
            {t.name} {TAG_NAMES[t.name] ?? ''}
          </span>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">{samples.length === 0 ? 'Nothing imported yet.' : 'Every sample has a tag.'}</p>
      ) : (
        <div className="card-grid">
          {shown.map((sample) => {
            const name = baseName(sample.name);
            const audio = project.audio[sample.audioId];
            const color = tagColor(project, sample.mainTag);
            return (
              <div key={sample.id} className={`card${sample.mainTag === null ? ' attention' : ''}`}>
                <div className="row nowrap">
                  <button type="button" className="icon-button small" aria-label={`Play ${name}`} onClick={() => play(sample)}>
                    <PlayIcon />
                  </button>
                  <span className="mono grow ellipsis" title={sample.name}>
                    {name}
                  </span>
                  <span className={`badge${sample.mainTag === null ? ' warn' : ''}`}>
                    {sample.mainTag === null ? 'untagged' : 'tagged'}
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
