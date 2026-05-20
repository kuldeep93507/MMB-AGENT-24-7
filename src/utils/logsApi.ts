import { backendUrl } from '../services/backendOrigin';
import type { LogEntry, LogLevel, LogSource } from '../types';

export interface FetchLogsParams {
  limit?: number;
  since?: number;
  level?: LogLevel | 'all';
  source?: LogSource | 'all';
  profileId?: string;
  search?: string;
}

export async function fetchActivityLogs(params: FetchLogsParams = {}): Promise<{ entries: LogEntry[]; total: number }> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.since) q.set('since', String(params.since));
  if (params.level && params.level !== 'all') q.set('level', params.level);
  if (params.source && params.source !== 'all') q.set('source', params.source);
  if (params.profileId) q.set('profileId', params.profileId);
  if (params.search) q.set('search', params.search);

  const url = backendUrl(`/api/logs${q.toString() ? `?${q}` : ''}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Logs API ${res.status}`);
  return res.json();
}

export async function postActivityLog(
  level: LogLevel,
  message: string,
  opts?: { profileId?: string; profileName?: string; source?: LogSource; id?: string },
): Promise<void> {
  try {
    await fetch(backendUrl('/api/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        message,
        profileId: opts?.profileId,
        profileName: opts?.profileName,
        source: opts?.source || 'profile',
        id: opts?.id,
        timestamp: Date.now(),
      }),
    });
  } catch {
    /* offline — local-only fallback handled by caller */
  }
}

export async function clearActivityLogs(): Promise<boolean> {
  try {
    const res = await fetch(backendUrl('/api/logs'), { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export const LOG_SOURCE_LABELS: Record<LogSource, string> = {
  profile: 'Profile',
  worker: 'Worker',
  scheduler: 'Scheduler',
  shuffle: 'Shuffle',
  backlink: 'Backlink',
  manual: 'Manual',
  settings: 'Settings',
  system: 'System',
};
