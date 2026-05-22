import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Shuffle, Play, RotateCcw, BookOpen, User, Globe, AlertCircle,
  Settings, RefreshCw, X, StopCircle, Save, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { Profile, Site, Article, ReadHistory } from '../types';
import { useStore } from '../store/useStore';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type TrafficSource = 'random' | 'google' | 'direct' | 'internal' | 'bing' | 'duckduckgo' | 'yahoo' | 'backlinks';
type ScrollSpeed  = 'slow' | 'medium' | 'fast';

interface ReadingPattern {
  scrollSpeed: ScrollSpeed;
  dwellMin: number;        // seconds before first scroll
  dwellMax: number;        // max dwell before moving on
  pauseChance: number;     // 0–1: probability of mid-scroll pause
  chunkPx: number;         // px per scroll step
  useNextPost: boolean;    // click website's next-post button at bottom
}

interface ShuffleAssignment {
  profileId: string;
  profileName: string;
  articles: Article[];
  hasRepeats: boolean; // true = pool was exhausted, older articles recycled
  readingPattern: ReadingPattern;
}

interface ProgressEntry {
  profileId: string;
  status: string;
  articlesRead: number;
}

const TRAFFIC_SOURCES: { value: TrafficSource; label: string; icon: string }[] = [
  { value: 'random',     label: 'Random',    icon: '🎲' },
  { value: 'google',     label: 'Google',    icon: '🔍' },
  { value: 'direct',     label: 'Direct',    icon: '🔗' },
  { value: 'internal',   label: 'Internal',  icon: '↩️' },
  { value: 'bing',       label: 'Bing',      icon: '🔵' },
  { value: 'duckduckgo', label: 'DuckDuckGo',icon: '🦆' },
  { value: 'yahoo',      label: 'Yahoo',     icon: '🟣' },
  { value: 'backlinks',  label: 'Backlinks', icon: '🔙' },
];

function genId() { return Math.random().toString(36).slice(2, 11) + Date.now().toString(36); }

