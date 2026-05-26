import { useState, useEffect, useCallback } from 'react';
import {
  Zap, MessageSquare, ThumbsUp, Share2, RefreshCw, XCircle,
  Clock, Plus, Trash2, ChevronDown, ChevronUp, AlertTriangle,
  BookOpen, BarChart2, Search,
} from 'lucide-react';
import type { Profile, Site, Article } from '../types';
import { useSiteStore } from '../store/useSiteStore';

// ── helpers ─────────────────────────────────────────────────────────────────
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getCommentTemplates(): { id: string; text: string }[] {
  try {
    const d = localStorage.getItem('mmb_sites_comments');
    const parsed = d ? JSON.parse(d) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  pending:   { label: 'Pending',   color: 'text-yellow-400', dot: 'bg-yellow-400' },
  running:   { label: 'Running',   color: 'text-blue-400',   dot: 'bg-blue-400 animate-pulse' },
  done:      { label: 'Done',      color: 'text-green-400',  dot: 'bg-green-400' },
  failed:    { label: 'Failed',    color: 'text-red-400',    dot: 'bg-red-400' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500',   dot: 'bg-gray-500' },
};

interface ArticleTarget {
  url: string;
  title: string;
  siteName: string;
}

interface ProfileOverride {
  comment: boolean;
  shareTwitter: boolean;
  shareFacebook: boolean;
  scrollToBottom: boolean;
  clickLinks: boolean;
}

interface EngagementJob {
  id: string;
  profileId: string;
  profileName: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  scheduledAt: number;
  actions: ProfileOverride;
  articles: ArticleTarget[];
  log: { t: number; msg: string }[];
  error?: string;
}

interface QueueStatus {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  jobs: EngagementJob[];
}

interface Props {
  profiles: Profile[];
  sites?: Site[];
  setActiveTab?: (tab: string) => void;
}

export default function EngagementPage({ profiles, sites = [], setActiveTab }: Props) {
  const siteStore = useSiteStore();
  const allSites  = sites.length ? sites : siteStore.sites;

  // Article queue
  const [articleQueue, setArticleQueue]   = useState<ArticleTarget[]>([]);
  const [pickerOpen, setPickerOpen]       = useState(false);
  const [pickerSiteId, setPickerSiteId]   = useState<string | null>(null);
  const [pickerSearch, setPickerSearch]   = useState('');

  // Settings
  const [commentPct,      setCommentPct]      = useState(30);
  const [sharePct,        setSharePct]        = useState(10);
  const [scrollPct,       setScrollPct]       = useState(80);
  const [clickLinksPct,   setClickLinksPct]   = useState(20);
  const [watchPctMin,     setWatchPctMin]     = useState(70);
  const [watchPctMax,     setWatchPctMax]     = useState(100);

  // Per-profile overrides
  const [profileOverrides, setProfileOverrides] = useState<Record<string, ProfileOverride>>({});
  const [selectedIds,      setSelectedIds]      = useState<Set<string>>(new Set());

  // Queue status (local simulation — real backend needs `/api/engagement/*`)
  const [queueStatus,  setQueueStatus]  = useState<QueueStatus | null>(null);
  const [expandedJob,  setExpandedJob]  = useState<string | null>(null);
  const [launching,    setLaunching]    = useState(false);
  const [launchMsg,    setLaunchMsg]    = useState('');

  function makeDefault(): ProfileOverride {
    return {
      comment:        Math.random() * 100 < commentPct,
      shareTwitter:   Math.random() * 100 < sharePct,
      shareFacebook:  Math.random() * 100 < sharePct,
      scrollToBottom: Math.random() * 100 < scrollPct,
      clickLinks:     Math.random() * 100 < clickLinksPct,
    };
  }

  useEffect(() => {
    setSelectedIds(new Set(profiles.map(p => p.id)));
    setProfileOverrides(prev => {
      const next = { ...prev };
      profiles.forEach(p => { if (!next[p.id]) next[p.id] = makeDefault(); });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length]);

  function applyGlobal() {
    setProfileOverrides(prev => {
      const next = { ...prev };
      profiles.forEach(p => { if (selectedIds.has(p.id)) next[p.id] = makeDefault(); });
      return next;
    });
  }

  function setOverride<K extends keyof ProfileOverride>(id: string, key: K, val: ProfileOverride[K]) {
    setProfileOverrides(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? makeDefault()), [key]: val },
    }));
  }

  // Picker
  const activeSites = allSites.filter(s => s.status === 'active');
  const pickerArticles = pickerSiteId
    ? (allSites.find(s => s.id === pickerSiteId)?.articles || [])
        .filter(a => a.enabled && (!pickerSearch || a.title.toLowerCase().includes(pickerSearch.toLowerCase())))
    : [];

  function addToQueue(article: Article, siteName: string) {
    setArticleQueue(prev => [...prev, { url: article.url, title: article.title, siteName }]);
    setPickerOpen(false);
    setPickerSiteId(null);
    setPickerSearch('');
  }

  function shuffleAdd() {
    if (!pickerSiteId) return;
    const site = allSites.find(s => s.id === pickerSiteId);
    if (!site) return;
    const enabled = site.articles.filter(a => a.enabled);
    if (!enabled.length) return;
    addToQueue(enabled[Math.floor(Math.random() * enabled.length)], site.name);
  }

  // Poll queue status from backend (if endpoint exists)
  const pollStatus = useCallback(async () => {
    try {
      const r = await fetch('/backend-api/api/engagement/status');
      if (r.ok) { const d = await r.json(); setQueueStatus(d); }
    } catch {}
  }, []);

  useEffect(() => {
    pollStatus();
    const iv = setInterval(pollStatus, 3000);
    return () => clearInterval(iv);
  }, [pollStatus]);

  async function handleLaunch() {
    if (!articleQueue.length) { setLaunchMsg('❌ Pehle koi article add karo'); return; }
    if (!selectedIds.size)    { setLaunchMsg('❌ Koi profile select nahi'); return; }
    setLaunching(true);
    setLaunchMsg('');

    const sel = profiles.filter(p => selectedIds.has(p.id));
    const templates = getCommentTemplates();
    const maxDelayMs = sel.length * 3 * 60 * 1000;
    const payload = sel.map((p, i) => {
      const ov = profileOverrides[p.id] ?? makeDefault();
      return {
        profileId:   p.id,
        profileName: p.name,
        browserType: p.browserType || 'morelogin',
        delayMs:     rand(Math.floor(i * (maxDelayMs / sel.length)), Math.floor((i + 1) * (maxDelayMs / sel.length))),
        actions:     ov,
        articles:    articleQueue,
        commentText: ov.comment && templates.length > 0 ? templates[rand(0, templates.length - 1)].text : '',
        watchPct:    rand(watchPctMin, watchPctMax),
      };
    });

    try {
      const r = await fetch('/backend-api/api/engagement/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: payload }),
      });
      const data = await r.json();
      if (data.success || data.code === 0) {
        setLaunchMsg(`✅ ${payload.length} jobs queued!`);
        void pollStatus();
      } else {
        setLaunchMsg(`❌ ${data.message || data.error || 'Backend error'}`);
      }
    } catch (err) {
      setLaunchMsg(`❌ Backend not running — start server first`);
    }
    setLaunching(false);
  }

  const selectedProfiles = profiles.filter(p => selectedIds.has(p.id));

  const ACTION_COLS: { key: keyof ProfileOverride; emoji: string; label: string }[] = [
    { key: 'comment',        emoji: '💬', label: 'Comment' },
    { key: 'shareTwitter',   emoji: '🐦', label: 'Twitter' },
    { key: 'shareFacebook',  emoji: '📘', label: 'Facebook' },
    { key: 'scrollToBottom', emoji: '📜', label: 'Scroll' },
    { key: 'clickLinks',     emoji: '🔗', label: 'Links' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Zap size={22} className="text-yellow-400" /> Article Engagement
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Profiles → Article pages → comment / share / scroll — human-like staggered timing
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {setActiveTab && (
            <button onClick={() => setActiveTab('analytics')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-900/30 border border-blue-700/40 text-blue-400 text-xs font-medium hover:bg-blue-900/50 transition-all">
              <BarChart2 size={13} /> View Analytics →
            </button>
          )}
          {queueStatus && (queueStatus.pending > 0 || queueStatus.running > 0) && (
            <button onClick={async () => { await fetch('/backend-api/api/engagement/cancel', { method: 'POST' }); void pollStatus(); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-900/30 border border-red-700/40 text-red-400 text-xs font-medium hover:bg-red-900/50">
              <XCircle size={13} /> Cancel All
            </button>
          )}
        </div>
      </div>

      {/* Section 1: Article Queue */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <BookOpen size={15} className="text-green-400" />
            Article Queue
            {articleQueue.length > 0 && (
              <span className="text-xs text-gray-500 font-normal">
                — {articleQueue.length} article{articleQueue.length !== 1 ? 's' : ''} · {articleQueue.length} tab{articleQueue.length !== 1 ? 's' : ''} per profile
              </span>
            )}
          </h2>
          <button onClick={() => setPickerOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
              pickerOpen ? 'bg-red-900/30 border-red-600/40 text-red-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
            }`}>
            <Plus size={12} /> Add Article
            {pickerOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>

        {articleQueue.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {articleQueue.map((a, idx) => (
              <div key={idx} className="flex items-center gap-2 px-2 py-1.5 bg-gray-800/70 border border-gray-700/60 rounded-xl">
                <span className="text-xs text-gray-600 font-mono w-4">{idx + 1}</span>
                <div className="min-w-0">
                  <p className="text-xs text-white font-medium truncate max-w-[200px]">{a.title || a.url}</p>
                  <p className="text-[10px] text-gray-500 truncate max-w-[200px]">{a.siteName}</p>
                </div>
                <button onClick={() => setArticleQueue(prev => prev.filter((_, i) => i !== idx))}
                  className="text-gray-600 hover:text-red-400 flex-shrink-0">
                  <XCircle size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {articleQueue.length === 0 && !pickerOpen && (
          <p className="text-xs text-gray-600 text-center py-3">
            Koi article nahi — "Add Article" click karo aur site se article chunno
          </p>
        )}

        {pickerOpen && (
          <div className="border border-gray-700/60 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 p-3 bg-gray-800/40 border-b border-gray-700/50">
              <BookOpen size={13} className="text-gray-500 flex-shrink-0" />
              <select value={pickerSiteId ?? ''} onChange={e => { setPickerSiteId(e.target.value || null); setPickerSearch(''); }}
                className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none">
                <option value="">— Site select karo —</option>
                {activeSites.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.articles.filter(a => a.enabled).length} articles)</option>
                ))}
              </select>
              <button onClick={shuffleAdd} disabled={!pickerSiteId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-700/40 border border-purple-600/40 text-purple-300 text-xs font-medium disabled:opacity-30 hover:bg-purple-700/60 transition-all flex-shrink-0">
                <RefreshCw size={12} /> Shuffle
              </button>
            </div>
            {pickerSiteId && (
              <>
                <div className="px-3 py-2 bg-gray-800/20 border-b border-gray-700/40">
                  <div className="relative">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type="text" placeholder="Title search..." value={pickerSearch}
                      onChange={e => setPickerSearch(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none" />
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-gray-800/60">
                  {pickerArticles.length === 0 ? (
                    <p className="text-center text-gray-600 text-xs py-5">Koi enabled article nahi mili</p>
                  ) : pickerArticles.map(article => {
                    const site  = allSites.find(s => s.id === pickerSiteId);
                    const added = articleQueue.some(q => q.url === article.url);
                    return (
                      <div key={article.id}
                        onClick={() => !added && addToQueue(article, site?.name ?? '')}
                        className={`flex items-center gap-3 px-3 py-2.5 group transition-all ${added ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-800/50'}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-200 font-medium truncate">{article.title}</p>
                          <p className="text-[10px] text-gray-600 truncate">{article.url}</p>
                        </div>
                        {added ? <span className="text-green-500 text-[10px] flex-shrink-0">✓ Added</span>
                               : <Plus size={13} className="text-gray-600 group-hover:text-gray-300 flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Settings */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold text-sm flex items-center gap-2">
              <MessageSquare size={15} className="text-green-400" /> Engagement Settings
            </h2>
            <button onClick={applyGlobal} className="text-[10px] text-blue-400 hover:text-blue-300 border border-blue-700/30 px-2 py-0.5 rounded">
              Apply % → All
            </button>
          </div>

          {[
            { label: '💬 Comment', value: commentPct, set: setCommentPct, color: 'accent-green-500' },
            { label: '🐦 Share (Twitter)', value: sharePct, set: setSharePct, color: 'accent-blue-400' },
            { label: '📜 Scroll to Bottom', value: scrollPct, set: setScrollPct, color: 'accent-purple-500' },
            { label: '🔗 Click internal links', value: clickLinksPct, set: setClickLinksPct, color: 'accent-orange-400' },
          ].map(({ label, value, set, color }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-36 flex-shrink-0">{label}</span>
              <input type="range" min={0} max={100} step={5} value={value}
                onChange={e => set(Number(e.target.value))} className={`flex-1 ${color}`} />
              <span className="text-white text-xs font-mono w-8 text-right">{value}%</span>
            </div>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Clock size={15} className="text-blue-400" /> Read Depth & Timing
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">⏱ Read % (random per profile)</span>
              <span className="text-white text-xs font-mono bg-gray-800 px-2 py-0.5 rounded">{watchPctMin}–{watchPctMax}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 w-6">Min</span>
              <input type="range" min={10} max={100} step={5} value={watchPctMin}
                onChange={e => { const v = Number(e.target.value); setWatchPctMin(v); if (v > watchPctMax) setWatchPctMax(v); }}
                className="flex-1 accent-blue-500" />
              <span className="text-blue-400 text-xs font-mono w-8 text-right">{watchPctMin}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 w-6">Max</span>
              <input type="range" min={10} max={100} step={5} value={watchPctMax}
                onChange={e => { const v = Number(e.target.value); setWatchPctMax(v); if (v < watchPctMin) setWatchPctMin(v); }}
                className="flex-1 accent-green-500" />
              <span className="text-green-400 text-xs font-mono w-8 text-right">{watchPctMax}%</span>
            </div>
            <p className="text-[10px] text-gray-600">Each profile gets a random read% between min–max</p>
          </div>

          {articleQueue.length > 0 && selectedProfiles.length > 0 && (
            <div className="mt-2 pt-3 border-t border-gray-800 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                <span className="text-gray-500 block">Profiles</span>
                <p className="text-white font-semibold">{selectedProfiles.length}</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                <span className="text-gray-500 block">Articles/profile</span>
                <p className="text-white font-semibold">{articleQueue.length}</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                <span className="text-gray-500 block">Spread over</span>
                <p className="text-white font-semibold">~{Math.round(selectedProfiles.length * 3)} min</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                <span className="text-gray-500 block">Total jobs</span>
                <p className="text-yellow-400 font-semibold">{selectedProfiles.length}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Profile Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Share2 size={14} className="text-green-400" />
            Profiles ({selectedProfiles.length}/{profiles.length})
          </h2>
          <div className="flex items-center gap-3">
            <button onClick={applyGlobal} className="text-xs text-blue-400 hover:text-blue-300">↺ Re-randomize</button>
            <button onClick={() => setSelectedIds(new Set(profiles.map(p => p.id)))} className="text-xs text-gray-400 hover:text-white">All</button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-white">None</button>
          </div>
        </div>

        {profiles.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <AlertTriangle size={28} className="text-yellow-500 mx-auto" />
            <p className="text-gray-400 text-sm font-medium">Koi profile nahi hai</p>
            <p className="text-gray-600 text-xs">Profiles page pe jao aur profiles fetch karo</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800/60 border-b border-gray-700/50">
                  <th className="px-3 py-2.5 text-left w-8" />
                  <th className="px-3 py-2.5 text-left text-gray-500 font-medium">Profile</th>
                  {ACTION_COLS.map(col => (
                    <th key={col.key} className="px-2 py-2.5 text-center text-gray-500 font-medium min-w-[56px]">
                      <span title={col.label}>{col.emoji}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/40">
                {profiles.map(p => {
                  const isSel = selectedIds.has(p.id);
                  const ov    = profileOverrides[p.id];
                  return (
                    <tr key={p.id} className={`transition-all hover:bg-gray-800/30 ${isSel ? '' : 'opacity-40'}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={isSel}
                          onChange={() => setSelectedIds(prev => {
                            const next = new Set(prev);
                            next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                            return next;
                          })}
                          className="accent-green-500 cursor-pointer" />
                      </td>
                      <td className="px-3 py-2.5 text-white font-medium max-w-[140px]">
                        <span className="truncate block">{p.name}</span>
                        <span className="text-[10px] text-gray-600">{p.os}</span>
                      </td>
                      {ACTION_COLS.map(col => (
                        <td key={col.key} className="px-2 py-2.5 text-center">
                          <input type="checkbox" checked={ov?.[col.key] ?? false}
                            onChange={e => setOverride(p.id, col.key, e.target.checked)}
                            className="accent-green-500 cursor-pointer w-3.5 h-3.5" />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Launch */}
      <div className="space-y-2">
        <button onClick={() => void handleLaunch()}
          disabled={launching || !articleQueue.length || !selectedProfiles.length}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-500 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:from-green-500 hover:to-emerald-400 transition-all shadow-lg shadow-green-900/30 flex items-center justify-center gap-2">
          {launching
            ? <><RefreshCw size={15} className="animate-spin" /> Launching…</>
            : <><Zap size={15} />
                Start Engagement — {selectedProfiles.length} profiles
                {articleQueue.length > 0 && ` × ${articleQueue.length} article${articleQueue.length > 1 ? 's' : ''}`}
              </>}
        </button>
        {launchMsg && (
          <p className={`text-sm text-center font-medium ${launchMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {launchMsg}
          </p>
        )}
      </div>

      {/* Live Activity */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Clock size={15} className="text-blue-400" /> Live Activity
            {queueStatus && queueStatus.running > 0 && (
              <span className="inline-flex h-2 w-2 rounded-full bg-blue-400 animate-ping" />
            )}
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            {queueStatus && ([
              { label: 'Pending', val: queueStatus.pending, color: 'text-yellow-400' },
              { label: 'Running', val: queueStatus.running, color: 'text-blue-400'   },
              { label: 'Done',    val: queueStatus.done,    color: 'text-green-400'  },
              { label: 'Failed',  val: queueStatus.failed,  color: 'text-red-400'    },
            ] as const).map(({ label, val, color }) => val > 0 && (
              <span key={label} className={`text-xs font-medium ${color}`}>{val} {label}</span>
            ))}
            <button onClick={() => void pollStatus()}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 ml-1">
              <RefreshCw size={11} /> Refresh
            </button>
            {queueStatus && queueStatus.total > 0 && (
              <button onClick={async () => { await fetch('/backend-api/api/engagement/clear', { method: 'POST' }); void pollStatus(); }}
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400">
                <Trash2 size={11} /> Clear done
              </button>
            )}
          </div>
        </div>

        {(!queueStatus || queueStatus.total === 0) ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-600">
            <ThumbsUp size={28} className="mb-2 opacity-30" />
            <p className="text-xs">No jobs yet — launch engagement to see live activity here</p>
            <p className="text-[10px] mt-1 opacity-60">Polling every 3s · Server: {queueStatus ? '🟢 connected' : '🔴 connecting...'}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {queueStatus.jobs.map((job: EngagementJob) => {
              const cfg    = STATUS_CFG[job.status] ?? STATUS_CFG.pending;
              const isOpen = job.status === 'running' || expandedJob === job.id;
              return (
                <div key={job.id}
                  className={`border rounded-xl overflow-hidden transition-colors ${
                    job.status === 'running' ? 'bg-blue-950/20 border-blue-800/40' :
                    job.status === 'failed'  ? 'bg-red-950/20 border-red-800/40' :
                    job.status === 'done'    ? 'bg-green-950/10 border-green-900/30' :
                    'bg-gray-800/50 border-gray-700/60'
                  }`}>
                  <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
                    onClick={() => setExpandedJob(isOpen && job.status !== 'running' ? null : job.id)}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    <span className="text-white text-xs font-medium flex-1 truncate">{job.profileName}</span>
                    <span className="text-[10px] text-gray-500 flex gap-0.5 flex-shrink-0">
                      {job.actions.comment        && <span title="Comment">💬</span>}
                      {job.actions.shareTwitter   && <span title="Twitter">🐦</span>}
                      {job.actions.shareFacebook  && <span title="Facebook">📘</span>}
                      {job.actions.scrollToBottom && <span title="Scroll">📜</span>}
                      {job.actions.clickLinks     && <span title="Links">🔗</span>}
                    </span>
                    <span className={`text-xs font-semibold flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
                    {job.status !== 'running'
                      ? (isOpen ? <ChevronUp size={13} className="text-gray-500 flex-shrink-0" /> : <ChevronDown size={13} className="text-gray-500 flex-shrink-0" />)
                      : null}
                  </div>
                  {isOpen && (
                    <div className="border-t border-gray-700/40 px-4 py-3 space-y-1 bg-black/20">
                      {job.error && <p className="text-red-400 text-xs bg-red-950/30 px-2 py-1 rounded mb-2 font-mono">❌ {job.error}</p>}
                      {job.log.length === 0 ? (
                        <p className="text-gray-600 text-xs italic">Waiting for first log entry...</p>
                      ) : job.log.map((l, i) => (
                        <p key={i} className="text-xs font-mono flex gap-2 text-gray-400">
                          <span className="text-gray-600 flex-shrink-0">
                            {new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span>{l.msg}</span>
                        </p>
                      ))}
                      {job.status === 'running' && <p className="text-blue-500 text-[10px] font-mono animate-pulse pt-1">▌ running...</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
