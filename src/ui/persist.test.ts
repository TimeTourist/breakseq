import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { addSample, createProject } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { BACKUP_KEEP } from './backups';
import { indexedDbBackups, indexedDbStorage } from './persist';

describe('indexedDbStorage', () => {
  it('loads nothing before the first save', async () => {
    expect(await indexedDbStorage(new IDBFactory()).load()).toBeNull();
  });

  it('saves and loads a project with its audio', async () => {
    const ctx = sequentialIds();
    const result = addSample({ name: 'Amen', audio: constantAudio(0.01, [0.25, -0.5]) })(createProject(), ctx);
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

describe('indexedDbBackups', () => {
  const withSample = (name: string, value: number, project = createProject()) => {
    const ctx = { newId: () => `${name}-${Math.random()}` };
    const result = addSample({ name, audio: constantAudio(0.01, [value, value]) })(project, ctx);
    if (!result.ok) throw new Error('addSample failed');
    return result.project;
  };
  const summary = { snapshot: null, breaks: 0, loops: 0, clips: 0 };
  const ids = () => {
    let n = 0;
    return () => `b-${++n}`;
  };

  it('keeps a project and gives it back with its audio, newest first', async () => {
    const backups = indexedDbBackups(new IDBFactory(), ids());
    const first = withSample('Amen', 0.25);
    const second = withSample('Think', -0.5, first);
    await backups.add(first, { ...summary, snapshot: 'One' }, 1000);
    await backups.add(second, summary, 2000);

    const list = await backups.list();
    expect(list.map((b) => [b.at, b.summary.snapshot])).toEqual([
      [2000, null],
      [1000, 'One'],
    ]);
    expect(await backups.restore(list[1]!.id)).toEqual(first);
    const restored = await backups.restore(list[0]!.id);
    expect(restored).toEqual(second);
    expect(Object.values(restored.audio).map((a) => a.channels[0]![0])).toEqual([0.25, -0.5]);
  });

  it('keeps the newest BACKUP_KEEP and the audio only while a backup uses it', async () => {
    const factory = new IDBFactory();
    const backups = indexedDbBackups(factory, ids());
    const old = withSample('Old', 0.1);
    await backups.add(old, summary, 0);
    const kept = withSample('Amen', 0.25);
    for (let i = 1; i <= BACKUP_KEEP; i++) await backups.add({ ...kept, song: { ...kept.song, bpm: 100 + i } }, summary, i);

    const list = await backups.list();
    expect(list).toHaveLength(BACKUP_KEEP);
    expect(list.at(-1)!.at).toBe(1);
    // Amen's audio is stored once for all twenty; Old's went with its backup.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = factory.open('breakseq');
      r.onsuccess = () => resolve(r.result);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const r = db.transaction('backup-audio').objectStore('backup-audio').getAllKeys();
      r.onsuccess = () => resolve(r.result);
    });
    expect(keys).toEqual(Object.keys(kept.audio));
  });

  it('does not keep the same project twice in a row', async () => {
    const backups = indexedDbBackups(new IDBFactory(), ids());
    const amen = withSample('Amen', 0.25);
    await backups.add(amen, summary, 1);
    await backups.add(amen, summary, 2);
    await backups.add(withSample('Think', 0.5, amen), summary, 3);
    await backups.add(amen, summary, 4);
    expect((await backups.list()).map((b) => b.at)).toEqual([4, 3, 1]);
  });

  it('shares the database with the autosave', async () => {
    const factory = new IDBFactory();
    const project = withSample('Amen', 0.25);
    await indexedDbStorage(factory).save(project);
    await indexedDbBackups(factory, ids()).add(project, summary, 1);
    expect(await indexedDbStorage(factory).load()).toEqual(project);
  });
});

describe('the database before backups', () => {
  it('keeps the autosaved project when backups are added to it', async () => {
    const factory = new IDBFactory();
    const ctx = sequentialIds();
    const result = addSample({ name: 'Amen', audio: constantAudio(0.01) })(createProject(), ctx);
    if (!result.ok) throw new Error('addSample failed');
    // Version 1, as it was: one store with the current project.
    await new Promise<void>((resolve) => {
      const r = factory.open('breakseq', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('projects');
      r.onsuccess = () => {
        const tx = r.result.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(result.project, 'current');
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
    });

    await indexedDbBackups(factory).add(result.project, { snapshot: null, breaks: 0, loops: 0, clips: 0 }, 1);
    expect(await indexedDbStorage(factory).load()).toEqual(result.project);
  });
});
