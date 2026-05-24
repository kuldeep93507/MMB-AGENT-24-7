/**
 * MoreLogin Local API Service
 * Base URL: http://127.0.0.1:40000
 * Uses Vite proxy at /morelogin-api to avoid CORS
 */

const BASE_URL = '/morelogin-api';
const API_KEY = import.meta.env.VITE_MORELOGIN_API_KEY ?? '';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
}

export interface MoreLoginProfile {
  id: string;
  envName: string;
  groupId: number;
  proxyId: number;
  proxy?: {
    username?: string;
    password?: string;
    proxyIp?: string;
    exportIp?: string;
  };
}

export interface MoreLoginStartResult {
  envId: string;
  debugPort: string;
  webdriver?: string;
}

export interface MoreLoginStatusResult {
  envId: string;
  status: 'running' | 'stopped';
  localStatus: 'running' | 'stopped';
  debugPort?: string;
  webdriver?: string;
}

export interface MoreLoginPageResponse {
  current: number;
  dataList: MoreLoginProfile[];
  pages: number;
  total: number;
}

export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
  requestId?: string;
}

export async function getProfiles(pageNo = 1, pageSize = 100): Promise<ApiResponse<MoreLoginPageResponse>> {
  const res = await fetch(`${BASE_URL}/api/env/page`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ pageNo, pageSize }),
  });
  return res.json();
}

export async function getProfileStatus(envId: string): Promise<ApiResponse<MoreLoginStatusResult>> {
  const res = await fetch(`${BASE_URL}/api/env/status`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ envId }),
  });
  return res.json();
}

export async function startBrowserProfile(envId: string, options?: { isHeadless?: boolean }): Promise<ApiResponse<MoreLoginStartResult>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${BASE_URL}/api/env/start`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ envId, ...options }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { code: -1, msg: 'Request timeout — profile may still be starting. Check status.', data: { envId, debugPort: '' } as any, requestId: '' };
    }
    throw err;
  }
}

export async function stopBrowserProfile(envId: string): Promise<ApiResponse<{ envId: string }>> {
  const res = await fetch(`${BASE_URL}/api/env/close`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ envId }),
  });
  return res.json();
}

export async function quickCreateProfile(params: {
  browserTypeId: number;
  operatorSystemId: number;
  quantity: number;
  groupId?: number;
}): Promise<ApiResponse<string[]>> {
  const res = await fetch(`${BASE_URL}/api/env/create/quick`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function deleteProfiles(envIds: string[], removeEnvData = true): Promise<ApiResponse<boolean>> {
  const res = await fetch(`${BASE_URL}/api/env/removeToRecycleBin/batch`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ envIds, removeEnvData }),
  });
  return res.json();
}

export async function refreshFingerprint(envId: string): Promise<ApiResponse<string>> {
  const res = await fetch(`${BASE_URL}/api/env/fingerprint/refresh`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ envId }),
  });
  return res.json();
}
