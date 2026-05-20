import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shuffle, Save, RotateCcw, Play, Eye, AlertTriangle, CheckCircle, Search, Download, Upload, Pin, Square,
} from 'lucide-react';
import type { Profile } from '../types';
import type { Channel, Video } from '../store/useChannelStore';
import LiveProgressPanel from './LiveProgressPanel';
import { backendUrl } from '../services/backendOrigin';
import { postActivityLog } from '../utils/logsApi';
import { profileConfigsForSchedule } from '../utils/profileConfigsForSchedule';
import { PERMANENT_CHANNEL_IDS } from '../data/defaultChannels';
import { toScheduleVideo } from '../utils/shuffleVideos';
import {
  fetchShuffleStateFromServer,
  syncShuffleStateToServer,
  clearServerWatchHistory,
  stopScheduleRun,
  fetchConcurrency,
  pollShuffleRunUntilDone,
  pickRandomComment,
} from '../utils/shuffleApi';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface ChannelConfig {
  channelId: number;
  channelName: string;
  totalVideos: number;
  minPerProfile: number;
  maxPerProfile: number;
}

interface ProfileAssignment {
  profileId: string;
  profileName: string;
  videos: { channelId: number; channelName: string; videoId: string; title: string; url: string }[];
}

interface WatchHistory {
  profileId: string;
  videoId: string;
  watchedAt: number;
}

/** Matches local shuffle expiry — server rows older than this are ignored when merging */
const SHUFFLE_HISTORY_MS = 14 * 24 * 60 * 60 * 1000;

type ServerHistRow = { norm: string; watchedAt: number };

function normalizeWatchTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function videoIsWatched(
  profileId: string,
  video: Video,
  localHist: WatchHistory[],
  serverHist: Record<string, ServerHistRow[]>,
): boolean {
  if (localHist.some(h => h.profileId === profileId && h.videoId === video.video_id)) return true;
  const n = normalizeWatchTitle(video.title);
  return (serverHist[profileId] || []).some(r => r.norm === n);
}

function videoLastWatchedAt(
  profileId: string,
  video: Video,
  localHist: WatchHistory[],
  serverHist: Record<string, ServerHistRow[]>,
): number {
  let t = 0;
  const loc = localHist.find(h => h.profileId === profileId && h.videoId === video.video_id);
  if (loc) t = Math.max(t, loc.watchedAt);
  const n = normalizeWatchTitle(video.title);
  for (const r of serverHist[profileId] || []) {
    if (r.norm === n) t = Math.max(t, r.watchedAt);
  }
  return t;
}

