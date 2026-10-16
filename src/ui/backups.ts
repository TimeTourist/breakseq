import type { Project } from '../model';

/** How many backups of the autosave are kept. */
export const BACKUP_KEEP = 20;
/** At most one backup this often while the project changes, after the one made at load. */
export const BACKUP_EVERY_MS = 5 * 60 * 1000;

/** What a backup shows, to tell it from the others. */
export interface BackupSummary {
  /** The snapshot that was active when it was made. */
  readonly snapshot: string | null;
  readonly breaks: number;
  readonly loops: number;
  readonly clips: number;
}

export interface BackupInfo {
  readonly id: string;
  /** When it was made, ms since the epoch. */
  readonly at: number;
  readonly summary: BackupSummary;
}

/** Where backups of the autosave are kept. */
export interface BackupStorage {
  /** Newest first. */
  readonly list: () => Promise<BackupInfo[]>;
  /** Keeps a backup, unless the newest has the same project, and drops the oldest past BACKUP_KEEP. */
  readonly add: (project: Project, summary: BackupSummary, at: number) => Promise<void>;
  readonly restore: (id: string) => Promise<Project>;
}

export const summarize = (project: Project, snapshot: string | null): BackupSummary => ({
  snapshot,
  breaks: Object.keys(project.breaks).length,
  loops: Object.keys(project.loops).length,
  clips: project.song.clips.length,
});

/** Whether a change saved at `now` is also due a backup: none yet this session, or the last one BACKUP_EVERY_MS ago. */
export const backupDue = (last: number | null, now: number): boolean => last === null || now - last >= BACKUP_EVERY_MS;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 breaks · 3 loops · 8 clips". */
export const summaryText = (s: BackupSummary): string => [plural(s.breaks, 'break'), plural(s.loops, 'loop'), plural(s.clips, 'clip')].join(' · ');

/** "14:32, 12 min ago"; on an earlier day the date goes first: "2026-10-15 14:32, 1 day ago". */
export function backupTime(at: number, now: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now).toDateString() === d.toDateString();
  const time = today ? clock : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  const ago =
    minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 24 * 60 ? `${plural(Math.floor(minutes / 60), 'hour')} ago` : `${plural(Math.floor(minutes / (24 * 60)), 'day')} ago`;
  return `${time}, ${ago}`;
}
