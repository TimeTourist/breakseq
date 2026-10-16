import { describe, expect, it } from 'vitest';
import { createProject } from '../model';
import { BACKUP_EVERY_MS, backupDue, backupTime, summarize, summaryText } from './backups';

describe('backups', () => {
  it('is due at the first save, then BACKUP_EVERY_MS after the last', () => {
    expect(backupDue(null, 0)).toBe(true);
    expect(backupDue(1000, 1000 + BACKUP_EVERY_MS - 1)).toBe(false);
    expect(backupDue(1000, 1000 + BACKUP_EVERY_MS)).toBe(true);
  });

  it('sums up a project by its active snapshot, breaks, loops and clips', () => {
    const summary = summarize(createProject(), 'Groove');
    expect(summary).toEqual({ snapshot: 'Groove', breaks: 0, loops: 0, clips: 0 });
    expect(summaryText({ snapshot: null, breaks: 1, loops: 3, clips: 8 })).toBe('1 break · 3 loops · 8 clips');
  });

  it('tells the time and how long ago, with the date on an earlier day', () => {
    const at = new Date(2026, 9, 16, 14, 32).getTime();
    expect(backupTime(at, at + 12 * 60_000)).toBe('14:32, 12 min ago');
    expect(backupTime(at, at + 20_000)).toBe('14:32, just now');
    expect(backupTime(at, at + 2 * 3_600_000)).toBe('14:32, 2 hours ago');
    expect(backupTime(at, new Date(2026, 9, 17, 15, 0).getTime())).toBe('2026-10-16 14:32, 1 day ago');
  });
});
