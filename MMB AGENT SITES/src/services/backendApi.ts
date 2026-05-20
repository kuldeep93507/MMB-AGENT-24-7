/**
 * Backend API Service
 * Connects frontend to the Sites automation backend (http://localhost:3200)
 */

const BACKEND_URL = '/backend-api';

export interface AgentStatus {
  profileId: string;
  profileName: string;
  status: string;
  currentArticle: string | null;
  logs: { time: string; level: string; message: string; profileId: string }[];
}

export interface ScheduleRunResult {
  success: boolean;
  scheduleId: string;
  message: string;
  profiles: { profileId: string; delay: number; status: string }[];
}

export async function getHealth(): Promise<{ status: string; agents: number }> {
  const res = await fetch(`${BACKEND_URL}/health`);
  return res.json();
}

export async function getAgents(): Promise<Record<string, AgentStatus>> {
  const res = await fetch(`${BACKEND_URL}/status`);
  return res.json();
}

export async function getLogs(): Promise<any[]> {
  const res = await fetch(`${BACKEND_URL}/logs`);
  return res.json();
}

export async function startAgent(profileId: string, envId: string, articles: any[], settings: any): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BACKEND_URL}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, envId, articles, settings }),
  });
  return res.json();
}

export async function stopAgent(profileId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BACKEND_URL}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId }),
  });
  return res.json();
}

export async function stopAll(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BACKEND_URL}/stop-all`, { method: 'POST' });
  return res.json();
}

export async function runSchedule(schedule: any): Promise<ScheduleRunResult> {
  const res = await fetch(`${BACKEND_URL}/api/scheduler/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(schedule),
  });
  return res.json();
}

export async function getAnalytics(): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/api/analytics`);
  return res.json();
}

export async function manualBatch(profileIds: string[], command: string, params?: any): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/api/manual/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileIds, command, params }),
  });
  return res.json();
}

export async function manualStart(profileIds: string[]): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/api/manual/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileIds }),
  });
  return res.json();
}