function genReadingPattern(base: ScrollSpeed, useNextPost: boolean): ReadingPattern {
  const speeds: ScrollSpeed[] = ['slow', 'medium', 'fast'];
  // Allow some drift from the base speed so each profile feels different
  const drift = Math.floor(Math.random() * 3);
  const speed = speeds[drift] as ScrollSpeed;
  return {
    scrollSpeed: speed,
    dwellMin:    Math.floor(Math.random() * 20) + 8,      // 8–28s before first scroll
    dwellMax:    Math.floor(Math.random() * 60) + 40,     // 40–100s max dwell
    pauseChance: parseFloat((0.15 + Math.random() * 0.45).toFixed(2)), // 15–60% pause chance
    chunkPx:     Math.floor(Math.random() * 220) + 80,   // 80–300px per scroll step
    useNextPost,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ArticleShufflePageProps {
  profiles: Profile[];
  sites: Site[];
  readHistory: ReadHistory[];
}

export default function ArticleShufflePage({ profiles, sites, readHistory }: ArticleShufflePageProps) {
  const browserProvider = useStore(s => s.browserProvider);
  const setActiveTab    = useStore(s => s.setActiveTab);

  // ── Settings (fix #1, #4, #7 traffic + read/scroll/delay)
  const [trafficSource,   setTrafficSource]   = useState<TrafficSource>('random');
  const [readTimeMin,     setReadTimeMin]      = useState(30);
  const [readTimeMax,     setReadTimeMax]      = useState(300);
  const [scrollSpeed,     setScrollSpeed]      = useState<ScrollSpeed>('medium');
  const [articleDelayMin, setArticleDelayMin]  = useState(20);
  const [articleDelayMax, setArticleDelayMax]  = useState(60);
  const [minPerProfile,   setMinPerProfile]    = useState(2);
  const [maxPerProfile,   setMaxPerProfile]    = useState(5);
  const [oneArticleMode,  setOneArticleMode]   = useState(false);
  const [uniquePatterns,  setUniquePatterns]   = useState(true);
  const [useNextPost,     setUseNextPost]      = useState(true);
  const [settingsOpen,    setSettingsOpen]     = useState(true);

  const [assignments,     setAssignments]      = useState<ShuffleAssignment[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [selectedSites,    setSelectedSites]   = useState<Set<string>>(new Set());

  // ── Fix #2, #14: Run state + live progress
  const [runId,       setRunId]       = useState<string | null>(null);
  const [runStatus,   setRunStatus]   = useState<'idle' | 'running' | 'done'>('idle');
  const [progress,    setProgress]    = useState<ProgressEntry[]>([]);

  // ── Fix #2: Poll backend status while running
  useEffect(() => {
    if (runStatus !== 'running' || !runId) return;
    const t = setInterval(async () => {
      try {
        const res  = await fetch('/backend-api/api/scheduler/status');
        const data = await res.json() as Record<string, { status: string; progress?: ProgressEntry[] }>;
        const srv  = data[runId];
        if (!srv) return;
        if (srv.progress) setProgress(srv.progress);
        if (srv.status === 'completed' || srv.status === 'idle') {
          setRunStatus('done');
          clearInterval(t);
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [runStatus, runId]);

  // ── Available article pool
  const availableArticles = useMemo(() => {
    const target = selectedSites.size > 0
      ? sites.filter(s => s.status === 'active' && selectedSites.has(s.id))
      : sites.filter(s => s.status === 'active');
    return target.flatMap(s => s.articles.filter(a => a.enabled));
  }, [sites, selectedSites]);

  // ── 24h read history
  const recentHistory = useMemo(() => {
    const cutoff = Date.now() - 86_400_000;
    return readHistory.filter(r => r.readAt > cutoff);
  }, [readHistory]);

  const totalAssigned = assignments.reduce((n, a) => n + a.articles.length, 0);
  const poolUsage     = availableArticles.length > 0
    ? Math.round((totalAssigned / availableArticles.length) * 100) : 0;

  // ── Fix #9: Stats — only count actually-selected profiles
  const activeProfileCount = selectedProfiles.size > 0 ? selectedProfiles.size : 0;

  // ── Helpers
  const toggleProfile = (id: string) => setSelectedProfiles(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSite = (id: string) => setSelectedSites(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Fix #5, #6: Shuffle with pool-exhaustion fallback and URL-based dedup
  const shuffleForProfile = useCallback((
    profile: Profile,
    usedUrls: Set<string>,
    markUsed: boolean,
    overrideMin?: number,
    overrideMax?: number,
  ): { articles: Article[]; hasRepeats: boolean } => {
    const profileReadUrls = new Set(
      recentHistory.filter(r => r.profileId === profile.id).map(r => r.articleUrl)
    );

    // Fresh: not read by this profile AND not used by another profile in this run
    const fresh = availableArticles.filter(a => !profileReadUrls.has(a.url) && !usedUrls.has(a.url));
    const lo = overrideMin ?? minPerProfile;
    const hi = overrideMax ?? maxPerProfile;
    const count = Math.min(
      Math.floor(Math.random() * (hi - lo + 1)) + lo,
      availableArticles.length,
    );

    let picked: Article[] = [];
    let hasRepeats = false;

    if (fresh.length >= count) {
      picked = [...fresh].sort(() => Math.random() - 0.5).slice(0, count);
    } else {
      // Pool exhausted — use fresh first, then oldest articles (repeat fallback, fix #5)
      picked = [...fresh].sort(() => Math.random() - 0.5);
      if (picked.length < count) {
        const fallback = availableArticles
          .filter(a => !usedUrls.has(a.url) && !picked.some(p => p.url === a.url))
          .sort(() => Math.random() - 0.5)
          .slice(0, count - picked.length);
        picked = [...picked, ...fallback];
        if (fallback.length > 0) hasRepeats = true;
      }
    }

    // Fix #6: Mark used by URL (consistent with history dedup)
    if (markUsed) picked.forEach(a => usedUrls.add(a.url));
    return { articles: picked, hasRepeats };
  }, [availableArticles, recentHistory, minPerProfile, maxPerProfile]);

  const shuffleAll = () => {
    const targetProfiles = selectedProfiles.size > 0
      ? profiles.filter(p => selectedProfiles.has(p.id))
      : profiles;
    if (targetProfiles.length === 0 || availableArticles.length === 0) return;

    const effectiveMin = oneArticleMode ? 1 : minPerProfile;
    const effectiveMax = oneArticleMode ? 1 : maxPerProfile;

    const usedUrls = new Set<string>();
    const result: ShuffleAssignment[] = targetProfiles.map(profile => {
      const { articles, hasRepeats } = shuffleForProfile(
        profile, usedUrls, true,
        effectiveMin, effectiveMax,
      );
      const readingPattern = uniquePatterns
        ? genReadingPattern(scrollSpeed, useNextPost)
        : { scrollSpeed, dwellMin: 10, dwellMax: 60, pauseChance: 0.3, chunkPx: 150, useNextPost };
      return { profileId: profile.id, profileName: profile.name, articles, hasRepeats, readingPattern };
    });
    setAssignments(result);
    setRunStatus('idle');
    setProgress([]);
  };

  // ── Per-profile re-shuffle
  const reshuffleProfile = (profileId: string) => {
    const otherUrls = new Set<string>(
      assignments
        .filter(a => a.profileId !== profileId)
        .flatMap(a => a.articles.map(art => art.url))
    );
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const lo = oneArticleMode ? 1 : minPerProfile;
    const hi = oneArticleMode ? 1 : maxPerProfile;
    const { articles, hasRepeats } = shuffleForProfile(profile, otherUrls, false, lo, hi);
    const readingPattern = uniquePatterns
      ? genReadingPattern(scrollSpeed, useNextPost)
      : { scrollSpeed, dwellMin: 10, dwellMax: 60, pauseChance: 0.3, chunkPx: 150, useNextPost };
    setAssignments(prev =>
      prev.map(a => a.profileId === profileId ? { ...a, articles, hasRepeats, readingPattern } : a)
    );
  };

  // ── Fix #11: Remove one article from a profile's assignment
  const removeArticle = (profileId: string, articleUrl: string) => {
    setAssignments(prev =>
      prev.map(a =>
        a.profileId === profileId
          ? { ...a, articles: a.articles.filter(art => art.url !== articleUrl) }
          : a
      )
    );
  };

  // ── Fix #2, #3: Run — include provider, poll for progress
  const handleRun = async () => {
    if (assignments.length === 0) return;
    const id = 'shuffle_' + Date.now();
    setRunId(id);
    setRunStatus('running');
    setProgress([]);

    try {
      await fetch('/backend-api/api/scheduler/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: 'Article Shuffle Run',
          provider: browserProvider || 'morelogin',
          trafficSource,
          readTimeMin,
          readTimeMax,
          scrollSpeed,
          articleDelayMin,
          articleDelayMax,
          useNextPost,
          assignments: assignments.map(a => ({
            profileId:      a.profileId,
            articles:       a.articles.map(art => ({ url: art.url, title: art.title })),
            readingPattern: a.readingPattern,
          })),
        }),
      });
    } catch {
      setRunStatus('idle');
    }
  };

  const handleStop = async () => {
    if (!runId) return;
    try {
      await fetch('/backend-api/api/scheduler/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId: runId }),
      });
    } catch {}
    setRunStatus('idle');
  };

  // ── Fix #12: Save as Schedule → localStorage + navigate
  const saveAsSchedule = () => {
    const schedule = {
      id: genId(),
      name: `Shuffle — ${new Date().toLocaleDateString()}`,
      provider: browserProvider || 'morelogin',
      selectedProfiles: assignments.map(a => a.profileId),
      selectedSites: [...selectedSites],
      profileDelayMin: 5,  profileDelayMax: 30,
      articleDelayMin, articleDelayMax,
      readTimeMin, readTimeMax,
      scrollSpeed, articlesPerSession: maxPerProfile,
      runMode: 'manual', scheduledTime: '',
      repeatEnabled: false, repeatInterval: '6hr',
      trafficSource,
      status: 'idle',
      createdAt: new Date().toISOString().split('T')[0],
      lastRun: null, nextRun: null,
      // Include pre-resolved per-profile assignments
      assignments: assignments.map(a => ({
        profileId: a.profileId,
        articles: a.articles.map(art => ({ url: art.url, title: art.title })),
      })),
    };
    try {
      const existing = JSON.parse(localStorage.getItem('mmb_sites_schedules') || '[]');
      localStorage.setItem('mmb_sites_schedules', JSON.stringify([...existing, schedule]));
    } catch {}
    setActiveTab('scheduler');
  };

  const zeroArticleProfiles = assignments.filter(a => a.articles.length === 0);
  const repeatProfiles      = assignments.filter(a => a.hasRepeats);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Article Shuffle</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Auto-assign unique articles to profiles — no overlap, 24h history
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={shuffleAll} disabled={availableArticles.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold transition-all">
              <Shuffle size={15} /> Shuffle
            </button>
            {assignments.length > 0 && runStatus !== 'running' && (
              <>
                <button onClick={saveAsSchedule} title="Save as a Schedule"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-sm font-semibold transition-all">
                  <Save size={15} /> Save as Schedule
                </button>
                <button onClick={handleRun}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold transition-all">
                  <Play size={15} /> Run All
                </button>
              </>
            )}
            {runStatus === 'running' && (
              <button onClick={handleStop}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold transition-all">
                <StopCircle size={15} /> Stop
              </button>
            )}
          </div>
        </div>

        {/* ── Stats — fix #9 ── */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Articles in Pool', val: availableArticles.length, color: 'border-emerald-700/30 bg-emerald-900/10', textColor: 'text-emerald-400' },
            { label: 'Profiles Selected', val: activeProfileCount, color: 'border-blue-700/30 bg-blue-900/10', textColor: 'text-blue-400' },
            { label: 'Assigned', val: totalAssigned, color: 'border-green-700/30 bg-green-900/10', textColor: 'text-green-400' },
            { label: 'Pool Usage', val: `${poolUsage}%`, color: 'border-purple-700/30 bg-purple-900/10', textColor: 'text-purple-400' },
            { label: '24h History', val: recentHistory.length, color: 'border-orange-700/30 bg-orange-900/10', textColor: 'text-orange-400' },
          ].map(s => (
            <div key={s.label} className={`border rounded-xl p-3 ${s.color}`}>
              <div className={`text-xl font-bold ${s.textColor}`}>{s.val}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* ── Live Progress (fix #14) ── */}
        {(runStatus === 'running' || runStatus === 'done') && (
          <div className={`border rounded-2xl p-4 ${runStatus === 'running' ? 'border-green-700/40 bg-green-900/10' : 'border-blue-700/40 bg-blue-900/10'}`}>
            <div className="flex items-center gap-2 mb-3">
              {runStatus === 'running'
                ? <><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="text-green-400 text-sm font-semibold">Running…</span></>
                : <><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-blue-400 text-sm font-semibold">Completed</span></>
              }
              {progress.length > 0 && (
                <span className="text-xs text-gray-500 ml-auto">
                  {progress.filter(p => p.status === 'done' || p.status === 'error').length}/{progress.length} profiles
                  · {progress.reduce((n, p) => n + (p.articlesRead || 0), 0)} articles read
                </span>
              )}
            </div>
            {progress.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {progress.map((p, i) => {
                  const COLOR: Record<string, string> = {
                    starting: 'text-yellow-400', connected: 'text-blue-400',
                    reading: 'text-green-400', done: 'text-emerald-400',
                    error: 'text-red-400', skipped: 'text-gray-500',
                  };
                  return (
                    <span key={i} className={`text-xs px-2 py-0.5 rounded-full bg-gray-800 ${COLOR[p.status] || 'text-gray-400'}`}>
                      {p.profileId.slice(-6)} · {p.status}{p.articlesRead ? ` (${p.articlesRead})` : ''}
                    </span>
                  );
                })}
              </div>
            )}
            {progress.length === 0 && runStatus === 'running' && (
              <p className="text-xs text-gray-500">Waiting for first profile to start…</p>
            )}
          </div>
        )}

        {/* ── Warnings (fix #5, #8) ── */}
        {zeroArticleProfiles.length > 0 && (
          <div className="flex items-start gap-3 bg-red-900/20 border border-red-700/40 rounded-xl p-3">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 text-sm font-semibold">
                {zeroArticleProfiles.length} profile{zeroArticleProfiles.length > 1 ? 's' : ''} got 0 articles — pool exhausted
              </p>
              <p className="text-red-400/70 text-xs mt-0.5">
                {zeroArticleProfiles.map(a => a.profileName).join(', ')}
              </p>
            </div>
          </div>
        )}
        {repeatProfiles.length > 0 && (
          <div className="flex items-start gap-3 bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3">
            <AlertCircle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-yellow-400 text-sm">
              <span className="font-semibold">{repeatProfiles.length} profile{repeatProfiles.length > 1 ? 's' : ''}</span> got some already-read articles (pool was low — oldest recycled)
            </p>
          </div>
        )}

        {/* ── Settings panel (collapsible) ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <button onClick={() => setSettingsOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/50 transition-all">
            <Settings size={14} className="text-gray-400" />
            <span className="text-white font-semibold text-sm">Shuffle Settings</span>
            <span className="ml-auto text-gray-500">
              {settingsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>

          {settingsOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-800">

              {/* Mode toggle row */}
              <div className="flex items-center gap-3 pt-3 flex-wrap">
                {/* 1 article per profile mode */}
                <button onClick={() => setOneArticleMode(o => !o)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all
                    ${oneArticleMode
                      ? 'bg-amber-600/20 border-amber-500/60 text-amber-300'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                  <span>{oneArticleMode ? '1️⃣' : '📄'}</span>
                  {oneArticleMode ? '1 Article / Profile (ON)' : '1 Article / Profile'}
                </button>

                {/* Unique reading patterns toggle */}
                <button onClick={() => setUniquePatterns(o => !o)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all
                    ${uniquePatterns
                      ? 'bg-purple-600/20 border-purple-500/60 text-purple-300'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                  <span>🎭</span>
                  Unique Patterns per Profile {uniquePatterns ? '(ON)' : '(OFF)'}
                </button>

                {/* Use next-post navigation */}
                <button onClick={() => setUseNextPost(o => !o)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all
                    ${useNextPost
                      ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                  <span>⏭</span>
                  Next-Post Navigation {useNextPost ? '(ON)' : '(OFF)'}
                </button>

                <div className="flex-1" />
                {/* Pool usage bar */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Pool:</span>
                  <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${poolUsage > 80 ? 'bg-red-500' : poolUsage > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(poolUsage, 100)}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">{poolUsage}%</span>
                </div>
              </div>

              {/* Articles per profile — hidden when oneArticleMode */}
              {!oneArticleMode && (
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs">Min articles/profile:</span>
                  <input type="number" value={minPerProfile} onChange={e => setMinPerProfile(Number(e.target.value))} min={1} max={50}
                    className="w-14 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs text-center outline-none focus:border-green-500" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs">Max articles/profile:</span>
                  <input type="number" value={maxPerProfile} onChange={e => setMaxPerProfile(Number(e.target.value))} min={1} max={50}
                    className="w-14 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs text-center outline-none focus:border-green-500" />
                </div>
              </div>
              )}

              {/* Fix #1: Traffic source */}
              <div>
                <p className="text-gray-500 text-xs mb-2 font-medium">Traffic Source</p>
                <div className="grid grid-cols-8 gap-1.5">
                  {TRAFFIC_SOURCES.map(src => (
                    <button key={src.value} onClick={() => setTrafficSource(src.value)}
                      className={`p-2 rounded-xl border text-center flex flex-col items-center gap-0.5 transition-all
                        ${trafficSource === src.value
                          ? 'border-green-500 bg-green-900/20 text-green-400'
                          : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600'}`}>
                      <span className="text-sm">{src.icon}</span>
                      <span className="text-[9px] leading-none">{src.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Fix #4: Read time + scroll + delays */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-gray-500 text-xs mb-2 font-medium">Read Time (sec)</p>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={readTimeMin} onChange={e => setReadTimeMin(Number(e.target.value))} min={5}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-green-500" placeholder="Min" />
                    <span className="text-gray-600 text-xs">–</span>
                    <input type="number" value={readTimeMax} onChange={e => setReadTimeMax(Number(e.target.value))} min={5}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-green-500" placeholder="Max" />
                  </div>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-2 font-medium">Article Delay (sec)</p>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={articleDelayMin} onChange={e => setArticleDelayMin(Number(e.target.value))} min={0}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-green-500" placeholder="Min" />
                    <span className="text-gray-600 text-xs">–</span>
                    <input type="number" value={articleDelayMax} onChange={e => setArticleDelayMax(Number(e.target.value))} min={0}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-green-500" placeholder="Max" />
                  </div>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-2 font-medium">Scroll Speed</p>
                  <div className="flex gap-1">
                    {(['slow', 'medium', 'fast'] as const).map(sp => (
                      <button key={sp} onClick={() => setScrollSpeed(sp)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs capitalize transition-all
                          ${scrollSpeed === sp
                            ? 'border-blue-500 bg-blue-900/20 text-blue-400'
                            : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600'}`}>
                        {sp}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Profile Selection (fix #13: show status badge) ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold text-sm">
              Profiles
              <span className="text-gray-500 font-normal ml-1">
                ({selectedProfiles.size > 0 ? `${selectedProfiles.size} selected` : 'none — all will be used'})
              </span>
            </h3>
            <div className="flex gap-3">
              <button onClick={() => setSelectedProfiles(new Set(profiles.map(p => p.id)))} className="text-xs text-green-400 hover:text-green-300">All</button>
              <button onClick={() => setSelectedProfiles(new Set())} className="text-xs text-gray-400 hover:text-gray-300">None</button>
            </div>
          </div>
          {profiles.length === 0 ? (
            <p className="text-center text-gray-500 text-sm py-4">No profiles loaded. Go to Profiles tab → Refresh.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {profiles.map(p => {
                const selected    = selectedProfiles.has(p.id);
                const readsToday  = recentHistory.filter(r => r.profileId === p.id).length;
                const statusColor = p.status === 'running' ? 'bg-green-500'
                  : p.status === 'error' ? 'bg-red-500'
                  : p.status === 'starting' ? 'bg-yellow-500'
                  : 'bg-gray-600';
                return (
                  <button key={p.id} onClick={() => toggleProfile(p.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border-2 transition-all text-left
                      ${selected ? 'border-green-500 bg-green-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}>
                    <div className="relative flex-shrink-0">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${selected ? 'bg-green-600' : 'bg-gray-700'}`}>
                        {p.name.charAt(0)}
                      </div>
                      {/* Fix #13: Status dot */}
                      <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-gray-900 ${statusColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs truncate text-white">{p.name}</p>
                      <p className="text-xs text-gray-500">{readsToday} reads today</p>
                    </div>
                    {selected && <span className="text-green-400 text-xs flex-shrink-0">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Site Selection ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold text-sm">
              Sites
              <span className="text-gray-500 font-normal ml-1">
                ({selectedSites.size > 0 ? `${selectedSites.size} selected` : 'none — all active used'})
              </span>
            </h3>
            <div className="flex gap-3">
              <button onClick={() => setSelectedSites(new Set(sites.filter(s => s.status === 'active').map(s => s.id)))}
                className="text-xs text-emerald-400 hover:text-emerald-300">All Active</button>
              <button onClick={() => setSelectedSites(new Set())} className="text-xs text-gray-400 hover:text-gray-300">None</button>
            </div>
          </div>
          {sites.filter(s => s.status === 'active').length === 0 ? (
            <p className="text-center text-gray-500 text-sm py-4">No active sites. Add sites in the Sites tab first.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {sites.filter(s => s.status === 'active').map(site => {
                const selected     = selectedSites.has(site.id);
                const articleCount = site.articles.filter(a => a.enabled).length;
                return (
                  <button key={site.id} onClick={() => toggleSite(site.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left
                      ${selected ? 'border-emerald-500 bg-emerald-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}>
                    <Globe size={16} className={selected ? 'text-emerald-400 flex-shrink-0' : 'text-gray-500 flex-shrink-0'} />
                    <div className="flex-1">
                      <p className="font-medium text-sm text-white">{site.name}</p>
                      <p className="text-xs text-gray-500">{articleCount} enabled articles</p>
                    </div>
                    {selected && <span className="text-emerald-400 text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Assignments (fix #8, #10, #11) ── */}
        {assignments.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-sm">
                Assignments
                <span className="text-gray-500 font-normal ml-1">({totalAssigned} articles → {assignments.length} profiles)</span>
              </h3>
              <button onClick={() => { setAssignments([]); setRunStatus('idle'); }}
                className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
                <RotateCcw size={10} /> Clear
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {assignments.map(a => {
                const progEntry = progress.find(p => p.profileId === a.profileId);

                return (
                  <div key={a.profileId}
                    className={`bg-gray-800 border rounded-xl p-4 ${
                      a.articles.length === 0 ? 'border-red-700/50' : a.hasRepeats ? 'border-yellow-700/40' : 'border-gray-700'
                    }`}>
                    <div className="flex items-center gap-2 mb-3">
                      <User size={12} className="text-green-400 flex-shrink-0" />
                      <span className="text-white text-sm font-medium truncate flex-1">{a.profileName}</span>
                      {/* Fix #8: 0-article badge */}
                      {a.articles.length === 0 && (
                        <span className="text-xs bg-red-900/60 text-red-400 px-1.5 py-0.5 rounded-full flex-shrink-0">No articles</span>
                      )}
                      {a.hasRepeats && a.articles.length > 0 && (
                        <span className="text-xs bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded-full flex-shrink-0">Recycled</span>
                      )}
                      {progEntry && (
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {progEntry.status}{progEntry.articlesRead ? ` (${progEntry.articlesRead})` : ''}
                        </span>
                      )}
                      <span className="text-xs text-gray-500 flex-shrink-0">{a.articles.length} art.</span>
                      {/* Fix #10: Per-profile re-shuffle */}
                      <button onClick={() => reshuffleProfile(a.profileId)} title="Re-shuffle this profile"
                        className="text-gray-500 hover:text-emerald-400 transition-colors flex-shrink-0">
                        <RefreshCw size={12} />
                      </button>
                    </div>

                    {/* Reading pattern badge */}
                    {a.readingPattern && (
                      <div className="flex items-center gap-1.5 flex-wrap mb-2 pb-2 border-b border-gray-700/50">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold
                          ${a.readingPattern.scrollSpeed === 'slow'   ? 'bg-blue-900/40 text-blue-400'
                          : a.readingPattern.scrollSpeed === 'fast'   ? 'bg-orange-900/40 text-orange-400'
                          :                                             'bg-green-900/40 text-green-400'}`}>
                          {a.readingPattern.scrollSpeed === 'slow' ? '🐢 Relaxed' : a.readingPattern.scrollSpeed === 'fast' ? '⚡ Brisk' : '📖 Normal'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-700/60 text-gray-400">
                          dwell {a.readingPattern.dwellMin}–{a.readingPattern.dwellMax}s
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-700/60 text-gray-400">
                          pause {Math.round(a.readingPattern.pauseChance * 100)}%
                        </span>
                        {a.readingPattern.useNextPost && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-900/30 text-blue-400">⏭ next-post</span>
                        )}
                      </div>
                    )}

                    {a.articles.length === 0 ? (
                      <p className="text-xs text-gray-600 italic">Pool exhausted for this profile</p>
                    ) : (
                      <div className="space-y-1">
                        {a.articles.map((article, i) => (
                          <div key={article.id} className="flex items-center gap-2 text-xs group">
                            <span className="text-gray-600 w-4 flex-shrink-0">{i + 1}.</span>
                            <BookOpen size={10} className="text-gray-500 flex-shrink-0" />
                            <span className="text-gray-300 truncate flex-1">{article.title}</span>
                            <button onClick={() => removeArticle(a.profileId, article.url)}
                              className="text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Empty state / first-run hint ── */}
        {assignments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Shuffle size={40} className="mb-4 opacity-20" />
            {availableArticles.length === 0 ? (
              <>
                <p className="text-sm font-medium">No articles in pool</p>
                <p className="text-xs mt-1">Add sites and enable articles first</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">{availableArticles.length} articles ready</p>
                <p className="text-xs mt-1">Select profiles & sites, then click <span className="text-emerald-400">Shuffle</span></p>
              </>
            )}
          </div>
        )}

        {/* ── Rules ── */}
        <div className="bg-gray-800/50 border border-gray-700/60 rounded-xl p-4">
          <h3 className="text-gray-300 text-sm font-medium mb-2">🔀 Shuffle Rules</h3>
          <div className="space-y-1 text-xs text-gray-500">
            <p>1. Same profile ko already-read article dobara nahi milega (24h history)</p>
            <p>2. Ek run mein same article 2 profiles ko nahi milega (URL-based overlap protection)</p>
            <p>3. Pool exhausted → oldest articles recycle hote hain + yellow warning dikhta hai</p>
            <p>4. <span className="text-amber-400 font-medium">1 Article / Profile mode</span> — har profile ko sirf 1 article, phir next-post se naturally navigate karo</p>
            <p>5. <span className="text-purple-400 font-medium">Unique Patterns</span> — same article bhi alag-alag profiles mein alag scroll speed, dwell time, pause frequency se padhega</p>
            <p>6. <span className="text-blue-400 font-medium">Next-Post Navigation</span> — article bottom par website ke Prev/Next buttons click ho jaate hain</p>
            <p>7. Per-profile re-shuffle (🔁) + per-article remove (hover → ✕)</p>
            <p className="text-green-400 mt-2">✅ Har profile ka unique article + unique reading pattern = 100% natural traffic!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
