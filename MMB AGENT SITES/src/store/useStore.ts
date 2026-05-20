import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile, Job, LogEntry, OS, TaskType, ProfileSiteSettings, ReadHistory, RateLimitConfig } from '../types';
import * as moreloginApi from '../services/moreloginApi';
import {
  listProfiles as listProviderProfiles,
  listProfilesAll,
  startProfile as startProviderProfile,
  stopProfile as stopProviderProfile,
  deleteProfile as deleteProviderProfile,
  createProfile as createProviderProfile,
  type BrowserProvider,
  type ProviderSelection,
} from '../services/browserProviderApi';

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function osToOsId(os: OS): number {
  switch (os) {
    case 'Windows': return 1;
    case 'macOS': return 2;
    case 'Android': return 3;
    default: return 1;
  }
}

function detectOS(envName: string): OS {
  const lower = envName.toLowerCase();
  if (lower.includes('android')) return 'Android';
  if (lower.includes('mac') || lower.includes('ios')) return 'macOS';
  return 'Windows';
}

function parseProxyState(username: string): { state: string; city: string } {
  let state = 'US';
  let city = 'Unknown';
  const stateMatch = username.match(/state-([^_]+)/);
  const cityMatch = username.match(/city-([^_]+)/);
  if (stateMatch) state = stateMatch[1].replace(/-/g, ' ');
  if (cityMatch) city = cityMatch[1].replace(/-/g, ' ');
  return { state, city };
}

