import { backendUrl, getAuthHeaders, storeApiToken } from '../services/backendOrigin';
import type { ProviderSelection } from '../services/browserProviderApi';

export type ProxyLifeSetting = '1hr' | '2hr' | '4hr' | '8hr' | '24hr';

export interface AppSettings {
  moreloginBaseUrl: string;
  moreloginApiKey: string;
  moreloginSecurityEnabled: boolean;
  moreloginPort: string;
  multiloginEmail: string;
  multiloginPassword: string;
  multiloginToken: string;
  multiloginFolderId: string;
  proxyServer: string;
  proxyPort: string;
  proxyPassword: string;
  proxyPrefix: string;
  defaultProxyLife: ProxyLifeSetting;
  maxConcurrent: string;
  multiloginMaxConcurrent: string;
  multiloginBatchGapMs: string;
  browserProvider: ProviderSelection;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  moreloginBaseUrl: 'http://127.0.0.1:40000',
  moreloginApiKey: '',
  moreloginSecurityEnabled: true,
  moreloginPort: '40000',
  multiloginEmail: '',
  multiloginPassword: '',
  multiloginToken: '',
  multiloginFolderId: '',
  proxyServer: 'us.smartproxy.net',
  proxyPort: '3120',
  proxyPassword: '',
  proxyPrefix: '',
  defaultProxyLife: '4hr',
  maxConcurrent: '5',
  multiloginMaxConcurrent: '3',
  multiloginBatchGapMs: '45000',
  browserProvider: 'multilogin',
};

const STORAGE_KEY = 'mmb_yt_settings';

export function loadSettingsLocal(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveSettingsLocal(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function getProxyConfigFromSettings(): Pick<
  AppSettings,
  'proxyServer' | 'proxyPort' | 'proxyPassword' | 'proxyPrefix' | 'defaultProxyLife'
> {
  return loadSettingsLocal();
}

export async function fetchSettingsFromServer(): Promise<AppSettings | null> {
  try {
    const res = await fetch(backendUrl('/api/settings'));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || !data.settings) return null;
    if (typeof data.apiToken === 'string' && data.apiToken) storeApiToken(data.apiToken);
    return { ...DEFAULT_APP_SETTINGS, ...data.settings };
  } catch {
    return null;
  }
}

export async function saveSettingsToServer(settings: AppSettings): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(backendUrl('/api/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (!data.success) return { success: false, error: data.error || 'Save failed' };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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

export async function testMoreLoginConnection(settings: Pick<AppSettings, 'moreloginBaseUrl' | 'moreloginApiKey' | 'moreloginSecurityEnabled'>): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(backendUrl('/api/settings/test/morelogin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function testMultiloginConnection(
  settings?: Pick<AppSettings, 'multiloginEmail' | 'multiloginPassword' | 'multiloginToken' | 'multiloginFolderId'>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(backendUrl('/api/settings/test/multilogin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings || {}),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function exportSettingsJson(settings: AppSettings): void {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mmb-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseSettingsImport(text: string): AppSettings {
  const data = JSON.parse(text);
  const s = data.settings || data;
  return { ...DEFAULT_APP_SETTINGS, ...s };
}
