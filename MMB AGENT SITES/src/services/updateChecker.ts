/**
 * Auto Update Checker
 * - Checks GitHub for new version on startup
 * - Shows "Update Available" in UI
 * - One-click update via backend
 */

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/kuldeep93507/MMB-AGENT-24-7/main/version.json';
const LOCAL_VERSION_KEY = 'mmb_sites_current_version';

export interface VersionInfo {
  version: string;
  lastUpdate: string;
  changelog: string[];
}

export interface UpdateStatus {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  changelog: string[];
}

export function getCurrentVersion(): string {
  try {
    const stored = localStorage.getItem(LOCAL_VERSION_KEY);
    return stored || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const currentVersion = getCurrentVersion();

  try {
    const res = await fetch(GITHUB_RAW_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch version');

    const remote: VersionInfo = await res.json();
    const hasUpdate = remote.version !== currentVersion;

    return {
      hasUpdate,
      currentVersion,
      latestVersion: remote.version,
      changelog: remote.changelog,
    };
  } catch {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      changelog: [],
    };
  }
}

export async function runUpdate(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch('/backend-api/api/update/run', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem(LOCAL_VERSION_KEY, data.newVersion || '1.0.0');
    }
    return data;
  } catch (err: any) {
    return { success: false, message: 'Backend not running: ' + err.message };
  }
}

export function setCurrentVersion(version: string) {
  localStorage.setItem(LOCAL_VERSION_KEY, version);
}