interface VideoShufflePageProps {
  profiles: Profile[];
  channels: Channel[];
  getVideos: (channelId: number, filter?: string) => Video[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERSISTENCE HELPERS — backend watch_history (+ optional LS mirror after local edits only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Sab profiles ki history `GET /api/watch-history/:id` se — sirf backend, localStorage read nahi. */
async function loadHistoryFromBackend(profileIds: string[]): Promise<{
  shuffleRows: WatchHistory[];
  titleIndex: Record<string, ServerHistRow[]>;
}> {
  const cutoff = Date.now() - SHUFFLE_HISTORY_MS;
  const shuffleRows: WatchHistory[] = [];
  const titleIndex: Record<string, ServerHistRow[]> = {};
  await Promise.all(
    profileIds.map(async (profileId) => {
      try {
        const res = await fetch(backendUrl('/api/watch-history/' + encodeURIComponent(profileId)));
        const data = await res.json();
        if (data.code !== 0 || !Array.isArray(data.data)) return;
        const norms: ServerHistRow[] = [];
        for (const h of data.data) {
          const watchedAt = typeof h?.watchedAt === 'number' ? h.watchedAt : 0;
          if (watchedAt <= cutoff) continue;
          const vid = typeof h?.videoId === 'string' ? h.videoId.trim() : '';
          if (vid) {
            shuffleRows.push({ profileId, videoId: vid, watchedAt });
          }
          const title = typeof h?.videoTitle === 'string' ? h.videoTitle.trim() : '';
          if (title) {
            norms.push({ norm: normalizeWatchTitle(title), watchedAt });
          }
        }
        if (norms.length) titleIndex[profileId] = norms;
      } catch {
        /* skip profile */
      }
    }),
  );
  return { shuffleRows, titleIndex };
}
function saveHistory(history: WatchHistory[]) {
  try { localStorage.setItem('mmb_watch_history', JSON.stringify(history)); } catch {}
}

function loadAssignments(): ProfileAssignment[] {
  try { const d = localStorage.getItem('mmb_shuffle_assignments'); return d ? JSON.parse(d) : []; } catch { return []; }
}
function saveAssignments(assignments: ProfileAssignment[]) {
  try { localStorage.setItem('mmb_shuffle_assignments', JSON.stringify(assignments)); } catch {}
}

const SHUFFLE_SETTINGS_KEY = 'mmb_shuffle_settings';

interface ShuffleSettings {
  channelConfigs: ChannelConfig[];
  enabledChannelIds: number[];
}

function loadShuffleSettings(): ShuffleSettings {
  try {
    const d = localStorage.getItem(SHUFFLE_SETTINGS_KEY);
    if (d) return JSON.parse(d);
  } catch { /* ignore */ }
  return { channelConfigs: [], enabledChannelIds: [] };
}

function saveShuffleSettings(s: ShuffleSettings) {
  try { localStorage.setItem(SHUFFLE_SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function clampChannelConfig(c: ChannelConfig, totalVideos: number): ChannelConfig {
  const total = Math.max(0, totalVideos);
  if (total === 0) return { ...c, totalVideos: 0, minPerProfile: 0, maxPerProfile: 0 };
  let min = Math.max(0, Math.min(c.minPerProfile, total));
  let max = Math.max(min, Math.min(c.maxPerProfile, total));
  if (min > max) [min, max] = [max, min];
  return { ...c, totalVideos: total, minPerProfile: min, maxPerProfile: max };
}

function buildChannelConfigs(
  channels: Channel[],
  enabledChannelIds: number[],
  saved: ChannelConfig[],
  getVideos: (channelId: number, filter?: string) => Video[],
): ChannelConfig[] {
  const active = channels.filter(ch => ch.status === 'active');
  const enabledSet = new Set(enabledChannelIds.length ? enabledChannelIds : active.map(c => c.id));
  return active
    .filter(ch => enabledSet.has(ch.id))
    .map(ch => {
      const prev = saved.find(s => s.channelId === ch.id);
      const base: ChannelConfig = {
        channelId: ch.id,
        channelName: ch.channel_name,
        totalVideos: getVideos(ch.id, 'enabled').length,
        minPerProfile: prev?.minPerProfile ?? 2,
        maxPerProfile: prev?.maxPerProfile ?? 4,
      };
      return clampChannelConfig(base, base.totalVideos);
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function VideoShufflePage({ profiles, channels, getVideos }: VideoShufflePageProps) {
  const [settings, setSettings] = useState<ShuffleSettings>(() => loadShuffleSettings());
  const [channelConfigs, setChannelConfigs] = useState<ChannelConfig[]>([]);
  const [assignments, setAssignments] = useState<ProfileAssignment[]>(() => loadAssignments());
  const [watchHistory, setWatchHistory] = useState<WatchHistory[]>([]);
  const [serverHist, setServerHist] = useState<Record<string, ServerHistRow[]>>({});
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [isShuffled, setIsShuffled] = useState(false);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState<{ limit: number; running: number; available: number } | null>(null);
  const [detailProfile, setDetailProfile] = useState<string | null>(null);
  const [poolExhaustedNotice, setPoolExhaustedNotice] = useState<string[]>([]);
  const [profileSearch, setProfileSearch] = useState('');
  const [profilePage, setProfilePage] = useState(1);
  const [serverSynced, setServerSynced] = useState(false);
  const stopPollRef = useRef<(() => void) | null>(null);
  const profilesPerPage = 24;

  const profileIdSet = useMemo(() => new Set(profiles.map(p => p.id)), [profiles]);

  useEffect(() => {
    setChannelConfigs(buildChannelConfigs(channels, settings.enabledChannelIds, settings.channelConfigs, getVideos));
  }, [channels, settings.enabledChannelIds, settings.channelConfigs, getVideos]);

  useEffect(() => {
    saveShuffleSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!serverSynced) return;
    const t = window.setTimeout(() => {
      void syncShuffleStateToServer({
        assignments,
        channelConfigs,
        enabledChannelIds: settings.enabledChannelIds,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [assignments, channelConfigs, settings.enabledChannelIds, serverSynced]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchShuffleStateFromServer();
      if (cancelled) return;
      if (remote?.assignments?.length) {
        setAssignments(remote.assignments as ProfileAssignment[]);
        saveAssignments(remote.assignments as ProfileAssignment[]);
      }
      if (remote?.channelConfigs?.length || remote?.enabledChannelIds?.length) {
        setSettings({
          channelConfigs: (remote.channelConfigs as ChannelConfig[]) || [],
          enabledChannelIds: remote.enabledChannelIds || [],
        });
      }
      setServerSynced(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setAssignments(prev => prev.filter(a => profileIdSet.has(a.profileId)));
  }, [profileIdSet]);

  useEffect(() => {
    const load = () => { void fetchConcurrency().then(setConcurrency); };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => { stopPollRef.current?.(); }, []);

  useEffect(() => {
    if (profiles.length === 0) {
      setWatchHistory([]);
      setServerHist({});
      return;
    }
    let cancelled = false;
    const profileIds = profiles.map((p) => p.id);
    loadHistoryFromBackend(profileIds).then(({ shuffleRows, titleIndex }) => {
      if (cancelled) return;
      setWatchHistory(shuffleRows);
      setServerHist(titleIndex);
    });
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  const refreshShuffleHistoryFromBackend = useCallback(async () => {
    if (profiles.length === 0) {
      setWatchHistory([]);
      setServerHist({});
      return;
    }
    const profileIds = profiles.map((p) => p.id);
    const { shuffleRows, titleIndex } = await loadHistoryFromBackend(profileIds);
    setWatchHistory(shuffleRows);
    saveHistory(shuffleRows);
    setServerHist(titleIndex);
  }, [profiles]);

  // Stats
  const totalPool = useMemo(() => channelConfigs.reduce((sum, c) => sum + c.totalVideos, 0), [channelConfigs]);
  const totalAssigned = useMemo(() => assignments.reduce((sum, a) => sum + a.videos.length, 0), [assignments]);
  const hasOverlap = useMemo(() => {
    // Check if any 2 profiles have same video in current assignments
    const videoMap = new Map<string, string[]>();
    for (const a of assignments) {
      for (const v of a.videos) {
        const key = v.videoId;
        if (!videoMap.has(key)) videoMap.set(key, []);
        videoMap.get(key)!.push(a.profileId);
      }
    }
    return [...videoMap.values()].some(profiles => profiles.length > 1);
  }, [assignments]);

  const watchedCountsByProfile = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of profiles) {
      const pid = p.id;
      const localRows = watchHistory.filter(h => h.profileId === pid);
      const countedVideoIds = new Set(localRows.map(h => h.videoId));
      let count = localRows.length;
      const serverRows = serverHist[pid] || [];
      const titlesCountedFromServer = new Set<string>();
      for (const ch of channelConfigs) {
        for (const v of getVideos(ch.channelId, 'enabled')) {
          if (countedVideoIds.has(v.video_id)) continue;
          const n = normalizeWatchTitle(v.title);
          if (serverRows.some(r => r.norm === n)) {
            if (!titlesCountedFromServer.has(n)) {
              titlesCountedFromServer.add(n);
              count++;
              countedVideoIds.add(v.video_id);
            }
          }
        }
      }
      out[pid] = count;
    }
    return out;
  }, [profiles, watchHistory, serverHist, channelConfigs, getVideos]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHUFFLE ALGORITHM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const shuffleAll = useCallback(() => {
    const profilesToShuffle = profiles; // Always shuffle ALL
    
    const newAssignments: ProfileAssignment[] = [];
    const usedInThisRun = new Set<string>();
    const notices: string[] = [];

    for (const profile of profilesToShuffle) {
      const profileVideos: ProfileAssignment['videos'] = [];

      for (const config of channelConfigs) {
        const allChannelVideos = getVideos(config.channelId, 'enabled');
        if (allChannelVideos.length === 0) continue;

        // Random count between min-max
        const count = Math.floor(Math.random() * (config.maxPerProfile - config.minPerProfile + 1)) + config.minPerProfile;

        // Filter: unwatched by this profile (local + server titles) + not used in this run
        let available = allChannelVideos.filter(v =>
          !videoIsWatched(profile.id, v, watchHistory, serverHist) && !usedInThisRun.has(v.video_id)
        );

        // Pool exhausted? Allow repeat with notice
        if (available.length < count) {
          notices.push(`${profile.name}: Pool exhausted for "${config.channelName}" — repeating oldest`);
          // Add back oldest watched (but still avoid same-run overlap)
          const oldestWatched = allChannelVideos
            .filter(v => !usedInThisRun.has(v.video_id))
            .sort((a, b) => {
              const aTime = videoLastWatchedAt(profile.id, a, watchHistory, serverHist);
              const bTime = videoLastWatchedAt(profile.id, b, watchHistory, serverHist);
              return aTime - bTime; // oldest first
            });
          available = [...available, ...oldestWatched];
          // Remove duplicates
          available = [...new Map(available.map(v => [v.video_id, v])).values()];
        }

        // Shuffle available videos randomly
        const shuffled = [...available].sort(() => Math.random() - 0.5);

        // Pick 'count' videos — ensure we always get exactly 'count' by repeating if needed
        let picked = shuffled.slice(0, Math.min(count, shuffled.length));
        if (picked.length < count && shuffled.length > 0) {
          // If still short, cycle through available again to reach count
          while (picked.length < count) {
            const nextCycle = shuffled.slice(0, count - picked.length);
            picked = [...picked, ...nextCycle];
          }
        }

        for (const video of picked) {
          usedInThisRun.add(video.video_id);
          profileVideos.push({
            channelId: config.channelId,
            channelName: config.channelName,
            videoId: video.video_id,
            title: video.title,
            url: video.url,
          });
        }
      }

      newAssignments.push({
        profileId: profile.id,
        profileName: profile.name,
        videos: profileVideos,
      });
    }

    setAssignments(newAssignments);
    setPoolExhaustedNotice(notices);
    setIsShuffled(true);
  }, [profiles, channelConfigs, getVideos, watchHistory, serverHist]);

  // Shuffle ONLY selected profiles (keep others unchanged)
  const shuffleSelected = useCallback(() => {
    if (selectedProfileIds.length === 0) return;
    
    // Keep existing assignments for non-selected profiles
    const existingOthers = assignments.filter(a => !selectedProfileIds.includes(a.profileId));
    const usedByOthers = new Set(existingOthers.flatMap(a => a.videos.map(v => v.videoId)));
    
    const newAssignments: ProfileAssignment[] = [...existingOthers];
    const usedInThisRun = new Set(usedByOthers);
    const notices: string[] = [];

    for (const profile of profiles.filter(p => selectedProfileIds.includes(p.id))) {
      const profileVideos: ProfileAssignment['videos'] = [];

      for (const config of channelConfigs) {
        const allChannelVideos = getVideos(config.channelId, 'enabled');
        if (allChannelVideos.length === 0) continue;
        const count = Math.floor(Math.random() * (config.maxPerProfile - config.minPerProfile + 1)) + config.minPerProfile;

        let available = allChannelVideos.filter(v =>
          !videoIsWatched(profile.id, v, watchHistory, serverHist) && !usedInThisRun.has(v.video_id)
        );

        if (available.length < count) {
          notices.push(`${profile.name}: Pool exhausted for "${config.channelName}" — repeating oldest`);
          const oldestWatched = allChannelVideos
            .filter(v => !usedInThisRun.has(v.video_id))
            .sort((a, b) => {
              const aTime = videoLastWatchedAt(profile.id, a, watchHistory, serverHist);
              const bTime = videoLastWatchedAt(profile.id, b, watchHistory, serverHist);
              return aTime - bTime;
            });
          available = [...available, ...oldestWatched];
          available = [...new Map(available.map(v => [v.video_id, v])).values()];
        }

        const shuffled = [...available].sort(() => Math.random() - 0.5);
        let picked = shuffled.slice(0, Math.min(count, shuffled.length));
        if (picked.length < count && shuffled.length > 0) {
          while (picked.length < count) {
            const nextCycle = shuffled.slice(0, count - picked.length);
            picked = [...picked, ...nextCycle];
          }
        }

        for (const video of picked) {
          usedInThisRun.add(video.video_id);
          profileVideos.push({ channelId: config.channelId, channelName: config.channelName, videoId: video.video_id, title: video.title, url: video.url });
        }
      }

      newAssignments.push({ profileId: profile.id, profileName: profile.name, videos: profileVideos });
    }

    setAssignments(newAssignments);
    setPoolExhaustedNotice(notices);
    setIsShuffled(true);
  }, [selectedProfileIds, profiles, channelConfigs, getVideos, watchHistory, serverHist, assignments]);

  // Reshuffle single profile
  const reshuffleSingle = useCallback((profileId: string) => {
    const usedByOthers = new Set(
      assignments.filter(a => a.profileId !== profileId).flatMap(a => a.videos.map(v => v.videoId))
    );
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    const profileVideos: ProfileAssignment['videos'] = [];
    const usedInThisRun = new Set<string>();

    for (const config of channelConfigs) {
      const allChannelVideos = getVideos(config.channelId, 'enabled');
      const count = Math.floor(Math.random() * (config.maxPerProfile - config.minPerProfile + 1)) + config.minPerProfile;

      let available = allChannelVideos.filter(v =>
        !videoIsWatched(profileId, v, watchHistory, serverHist) && !usedByOthers.has(v.video_id) && !usedInThisRun.has(v.video_id)
      );

      if (available.length < count) {
        available = allChannelVideos.filter(v => !usedByOthers.has(v.video_id) && !usedInThisRun.has(v.video_id));
      }

      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, Math.min(count, shuffled.length));

      for (const video of picked) {
        usedInThisRun.add(video.video_id);
        profileVideos.push({
          channelId: config.channelId,
          channelName: config.channelName,
          videoId: video.video_id,
          title: video.title,
          url: video.url,
        });
      }
    }

    setAssignments(prev => prev.map(a => a.profileId === profileId ? { ...a, videos: profileVideos } : a));
  }, [assignments, channelConfigs, getVideos, watchHistory, serverHist, profiles]);

  const updateChannelConfig = (channelId: number, patch: Partial<ChannelConfig>) => {
    setChannelConfigs(prev => {
      const next = prev.map(c => c.channelId === channelId ? clampChannelConfig({ ...c, ...patch }, patch.totalVideos ?? c.totalVideos) : c);
      setSettings(s => ({ ...s, channelConfigs: next }));
      return next;
    });
  };

  const setChannelEnabled = (channelId: number, enabled: boolean) => {
    const activeIds = channels.filter(c => c.status === 'active').map(c => c.id);
    setSettings(prev => {
      let ids = prev.enabledChannelIds.length ? [...prev.enabledChannelIds] : activeIds;
      if (enabled) ids = [...new Set([...ids, channelId])];
      else ids = ids.filter(id => id !== channelId);
      return { ...prev, enabledChannelIds: ids };
    });
  };

  const selectFixedChannels = () => {
    const fixedIds = channels
      .filter(c => PERMANENT_CHANNEL_IDS.includes(c.channel_id as typeof PERMANENT_CHANNEL_IDS[number]))
      .map(c => c.id);
    setSettings(prev => ({
      ...prev,
      enabledChannelIds: [...new Set([...(prev.enabledChannelIds.length ? prev.enabledChannelIds : channels.filter(c => c.status === 'active').map(c => c.id)), ...fixedIds])],
    }));
  };

  const handleSave = () => {
    saveAssignments(assignments);
    setSettings(s => ({ ...s, channelConfigs }));
    setIsShuffled(false);
    void syncShuffleStateToServer({ assignments, channelConfigs, enabledChannelIds: settings.enabledChannelIds });
  };

  const handleReset = () => {
    if (!window.confirm('Clear all shuffle assignments?')) return;
    setAssignments([]);
    setPoolExhaustedNotice([]);
    setIsShuffled(false);
    localStorage.removeItem('mmb_shuffle_assignments');
    setSelectedProfileIds([]);
    void syncShuffleStateToServer({ assignments: [], channelConfigs, enabledChannelIds: settings.enabledChannelIds });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ assignments, channelConfigs, enabledChannelIds: settings.enabledChannelIds }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mmb-shuffle-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (parsed.assignments) setAssignments(parsed.assignments);
        if (parsed.channelConfigs || parsed.enabledChannelIds) {
          setSettings({
            channelConfigs: parsed.channelConfigs || [],
            enabledChannelIds: parsed.enabledChannelIds || [],
          });
        }
        setIsShuffled(true);
      } catch {
        window.alert('Invalid shuffle JSON export file.');
      }
    };
    input.click();
  };

  const resetProfileHistory = async (profileId: string) => {
    if (!window.confirm('Clear watch history for this profile (local + server)?')) return;
    await clearServerWatchHistory(profileId);
    const updated = watchHistory.filter(h => h.profileId !== profileId);
    setWatchHistory(updated);
    saveHistory(updated);
    setServerHist(prev => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    void refreshShuffleHistoryFromBackend();
  };

  const handleStopRun = () => {
    if (activeRunId) void stopScheduleRun(activeRunId);
    stopPollRef.current?.();
    stopPollRef.current = null;
    setRunning(false);
    setActiveRunId(null);
    setRunProgress(null);
  };

  const buildSchedulePayload = (profilesToRun: ProfileAssignment[], scheduleId: string, name: string) => ({
    id: scheduleId,
    name,
    selectedProfiles: profilesToRun.map(a => a.profileId),
    selectedChannels: channelConfigs.map(c => c.channelId),
    assignmentMode: 'per-profile' as const,
    sameForAll: [] as [],
    perProfile: profilesToRun.map(a => ({
      profileId: a.profileId,
      channelSelections: channelConfigs.map(config => ({
        channelId: config.channelId,
        channelName: config.channelName,
        videos: a.videos.filter(v => v.channelId === config.channelId).map(toScheduleVideo),
      })),
    })),
    profileConfigs: profileConfigsForSchedule(profilesToRun.map(a => a.profileId), profiles),
    profileDelayMin: 5,
    profileDelayMax: 20,
    tabDelayMin: 2,
    tabDelayMax: 8,
    commentText: pickRandomComment(),
    runMode: 'manual' as const,
  });

  const afterRunStarted = (scheduleId: string, profileIds: string[]) => {
    setActiveRunId(scheduleId);
    setRunning(true);
    stopPollRef.current?.();
    stopPollRef.current = pollShuffleRunUntilDone(profileIds, (stats) => {
      setRunProgress({ done: stats.done, total: stats.total, failed: stats.error });
      if (stats.total > 0 && stats.running === 0 && stats.waiting === 0) {
        setRunning(false);
        setActiveRunId(null);
        void refreshShuffleHistoryFromBackend();
      }
    });
  };

  const runSingleProfile = async (profileId: string) => {
    const assignment = assignments.find(a => a.profileId === profileId);
    if (!assignment || !assignment.videos.length) {
      window.alert('No videos assigned — shuffle first.');
      return;
    }
    const scheduleId = 'shuffle_single_' + Date.now();
    try {
      const res = await fetch(backendUrl('/api/schedule/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: buildSchedulePayload([assignment], scheduleId, `Shuffle: ${assignment.profileName}`),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || data?.message || 'Run failed — is backend running?';
        void postActivityLog('error', `Shuffle single failed: ${msg}`, { source: 'shuffle' });
        window.alert(msg);
        return;
      }
      afterRunStarted(scheduleId, [profileId]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Run failed';
      void postActivityLog('error', `Shuffle single error: ${msg}`, { source: 'shuffle' });
      window.alert(msg);
    }
  };

  const handleRunAll = async () => {
    const profilesToRun = selectedProfileIds.length > 0
      ? assignments.filter(a => selectedProfileIds.includes(a.profileId))
      : assignments;

    if (profilesToRun.length === 0) {
      window.alert('Shuffle karo pehle — koi assignment nahi.');
      return;
    }

    const conc = await fetchConcurrency();
    if (conc && profilesToRun.length > conc.available) {
      const ok = window.confirm(
        `Concurrency: ${conc.running}/${conc.limit} running, ${conc.available} slots free.\n` +
        `${profilesToRun.length} profiles selected — server may trim.\n\nContinue?`,
      );
      if (!ok) return;
    }

    const mlxCount = profilesToRun.filter(a => profiles.find(p => p.id === a.profileId)?.browserType === 'multilogin').length;
    if (mlxCount > 3) {
      const ok = window.confirm(`Multilogin: ${mlxCount} profiles — batched ~3 at a time. Continue?`);
      if (!ok) return;
    }

    const scheduleId = 'shuffle_' + Date.now();
    try {
      const res = await fetch(backendUrl('/api/schedule/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: buildSchedulePayload(profilesToRun, scheduleId, 'Video Shuffle Run'),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || data?.message || 'Run failed — check backend + MoreLogin/Multilogin.';
        void postActivityLog('error', `Shuffle run failed: ${msg}`, { source: 'shuffle' });
        window.alert(msg);
        return;
      }
      if ((data.skippedNoVideos || 0) > 0) {
        window.alert(`${data.skippedNoVideos} profile(s) skipped — no videos. Reshuffle those profiles.`);
      }
      if (data.trimmed) {
        window.alert(`Started ${data.workersSpawned} workers (concurrency limit ${data.limit}).`);
      }
      afterRunStarted(scheduleId, profilesToRun.map(a => a.profileId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Run failed';
      void postActivityLog('error', `Shuffle run error: ${msg}`, { source: 'shuffle' });
      window.alert(msg);
      setRunning(false);
    }
  };

  const filteredProfiles = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [profiles, profileSearch]);
  const profilePages = Math.max(1, Math.ceil(filteredProfiles.length / profilesPerPage));
  const pagedProfiles = filteredProfiles.slice((profilePage - 1) * profilesPerPage, profilePage * profilesPerPage);
  const activeChannels = useMemo(() => channels.filter(c => c.status === 'active'), [channels]);
  const enabledIdSet = useMemo(() => {
    const ids = settings.enabledChannelIds.length ? settings.enabledChannelIds : activeChannels.map(c => c.id);
    return new Set(ids);
  }, [settings.enabledChannelIds, activeChannels]);

  const removeVideoFromAssignment = (profileId: string, index: number) => {
    setAssignments(prev => prev.map(a => a.profileId === profileId ? { ...a, videos: a.videos.filter((_, i) => i !== index) } : a));
    setIsShuffled(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Video Shuffle</h1>
            <p className="text-gray-500 text-sm mt-0.5">Unique videos per profile · history from server (14 days) · watched mark hota hai jab video actually complete ho.</p>
            <button type="button" onClick={() => { void refreshShuffleHistoryFromBackend(); }}
              className="mt-1 text-xs text-purple-400 hover:text-purple-300 underline-offset-2 hover:underline">
              Refresh server watch history
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button type="button" onClick={handleImport} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs">
              <Upload size={14} /> Import
            </button>
            <button type="button" onClick={handleExport} disabled={!assignments.length} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs disabled:opacity-40">
              <Download size={14} /> Export
            </button>
            <button type="button" onClick={shuffleAll} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-all">
              <Shuffle size={15} /> Shuffle All
            </button>
            <button type="button" onClick={shuffleSelected} disabled={selectedProfileIds.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-800 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-medium transition-all">
              <Shuffle size={15} /> Shuffle Selected ({selectedProfileIds.length})
            </button>
            <button type="button" onClick={handleSave} disabled={!isShuffled}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-semibold transition-all">
              <Save size={15} /> Apply & Save
            </button>
            <button type="button" onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-all">
              <RotateCcw size={15} /> Reset
            </button>
            {running ? (
              <button type="button" onClick={handleStopRun}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold transition-all">
                <Square size={15} /> Stop
              </button>
            ) : (
              <button type="button" onClick={handleRunAll} disabled={assignments.length === 0 || channelConfigs.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-bold transition-all shadow-lg shadow-red-900/30">
                <Play size={15} /> {selectedProfileIds.length > 0 ? `Run ${selectedProfileIds.length} Selected` : 'Run All'}
              </button>
            )}
          </div>
        </div>

        {concurrency && (
          <div className="mb-3 flex items-center gap-2 text-xs text-amber-300/90 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
            <AlertTriangle size={14} />
            Concurrency: {concurrency.running}/{concurrency.limit} running · {concurrency.available} slots free
          </div>
        )}
        {running && runProgress && (
          <div className="mb-3 text-xs text-green-400 bg-green-900/20 border border-green-700/30 rounded-lg px-3 py-2">
            Progress: {runProgress.done}/{runProgress.total} done
            {runProgress.failed > 0 && ` · ${runProgress.failed} failed`}
            <span className="text-gray-500 ml-2">— history updates per completed video</span>
          </div>
        )}

        {/* Pool Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="border border-blue-700/30 bg-blue-900/10 rounded-xl p-3">
            <div className="text-xl font-bold text-blue-400">{totalPool}</div>
            <div className="text-xs text-gray-500">Total Video Pool</div>
          </div>
          <div className="border border-green-700/30 bg-green-900/10 rounded-xl p-3">
            <div className="text-xl font-bold text-green-400">{totalAssigned}</div>
            <div className="text-xs text-gray-500">Assigned</div>
          </div>
          <div className={`border rounded-xl p-3 ${hasOverlap ? 'border-red-700/30 bg-red-900/10' : 'border-green-700/30 bg-green-900/10'}`}>
            <div className={`text-xl font-bold ${hasOverlap ? 'text-red-400' : 'text-green-400'}`}>{hasOverlap ? '⚠️ Overlap' : '✅ Clean'}</div>
            <div className="text-xs text-gray-500">Overlap Status</div>
          </div>
          <div className="border border-purple-700/30 bg-purple-900/10 rounded-xl p-3">
            <div className="text-xl font-bold text-purple-400">{profiles.length}</div>
            <div className="text-xs text-gray-500">Profiles</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Live Progress Panel */}
        <LiveProgressPanel compact />

        {/* Pool Exhausted Notices */}
        {poolExhaustedNotice.length > 0 && (
          <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium"><AlertTriangle size={14} /> Pool Exhausted Notices:</div>
            {poolExhaustedNotice.map((n, i) => <p key={i} className="text-xs text-yellow-300/70 ml-5">{n}</p>)}
          </div>
        )}

        {/* Profile Selection */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold">Select Profiles to Shuffle</h2>
            <div className="flex gap-2">
              <button onClick={() => setSelectedProfileIds(profiles.map(p => p.id))}
                className="text-xs text-purple-400 hover:text-purple-300">Select All</button>
              <button onClick={() => setSelectedProfileIds([])}
                className="text-xs text-gray-400 hover:text-gray-300">Deselect All</button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">Shuffle All = saare profiles. Selected = Shuffle Selected + Run filter.</p>
          <input value={profileSearch} onChange={(e) => { setProfileSearch(e.target.value); setProfilePage(1); }}
            placeholder="Search profiles…" className="w-full max-w-xs mb-3 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
          <div className="flex flex-wrap gap-2">
            {pagedProfiles.map(p => {
              const isSelected = selectedProfileIds.includes(p.id);
              return (
                <button key={p.id} onClick={() => setSelectedProfileIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${isSelected ? 'border-purple-500 bg-purple-900/30 text-purple-300' : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'}`}>
                  <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-purple-400' : 'bg-gray-600'}`} />
                  {p.name}
                </button>
              );
            })}
          </div>
          {profilePages > 1 && (
            <div className="flex justify-center gap-2 mt-3 text-xs text-gray-500">
              <button type="button" disabled={profilePage <= 1} onClick={() => setProfilePage(p => p - 1)}>Prev</button>
              <span>{profilePage}/{profilePages}</span>
              <button type="button" disabled={profilePage >= profilePages} onClick={() => setProfilePage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>

        {/* Channel Settings */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-white font-semibold">Channel Settings</h2>
            <button type="button" onClick={selectFixedChannels} className="text-xs text-amber-400 flex items-center gap-1">
              <Pin size={12} /> Fixed channels
            </button>
          </div>
          {activeChannels.length === 0 ? (
            <p className="text-gray-500 text-sm">No active channels.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {activeChannels.map(ch => {
                const enabled = enabledIdSet.has(ch.id);
                const config = channelConfigs.find(c => c.channelId === ch.id);
                const total = getVideos(ch.id, 'enabled').length;
                return (
                  <div key={ch.id} className={`bg-gray-800 rounded-xl p-4 border ${enabled ? 'border-purple-700/50' : 'border-gray-700 opacity-60'}`}>
                    <label className="flex items-center gap-2 mb-3 cursor-pointer">
                      <input type="checkbox" checked={enabled} onChange={(e) => setChannelEnabled(ch.id, e.target.checked)} />
                      <span className="text-white text-sm font-medium">{ch.channel_name}</span>
                      <span className="text-xs text-gray-500 ml-auto">{total} videos</span>
                    </label>
                    {enabled && config && total > 0 && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-gray-400">Min</label>
                          <input type="number" value={config.minPerProfile} min={0} max={total}
                            onChange={(e) => updateChannelConfig(ch.id, { minPerProfile: Number(e.target.value) })}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm" />
                        </div>
                        <span className="text-gray-500 mt-4">—</span>
                        <div className="flex-1">
                          <label className="text-xs text-gray-400">Max</label>
                          <input type="number" value={config.maxPerProfile} min={0} max={total}
                            onChange={(e) => updateChannelConfig(ch.id, { maxPerProfile: Number(e.target.value) })}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Profile Grid */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4">Profile Assignments</h2>
          {assignments.length === 0 ? (
            <div className="text-center py-12 text-gray-600">
              <Shuffle size={40} className="mx-auto mb-3 opacity-30" />
              <p>Click "Shuffle All" to assign videos to profiles</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {assignments.map(a => {
                const profile = profiles.find(p => p.id === a.profileId);
                const historyCount = watchedCountsByProfile[a.profileId] ?? watchHistory.filter(h => h.profileId === a.profileId).length;
                const totalAvailable = channelConfigs.reduce((sum, c) => sum + c.totalVideos, 0);
                const watchPercent = totalAvailable > 0 ? Math.round((historyCount / totalAvailable) * 100) : 0;
                return (
                  <div key={a.profileId}
                    className="bg-gray-800 border border-gray-700 rounded-xl p-3 hover:border-purple-600/50 transition-all group">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-xs font-bold">{(profile?.name || 'P').charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-medium truncate">{profile?.name || a.profileName}</p>
                        <p className="text-xs text-gray-500">{a.videos.length} assigned • {historyCount}/{totalAvailable} watched</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); runSingleProfile(a.profileId); }}
                        className="bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded text-xs transition-all">
                        <Play size={10} className="inline" /> Run
                      </button>
                      <button type="button" onClick={() => { if (window.confirm('Reshuffle this profile?')) reshuffleSingle(a.profileId); }}
                        className="bg-purple-800 hover:bg-purple-700 text-white px-2 py-1 rounded text-xs">
                        <Shuffle size={10} className="inline" />
                      </button>
                      <button type="button" onClick={() => setDetailProfile(a.profileId)}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded text-xs transition-all">
                        <Eye size={11} className="inline mr-0.5" /> Detail
                      </button>
                      <button type="button" onClick={() => { void resetProfileHistory(a.profileId); }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-red-400 transition-all" title="Clear local + server watch history">↺</button>
                    </div>
                    {/* Watch Progress Bar */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${watchPercent >= 80 ? 'bg-red-500' : watchPercent >= 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${watchPercent}%` }} />
                      </div>
                      <span className={`text-xs font-medium ${watchPercent >= 80 ? 'text-red-400' : watchPercent >= 50 ? 'text-yellow-400' : 'text-green-400'}`}>{watchPercent}%</span>
                    </div>
                    <div className="space-y-0.5">
                      {a.videos.slice(0, 4).map((v, i) => (
                        <div key={i} className="flex items-center gap-1 text-xs">
                          <span className="text-gray-600 w-3">{i + 1}.</span>
                          <span className="text-gray-400 truncate">{v.title}</span>
                        </div>
                      ))}
                      {a.videos.length > 4 && <p className="text-xs text-gray-600 ml-4">+{a.videos.length - 4} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {detailProfile && (
        <DetailModal
          assignment={assignments.find(a => a.profileId === detailProfile)!}
          profile={profiles.find(p => p.id === detailProfile)}
          watchHistory={watchHistory.filter(h => h.profileId === detailProfile)}
          serverNormSet={new Set((serverHist[detailProfile] || []).map(r => r.norm))}
          mergedWatchedCount={watchedCountsByProfile[detailProfile] ?? watchHistory.filter(h => h.profileId === detailProfile).length}
          onRemove={(index) => removeVideoFromAssignment(detailProfile, index)}
          onClose={() => setDetailProfile(null)} />
      )}
    </div>
  );
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DETAIL MODAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function DetailModal({ assignment, profile, watchHistory, serverNormSet, mergedWatchedCount, onRemove, onClose }: {
  assignment: ProfileAssignment;
  profile: Profile | undefined;
  watchHistory: WatchHistory[];
  serverNormSet: Set<string>;
  mergedWatchedCount: number;
  onRemove: (index: number) => void;
  onClose: () => void;
}) {
  if (!assignment) return null;

  // Group videos by channel
  const byChannel = new Map<string, typeof assignment.videos>();
  for (const v of assignment.videos) {
    const key = v.channelName;
    if (!byChannel.has(key)) byChannel.set(key, []);
    byChannel.get(key)!.push(v);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-white font-bold text-lg">{profile?.name || 'Profile'}</h2>
            <p className="text-gray-500 text-xs">{assignment.videos.length} videos assigned • {mergedWatchedCount} watched (local + server)</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {[...byChannel.entries()].map(([channelName, videos]) => (
            <div key={channelName}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded bg-red-700 flex items-center justify-center"><span className="text-white" style={{ fontSize: 8 }}>YT</span></div>
                <span className="text-white text-sm font-medium">{channelName}</span>
                <span className="text-xs text-gray-500">({videos.length} videos)</span>
              </div>
              <div className="space-y-1 ml-7">
                {videos.map((v, i) => {
                  const wasWatched =
                    watchHistory.some(h => h.videoId === v.videoId) ||
                    serverNormSet.has(normalizeWatchTitle(v.title));
                  return (
                    <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg ${wasWatched ? 'bg-green-900/20 border border-green-800/30' : 'bg-gray-800'}`}>
                      <span className="text-gray-500 w-4">{i + 1}.</span>
                      <span className={`flex-1 truncate ${wasWatched ? 'text-green-400' : 'text-gray-300'}`}>{v.title}</span>
                      {wasWatched && <CheckCircle size={10} className="text-green-400 flex-shrink-0" />}
                      <button type="button" onClick={() => onRemove(i)} className="text-red-400 text-xs">✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-gray-800">
          <button onClick={onClose} className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-xl text-sm font-medium transition-all">Close</button>
        </div>
      </div>
    </div>
  );
}
