/**
 * Browser Provider API Service
 * Unified interface for all antidetect browser providers (MoreLogin, AdsPower, Multilogin)
 * Calls backend /api/profiles/* endpoints with ?provider= query param
 * Uses Vite proxy via /backend-api prefix
 */

const BASE_URL = '/backend-api';

// ============ INTERFACES ============

export interface StandardResponse<T = any> {
  code: number;       // 0 = success, negative = error
  message: string;    // Human-readable (max 256 chars)
  data: T | null;     // Payload on success, null on failure
}

export interface StandardProfile {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  debugPort: number | null;
  browserType: 'morelogin' | 'adspower' | 'multilogin';
}

export interface ProxyConfig {
  server: string;       // 1-253 chars
  port: number;         // 1-65535
  username?: string;    // 0-255 chars
  password?: string;    // 0-255 chars
  protocol: 'http' | 'socks5';
}

export interface CreateProfileOptions {
  name?: string;
  os?: 'windows' | 'macos' | 'android';
  proxy?: ProxyConfig | null;
  browserType?: 'chrome' | 'firefox';
}

export interface StartProfileData {
  profileId: string;
  cdpPort: number;
}

export interface ListProfilesData {
  profiles: StandardProfile[];
  total: number;
  page: number;
  pageSize: number;
}

export type BrowserProvider = 'morelogin' | 'adspower' | 'multilogin';

// "all" is a UI-only mode that aggregates profiles from every configured provider.
// It is NOT sent to the backend — the store fans out individual provider calls.
export type ProviderSelection = BrowserProvider | 'all';

export const ALL_PROVIDERS: BrowserProvider[] = ['morelogin', 'adspower', 'multilogin'];

// ============ API FUNCTIONS ============

/**
 * List profiles from the selected browser provider
 */
export async function listProfiles(
  provider: BrowserProvider,
  pageNo = 1,
  pageSize = 100
): Promise<StandardResponse<ListProfilesData>> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/profiles/list?provider=${encodeURIComponent(provider)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNo, pageSize }),
      }
    );
    return res.json();
  } catch (err: any) {
    return {
      code: -1,
      message: err.message || 'Network error while listing profiles',
      data: null,
    };
  }
}

/**
 * Create a new profile on the selected browser provider
 */
export async function createProfile(
  provider: BrowserProvider,
  options: CreateProfileOptions
): Promise<StandardResponse<{ profileId: string }>> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/profiles/create?provider=${encodeURIComponent(provider)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      }
    );
    return res.json();
  } catch (err: any) {
    return {
      code: -1,
      message: err.message || 'Network error while creating profile',
      data: null,
    };
  }
}

/**
 * Start a browser profile and get the CDP port for Playwright connection
 */
export async function startProfile(
  provider: BrowserProvider,
  profileId: string
): Promise<StandardResponse<StartProfileData>> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/profiles/start?provider=${encodeURIComponent(provider)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      }
    );
    return res.json();
  } catch (err: any) {
    return {
      code: -1,
      message: err.message || 'Network error while starting profile',
      data: null,
    };
  }
}

/**
 * Stop a running browser profile
 */
export async function stopProfile(
  provider: BrowserProvider,
  profileId: string
): Promise<StandardResponse<{ profileId: string }>> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/profiles/stop?provider=${encodeURIComponent(provider)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      }
    );
    return res.json();
  } catch (err: any) {
    return {
      code: -1,
      message: err.message || 'Network error while stopping profile',
      data: null,
    };
  }
}

/**
 * Delete a browser profile
 */
export async function deleteProfile(
  provider: BrowserProvider,
  profileId: string
): Promise<StandardResponse<{ profileId: string }>> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/profiles/delete?provider=${encodeURIComponent(provider)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      }
    );
    return res.json();
  } catch (err: any) {
    return {
      code: -1,
      message: err.message || 'Network error while deleting profile',
      data: null,
    };
  }
}

/**
 * List profiles from ALL configured providers in parallel and aggregate results.
 * Each profile retains its `browserType` so the caller knows which provider it
 * belongs to. Failed providers are reported via `errors` but do not abort the call.
 * 
 * Uses the server-side /api/profiles/list-all endpoint which handles all providers
 * in parallel with proper timeout handling.
 */
export async function listProfilesAll(
  pageNo = 1,
  pageSize = 100
): Promise<StandardResponse<ListProfilesData & { errors: { provider: BrowserProvider; message: string }[] }>> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/profiles/list-all`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNo, pageSize }),
      }
    );
    return res.json();
  } catch (err: any) {
    return {
      code: -1,
      message: err.message || 'Network error while listing all profiles',
      data: null,
    };
  }
}
