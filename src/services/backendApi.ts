/**
 * Backend API Service
 * Connects frontend to the automation backend (http://localhost:3100)
 */

import { backendUrl } from "./backendOrigin";

export interface AgentStatus {
  profileId: string;
  profileName: string;
  status: string;
  currentVideo: string | null;
  logs: { time: string; level: string; message: string; profileId: string }[];
}

export interface ScheduleRunResult {
  success: boolean;
  scheduleId?: string;
  message?: string;
  workersSpawned?: number;
}

/**
 * Health check
 */
export async function getHealth(): Promise<{ status: string; agents: number; schedules: number; workers?: any }> {
  const res = await fetch(backendUrl(`/api/health`));
  return res.json();
}

/**
 * Get all active agent statuses
 */
export async function getAgents(): Promise<{ agents: AgentStatus[] }> {
  const res = await fetch(backendUrl(`/api/agents`));
  return res.json();
}

/**
 * Get specific agent status
 */
export async function getAgentStatus(profileId: string): Promise<AgentStatus> {
  const res = await fetch(backendUrl(`/api/agents/${profileId}`));
  return res.json();
}

/**
 * Run a schedule — starts all profile agents
 */
export async function runSchedule(schedule: any): Promise<ScheduleRunResult> {
  const res = await fetch(backendUrl(`/api/schedule/run`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedule }),
  });
  return res.json();
}

/**
 * Stop a running schedule
 */
export async function stopSchedule(scheduleId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(backendUrl(`/api/schedule/stop`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduleId }),
  });
  return res.json();
}

// --- Full Profile Creation ---

export interface CreateFullProfileOptions {
  name?: string;
  os: 'Windows' | 'macOS' | 'Android';
  browserType: 'morelogin' | 'multilogin';
  proxyLife?: '1hr' | '2hr' | '4hr' | '8hr' | '24hr';
  cookies?: Array<{ name: string; value: string; domain: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean }>;
  groupId?: string;
  // BUG FIX: Configure fingerprints to appear as real YouTube users (not masked bots)
  fingerprintConfig?: {
    canvas?: 'real' | 'masked';      // Real = disabled masking, Masked = masked (default)
    webrtc?: 'real' | 'masked';      // Real = natural, Masked = masked (default)
    timezone?: 'real' | 'masked';    // Real = synced with proxy, Masked = random
    screen?: 'real' | 'masked';      // Real = actual resolution, Masked = random
    navigator?: 'real' | 'masked';   // Real = actual user agent, Masked = random
  };
}

export interface CreateFullProfileResult {
  code: number;
  message: string;
  data: {
    id: string;
    name: string;
    os: string;
    browserType: string;
    proxy: any;
    fingerprint: any;
    cookiesImported: boolean;
  } | null;
}

export interface RecreateProfileResult {
  code: number;
  message: string;
  data: {
    oldProfileId: string;
    newProfileId: string;
    newProxy: any;
    newFingerprint: any;
  } | null;
}

/**
 * Create a full profile with fingerprint, proxy, and optional cookies
 */
export async function createFullProfile(options: CreateFullProfileOptions): Promise<CreateFullProfileResult> {
  const res = await fetch(backendUrl(`/api/profiles/create-full`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  const data = await res.json();

  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    throw new Error(data.message || `Profile creation failed (HTTP ${res.status})`);
  }

  return data;
}

/**
 * Recreate a profile — deletes the old one and creates a fresh replacement
 */
export async function recreateProfile(
  profileId: string,
  browserType: 'morelogin' | 'multilogin',
  cookies?: Array<{ name: string; value: string; domain: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean }>
): Promise<RecreateProfileResult> {
  const res = await fetch(backendUrl(`/api/profiles/recreate`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, browserType, cookies }),
  });

  const data = await res.json();

  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    throw new Error(data.message || `Profile recreation failed (HTTP ${res.status})`);
  }

  return data;
}
