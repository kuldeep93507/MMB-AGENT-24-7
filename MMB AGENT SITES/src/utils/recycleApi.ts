/**
 * recycleApi.ts — 24/7 Recycle Loop API helpers for MMB AGENT SITES
 * Mirrors the YouTube tool's recycleApi but adapted for article reading.
 */

export interface RecycleSlotStatus {
  slotId: string;
  currentProfileId: string;
  profileName: string;
  status: 'running' | 'cooldown' | 'recreating' | 'queued' | 'error' | 'idle' | 'stopped';
  enabled: boolean;
  cooldownUntil: number | null;
  cycleCount: number;
  lastError: string | null;
  isPaused: boolean;
  videoCount?: number;
}

export interface RecycleStatus {
  enabled: boolean;
  isPaused: boolean;
  startedAt: number | null;
  cycleCount: number;
  slots: RecycleSlotStatus[];
}

const BASE = '/backend-api';

async function post(path: string, body?: unknown) {
  try {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function fetchRecycleStatus(): Promise<RecycleStatus | null> {
  try {
    const r = await fetch(BASE + '/api/recycle/status');
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function startRecycleLoop(
  slots: { profileId: string; profileName: string; articleCount: number }[],
  articles: { url: string; title: string }[] = [],
  provider?: string,
  cooldownMinutes?: number,
): Promise<boolean> {
  const d = await post('/api/recycle/start', { slots, articles, provider, cooldownMinutes });
  return !!(d?.success);
}

export async function stopRecycleLoop(): Promise<boolean> {
  const d = await post('/api/recycle/stop');
  return !!(d?.success);
}

export async function pauseRecycleLoop(): Promise<boolean> {
  const d = await post('/api/recycle/pause');
  return !!(d?.success);
}

export async function resumeRecycleLoop(): Promise<boolean> {
  const d = await post('/api/recycle/resume');
  return !!(d?.success);
}

export function recycleStatusLabel(status: string): string {
  const map: Record<string, string> = {
    running: '▶ Reading',
    cooldown: '⏳ Cooldown',
    recreating: '🔄 Recreating',
    queued: '⏸ Queued',
    error: '❌ Error',
    idle: '💤 Idle',
    stopped: '⏹ Stopped',
  };
  return map[status] || status;
}

export function formatCooldownRemaining(cooldownUntil: number, now: number): string {
  const ms = cooldownUntil - now;
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
