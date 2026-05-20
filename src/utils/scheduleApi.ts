import { backendUrl } from '../services/backendOrigin';

export async function fetchSchedulesFromServer(): Promise<unknown[] | null> {
  try {
    const res = await fetch(backendUrl('/api/schedules'));
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.schedules) ? data.schedules : null;
  } catch {
    return null;
  }
}

export async function syncSchedulesToServer(schedules: unknown[]): Promise<boolean> {
  try {
    const res = await fetch(backendUrl('/api/schedules'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function setServerScheduleTimer(schedule: unknown): Promise<boolean> {
  try {
    const res = await fetch(backendUrl('/api/schedule/timer/set'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function cancelServerScheduleTimer(scheduleId: string): Promise<void> {
  try {
    await fetch(backendUrl('/api/schedule/timer/cancel'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId }),
    });
  } catch {
    /* ignore */
  }
}

export async function fetchConcurrency(): Promise<{
  limit: number;
  running: number;
  available: number;
} | null> {
  try {
    const res = await fetch(backendUrl('/api/concurrency'));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface ScheduleWorkerStats {
  total: number;
  running: number;
  done: number;
  error: number;
  waiting: number;
}

export async function fetchScheduleProgress(
  profileIds: string[],
): Promise<ScheduleWorkerStats | null> {
  if (!profileIds.length) return null;
  try {
    const qs = profileIds.map(encodeURIComponent).join(',');
    const res = await fetch(backendUrl(`/api/schedule/progress?profileIds=${qs}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data.stats ?? null;
  } catch {
    return null;
  }
}
