import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { addSample, createProject } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { indexedDbStorage } from './persist';

describe('indexedDbStorage', () => {
  it('loads nothing before the first save', async () => {
    expect(await indexedDbStorage(new IDBFactory()).load()).toBeNull();
  });

  it('saves and loads a project with its audio', async () => {
    const ctx = sequentialIds();
    const result = addSample({ name: 'Amen', audio: constantAudio(0.01, [0.25, -0.5]) })(createProject(ctx), ctx);
    if (!result.ok) throw new Error('addSample failed');
    const factory = new IDBFactory();

    await indexedDbStorage(factory).save(result.project);
    const loaded = await indexedDbStorage(factory).load();

    expect(loaded).toEqual(result.project);
    const audio = Object.values(loaded!.audio)[0]!;
    expect(audio.channels[1]).toBeInstanceOf(Float32Array);
    expect(audio.channels[1]![0]).toBe(-0.5);
  });
});