function generateDefaultFingerprint(os: OS) {
  const base = {
    timezone: 'America/New_York',
    language: 'en-US',
    resolution: '1920x1080',
    webGL: 'ANGLE (Intel HD Graphics)',
    canvas: 'canvas_' + genId(),
    audioContext: 'audio_' + genId(),
    cpu: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
    ram: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
    webRTC: 'disabled',
    geolocation: { lat: 34.05 + Math.random() * 10, lng: -118.24 + Math.random() * 10 },
    battery: Math.floor(Math.random() * 60) + 40,
  };

  if (os === 'Windows') {
    return { ...base, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
  } else if (os === 'macOS') {
    return { ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', macOsVersion: '14.0' };
  } else {
    return { ...base, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', deviceModel: 'Pixel 7', androidVersion: '13', resolution: '1080x2400' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ZUSTAND STORE — Global State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface StoreState {
  profiles: Profile[];
  jobs: Job[];
  logs: LogEntry[];
  activeTab: string;
  profileSettings: ProfileSiteSettings[];
  readHistory: ReadHistory[];
  rateLimits: RateLimitConfig[];
  loading: boolean;
  browserProvider: ProviderSelection;

  // Actions
  setActiveTab: (tab: string) => void;
  setBrowserProvider: (provider: ProviderSelection) => Promise<void>;
  fetchProfiles: () => Promise<void>;
  createProfile: (os: OS) => Promise<void>;
  startProfile: (profileId: string) => Promise<void>;
  stopProfile: (profileId: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  recreateProfile: (profileId: string) => Promise<void>;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  startSelected: () => void;
  stopSelected: () => void;
  addJob: (profileId: string, taskType: TaskType, details?: string) => void;
  retryJob: (id: string) => void;
  clearLogs: () => void;
  clearLogsByLevel: (level: LogEntry['level']) => void;
  renewProxy: (profileId: string) => void;
  addReadHistory: (entry: Omit<ReadHistory, 'id'>) => void;
  updateProfileSettings: (profileId: string, updates: Partial<ProfileSiteSettings>) => void;
  updateRateLimit: (profileId: string, updates: Partial<RateLimitConfig>) => void;
  addLog: (level: LogEntry['level'], message: string, profileId?: string, profileName?: string) => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      profiles: [],
      jobs: [],
      logs: [],
      activeTab: 'dashboard',
      profileSettings: [],
      readHistory: [],
      rateLimits: [],
      loading: false,
      browserProvider: (() => {
        try {
          const stored = localStorage.getItem('mmb_browser_provider');
          if (stored === 'morelogin' || stored === 'adspower' || stored === 'multilogin' || stored === 'all') {
            return stored;
          }
        } catch {}
        return 'morelogin' as ProviderSelection;
      })(),

      setActiveTab: (tab) => set({ activeTab: tab }),

      // ============ SET BROWSER PROVIDER ============
      setBrowserProvider: async (provider) => {
        set({ browserProvider: provider, profiles: [], loading: true });
        try { localStorage.setItem('mmb_browser_provider', provider); } catch {}
        await get().fetchProfiles();
      },

      addLog: (level, message, profileId?, profileName?) => {
        const entry: LogEntry = { id: genId(), level, message, timestamp: Date.now(), profileId, profileName };
        set((state) => ({ logs: [entry, ...state.logs].slice(0, 500) }));
      },

      // ============ FETCH PROFILES FROM BROWSER PROVIDER ============
      fetchProfiles: async () => {
        const provider = get().browserProvider;
        set({ loading: true });
        try {
          const res = provider === 'all'
            ? await listProfilesAll(1, 100)
            : await listProviderProfiles(provider, 1, 100);

          if (res.code === 0 && res.data) {
            const mapped: Profile[] = res.data.profiles.map((sp) => {
              const osRaw = (sp as any).osName || (sp as any).os || '';
              const os: OS = osRaw.toLowerCase().includes('android') ? 'Android'
                : osRaw.toLowerCase().includes('mac') || osRaw.toLowerCase().includes('ios') ? 'macOS'
                : 'Windows';
              return {
                id: sp.id,
                name: sp.name,
                os,
                status: sp.status === 'running' ? 'running' as const : 'stopped' as const,
                proxy: {
                  server: 'us.smartproxy.net',
                  port: 3120,
                  username: '',
                  password: '',
                  state: 'US',
                  city: 'Unknown',
                  life: '24hr' as const,
                  sessionId: genId(),
                  assignedAt: Date.now(),
                  expiresAt: Date.now() + 86400000,
                },
                fingerprint: generateDefaultFingerprint(os),
                currentAction: sp.status === 'running' ? 'Active' : 'Idle',
                createdAt: Date.now(),
                selected: false,
                envId: sp.id,
                ip: sp.debugPort ? `debug:${sp.debugPort}` : undefined,
                // Track which provider this profile belongs to
                browserType: sp.browserType,
              };
            });

            // Surface per-provider errors when in "all" mode
            if (provider === 'all' && 'errors' in res.data && Array.isArray((res.data as any).errors)) {
              for (const e of (res.data as any).errors as Array<{ provider: string; message: string }>) {
                get().addLog('warn', `${e.provider}: ${e.message}`);
              }
            }

            // Ensure profile settings + rate limits exist for each profile
            const { profileSettings, rateLimits } = get();
            const existingSettingsIds = new Set(profileSettings.map(s => s.profileId));
            const existingRateLimitIds = new Set(rateLimits.map(r => r.profileId));

            const newSettings = mapped
              .filter(p => !existingSettingsIds.has(p.id))
              .map(p => ({
                profileId: p.id,
                readTimeMin: 30,
                readTimeMax: 300,
                scrollSpeed: 'medium' as const,
                trafficPreference: 'random' as const,
                commentEnabled: false,
                commentDailyCap: 3,
                adPauseDurationMin: 0.5,
                adPauseDurationMax: 2,
                startDelayMin: 5,
                startDelayMax: 30,
                sessionLimit: 7,
              }));

            const newLimits = mapped
              .filter(p => !existingRateLimitIds.has(p.id))
              .map(p => ({
                profileId: p.id,
                dailyReadCap: 20,
                dailyCommentCap: 5,
                sessionCooldownMin: 240,
                readsToday: 0,
                commentsToday: 0,
                lastResetAt: Date.now(),
              }));

            set({
              profiles: mapped,
              profileSettings: [...profileSettings, ...newSettings],
              rateLimits: [...rateLimits, ...newLimits],
              loading: false,
            });

            get().addLog('success', `Fetched ${mapped.length} profiles from ${provider}`);
          } else {
            get().addLog('error', `${provider} API error: ${res.message || 'Unknown'} (code: ${res.code})`);
            set({ loading: false });
          }
        } catch (err: any) {
          get().addLog('error', `Failed to fetch profiles from ${provider}: ${err.message}`);
          set({ profiles: [], loading: false });
        }
      },

      // ============ CREATE PROFILE — routes via the active provider ============
      createProfile: async (os) => {
        const current = get().browserProvider;
        const provider: BrowserProvider = current === 'all' ? 'morelogin' : current;
        get().addLog('info', `Creating new ${os} profile via ${provider}...`);
        try {
          if (provider === 'morelogin') {
            const res = await moreloginApi.quickCreateProfile({
              browserTypeId: 1,
              operatorSystemId: osToOsId(os),
              quantity: 1,
            });
            if (res.code === 0 && res.data?.length > 0) {
              get().addLog('success', `Profile created via MoreLogin: ${res.data[0]}`);
              await get().fetchProfiles();
            } else {
              get().addLog('error', `Create failed: ${res.msg || 'Unknown'}`);
            }
            return;
          }

          // AdsPower / Multilogin
          const osLower = os.toLowerCase() as 'windows' | 'macos' | 'android';
          const res = await createProviderProfile(provider, {
            name: `Profile-${Date.now().toString(36)}`,
            os: osLower,
          });
          if (res.code === 0 && res.data) {
            const newId = (res.data as { profileId?: string; id?: string }).profileId
              || (res.data as { profileId?: string; id?: string }).id
              || 'unknown';
            get().addLog('success', `Profile created via ${provider}: ${newId}`);
            await get().fetchProfiles();
          } else {
            get().addLog('error', `Create failed (${provider}): ${res.message || 'Unknown'}`);
          }
        } catch (err: any) {
          get().addLog('error', `Create error: ${err.message}`);
        }
      },

      // ============ START PROFILE — routes via the profile's provider ============
      startProfile: async (profileId) => {
        const profile = get().profiles.find(p => p.id === profileId);
        if (!profile) return;

        const current = get().browserProvider;
        const provider: BrowserProvider = profile.browserType
          || (current === 'all' ? 'morelogin' : current);

        set((state) => ({
          profiles: state.profiles.map(p => p.id === profileId
            ? { ...p, status: 'starting' as const, currentAction: 'Connecting...' } : p)
        }));
        get().addLog('info', `Starting "${profile.name}" via ${provider}...`, profileId, profile.name);

        try {
          const res = await startProviderProfile(provider, profileId);
          if (res.code === 0 && res.data?.cdpPort) {
            set((state) => ({
              profiles: state.profiles.map(p => p.id === profileId
                ? { ...p, status: 'running' as const, currentAction: 'Active', ip: `debug:${res.data!.cdpPort}` } : p)
            }));
            get().addLog('success', `"${profile.name}" started (${provider}). CDP port: ${res.data.cdpPort}`, profileId, profile.name);
          } else if (provider === 'morelogin') {
            // MoreLogin sometimes times out — fall back to legacy status polling
            get().addLog('warn', `Start timed out — polling...`, profileId, profile.name);
            await new Promise(r => setTimeout(r, 5000));
            const statusRes = await moreloginApi.getProfileStatus(profileId);
            if (statusRes.code === 0 && statusRes.data?.status === 'running') {
              set((state) => ({
                profiles: state.profiles.map(p => p.id === profileId
                  ? { ...p, status: 'running' as const, currentAction: 'Active', ip: `debug:${statusRes.data.debugPort}` } : p)
              }));
              get().addLog('success', `"${profile.name}" running.`, profileId, profile.name);
            } else {
              set((state) => ({
                profiles: state.profiles.map(p => p.id === profileId
                  ? { ...p, status: 'error' as const, currentAction: 'Start failed' } : p)
              }));
              get().addLog('error', `Start failed: ${res.message || 'Unknown'}`, profileId, profile.name);
            }
          } else {
            set((state) => ({
              profiles: state.profiles.map(p => p.id === profileId
                ? { ...p, status: 'error' as const, currentAction: 'Start failed' } : p)
            }));
            get().addLog('error', `Start failed (${provider}): ${res.message || 'Unknown'}`, profileId, profile.name);
          }
        } catch (err: any) {
          get().addLog('error', `Start error (${provider}): ${err.message}`, profileId, profile.name);
          set((state) => ({
            profiles: state.profiles.map(p => p.id === profileId
              ? { ...p, status: 'error' as const, currentAction: 'Error' } : p)
          }));
        }
      },

      // ============ STOP PROFILE — routes via the profile's provider ============
      stopProfile: async (profileId) => {
        const profile = get().profiles.find(p => p.id === profileId);
        if (!profile) return;

        const current = get().browserProvider;
        const provider: BrowserProvider = profile.browserType
          || (current === 'all' ? 'morelogin' : current);

        get().addLog('info', `Stopping "${profile.name}" via ${provider}...`, profileId, profile.name);
        try {
          const res = await stopProviderProfile(provider, profileId);
          if (res.code === 0) {
            set((state) => ({
              profiles: state.profiles.map(p => p.id === profileId
                ? { ...p, status: 'stopped' as const, ip: undefined, currentAction: 'Idle' } : p)
            }));
            get().addLog('success', `"${profile.name}" stopped (${provider}).`, profileId, profile.name);
          } else {
            get().addLog('error', `Stop failed (${provider}): ${res.message}`, profileId, profile.name);
          }
        } catch (err: any) {
          get().addLog('error', `Stop error (${provider}): ${err.message}`, profileId, profile.name);
        }
      },

      // ============ DELETE PROFILE — routes via the profile's provider ============
      deleteProfile: async (profileId) => {
        const profile = get().profiles.find(p => p.id === profileId);
        if (!profile) return;

        const current = get().browserProvider;
        const provider: BrowserProvider = profile.browserType
          || (current === 'all' ? 'morelogin' : current);

        get().addLog('warn', `Deleting "${profile.name}" via ${provider}...`, profileId, profile.name);
        try {
          const res = await deleteProviderProfile(provider, profileId);
          if (res.code === 0) {
            set((state) => ({
              profiles: state.profiles.filter(p => p.id !== profileId),
              profileSettings: state.profileSettings.filter(s => s.profileId !== profileId),
              rateLimits: state.rateLimits.filter(r => r.profileId !== profileId),
            }));
            get().addLog('success', `"${profile.name}" deleted (${provider}).`, profileId, profile.name);
          } else {
            get().addLog('error', `Delete failed (${provider}): ${res.message}`, profileId, profile.name);
          }
        } catch (err: any) {
          get().addLog('error', `Delete error (${provider}): ${err.message}`, profileId, profile.name);
        }
      },

      // ============ RECREATE (Refresh Fingerprint) — MoreLogin-only API ============
      recreateProfile: async (profileId) => {
        const profile = get().profiles.find(p => p.id === profileId);
        if (!profile) return;

        const current = get().browserProvider;
        const provider: BrowserProvider = profile.browserType
          || (current === 'all' ? 'morelogin' : current);

        // Only MoreLogin supports remote fingerprint refresh; for others, regenerate locally.
        if (provider !== 'morelogin') {
          set((state) => ({
            profiles: state.profiles.map(p => p.id === profileId
              ? { ...p, fingerprint: generateDefaultFingerprint(p.os), status: 'stopped' as const, currentAction: 'Idle', ip: undefined }
              : p)
          }));
          get().addLog('info', `Local fingerprint regenerated for "${profile.name}" (${provider} doesn't support remote refresh).`, profileId, profile.name);
          return;
        }

        get().addLog('info', `Refreshing fingerprint for "${profile.name}"...`, profileId, profile.name);
        try {
          const res = await moreloginApi.refreshFingerprint(profileId);
          if (res.code === 0) {
            set((state) => ({
              profiles: state.profiles.map(p => p.id === profileId
                ? { ...p, fingerprint: generateDefaultFingerprint(p.os), status: 'stopped' as const, currentAction: 'Idle', ip: undefined }
                : p)
            }));
            get().addLog('success', `Fingerprint refreshed for "${profile.name}"`, profileId, profile.name);
          } else {
            get().addLog('error', `Refresh failed: ${res.msg}`, profileId, profile.name);
          }
        } catch (err: any) {
          get().addLog('error', `Refresh error: ${err.message}`, profileId, profile.name);
        }
      },

      toggleSelect: (id) => set((state) => ({
        profiles: state.profiles.map(p => p.id === id ? { ...p, selected: !p.selected } : p)
      })),

      selectAll: () => set((state) => ({
        profiles: state.profiles.map(p => ({ ...p, selected: true }))
      })),

      deselectAll: () => set((state) => ({
        profiles: state.profiles.map(p => ({ ...p, selected: false }))
      })),

      startSelected: () => {
        const { profiles, startProfile } = get();
        profiles.filter(p => p.selected && p.status === 'stopped').forEach(p => startProfile(p.id));
      },

      stopSelected: () => {
        const { profiles, stopProfile } = get();
        profiles.filter(p => p.selected && (p.status === 'running' || p.status === 'starting')).forEach(p => stopProfile(p.id));
      },

      renewProxy: (profileId) => {
        const profile = get().profiles.find(p => p.id === profileId);
        set((state) => ({
          profiles: state.profiles.map(p => {
            if (p.id !== profileId) return p;
            const newSession = genId();
            const newUsername = p.proxy.username.replace(/session-[^_]+/, `session-${newSession}`);
            return { ...p, proxy: { ...p.proxy, sessionId: newSession, username: newUsername, assignedAt: Date.now() } };
          })
        }));
        if (profile) get().addLog('success', `Proxy renewed for "${profile.name}"`, profileId, profile.name);
      },

      addJob: (profileId, taskType, details?) => {
        const profile = get().profiles.find(p => p.id === profileId);
        const job: Job = {
          id: genId(),
          profileId,
          profileName: profile?.name || 'Unknown',
          taskType,
          status: 'pending',
          retryCount: 0,
          createdAt: Date.now(),
          details,
        };
        set((state) => ({ jobs: [job, ...state.jobs] }));
        get().addLog('info', `Job: ${taskType} for ${profile?.name}`, profileId, profile?.name);
      },

      retryJob: (id) => set((state) => ({
        jobs: state.jobs.map(j => j.id === id ? { ...j, status: 'pending' as const, retryCount: j.retryCount + 1 } : j)
      })),

      clearLogs: () => set({ logs: [] }),
      clearLogsByLevel: (level) => set(state => ({ logs: state.logs.filter(l => l.level !== level) })),

      addReadHistory: (entry) => {
        const record: ReadHistory = { ...entry, id: genId() };
        set((state) => ({ readHistory: [record, ...state.readHistory].slice(0, 2000) }));
      },

      updateProfileSettings: (profileId, updates) => set((state) => ({
        profileSettings: state.profileSettings.map(s => s.profileId === profileId ? { ...s, ...updates } : s)
      })),

      updateRateLimit: (profileId, updates) => set((state) => ({
        rateLimits: state.rateLimits.map(r => r.profileId === profileId ? { ...r, ...updates } : r)
      })),
    }),
    {
      name: 'mmb-sites-store',
      partialize: (state) => ({
        browserProvider: state.browserProvider,
        jobs: state.jobs,
        logs: state.logs.slice(0, 100),
        activeTab: state.activeTab,
        profileSettings: state.profileSettings,
        readHistory: state.readHistory,
        rateLimits: state.rateLimits,
      }),
    }
  )
);
