import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, Eye, Clock, Users, Globe, BarChart3,
  Activity, RefreshCw, Download, Trophy, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { Profile, Site, ReadHistory, RateLimitConfig } from '../types';

interface LiveAnalytics {
  totalReads: number;
  totalDwellTime: number;
  totalSessions: number;
  adImpressions: number;
  perProfile: Record<string, { reads: number; dwellTime: number; comments: number; sessions: number }>;
  perSite: Record<string, { reads: number; dwellTime: number }>;
  trafficSources: Record<string, number>;
  recentActivity: Array<{ profileId: string; action: string; value?: number; time: number }>;
}

interface AnalyticsPageProps {
  profiles: Profile[];
  sites: Site[];
  readHistory: ReadHistory[];
  rateLimits: RateLimitConfig[];
}

const TRAFFIC_SOURCES = [
  { key: 'google',     label: 'Google',      color: 'bg-blue-500',   textColor: 'text-blue-400' },
  { key: 'bing',       label: 'Bing',        color: 'bg-cyan-500',   textColor: 'text-cyan-400' },
  { key: 'duckduckgo', label: 'DuckDuckGo',  color: 'bg-orange-500', textColor: 'text-orange-400' },
  { key: 'yahoo',      label: 'Yahoo',       color: 'bg-violet-500', textColor: 'text-violet-400' },
  { key: 'direct',     label: 'Direct URL',  color: 'bg-green-500',  textColor: 'text-green-400' },
  { key: 'internal',   label: 'Internal',    color: 'bg-purple-500', textColor: 'text-purple-400' },
  { key: 'backlink',   label: 'Backlink',    color: 'bg-pink-500',   textColor: 'text-pink-400' },
  { key: 'social',     label: 'Social',      color: 'bg-yellow-500', textColor: 'text-yellow-400' },
] as const;

function fmtDwell(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function AnalyticsPage({ profiles, sites, readHistory, rateLimits }: AnalyticsPageProps) {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');
  const [liveData, setLiveData] = useState<LiveAnalytics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllProfiles, setShowAllProfiles] = useState(false);
  const [showAllRates, setShowAllRates] = useState(false);

  const fetchAnalytics = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/backend-api/api/analytics');
      if (res.ok) setLiveData(await res.json());
    } catch {}
    if (manual) setTimeout(() => setRefreshing(false), 600);
  }, []);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(() => fetchAnalytics(), 5000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  const now = Date.now();
  const rangeMs = timeRange === '7d' ? 7 * 86400000 : timeRange === '30d' ? 30 * 86400000 : Infinity;
  // Sorted newest-first
  const filtered = readHistory
    .filter(r => now - r.readAt < rangeMs)
    .sort((a, b) => b.readAt - a.readAt);

  // Top-level stats — prefer backend (all-time persistent), fallback to filtered local
  const totalReads = liveData?.totalReads ?? filtered.length;
  const totalDwellTime = liveData?.totalDwellTime ?? filtered.reduce((s, r) => s + r.dwellTime, 0);
  const totalSessions = liveData?.totalSessions ?? 0;
  const adImpressions = liveData?.adImpressions ?? 0;
  const avgDwell = totalReads > 0 ? Math.round(totalDwellTime / totalReads) : 0;

  // Traffic sources — prefer backend totals, fallback to local filtered counts
  const sources: Record<string, number> = {};
  TRAFFIC_SOURCES.forEach(({ key }) => {
    sources[key] = liveData?.trafficSources?.[key] ?? filtered.filter(r => r.trafficSource === key).length;
  });
  const totalSourced = Object.values(sources).reduce((s, v) => s + v, 0);

  // Per-profile stats
  const perProfile = profiles.map(p => {
    const pLive = liveData?.perProfile?.[p.id];
    const pFiltered = filtered.filter(r => r.profileId === p.id);
    return {
      id: p.id,
      name: p.name,
      os: p.os,
      status: p.status,
      reads: pLive?.reads ?? pFiltered.length,
      dwellTime: pLive?.dwellTime ?? pFiltered.reduce((s, r) => s + r.dwellTime, 0),
      comments: pLive?.comments ?? 0,
      sessions: pLive?.sessions ?? 0,
    };
  }).sort((a, b) => b.reads - a.reads);

  const bestProfile = perProfile.find(p => p.reads > 0);

  // Per-site stats — use URL domain matching as fallback (siteId not always saved in history)
  const perSite = sites.map(s => {
    let domain = '';
    try { domain = new URL(s.url).hostname.replace(/^www\./, ''); } catch {}
    // Try by s.id first, then by hostname (backend saves by hostname)
    const liveS = liveData?.perSite?.[s.id]
      || (domain ? liveData?.perSite?.[domain] : undefined)
      || (domain ? liveData?.perSite?.['www.' + domain] : undefined);
    const matchHistory = domain
      ? filtered.filter(r => {
          try { return new URL(r.articleUrl).hostname.replace(/^www\./, '') === domain; } catch { return r.siteId === s.id; }
        })
      : filtered.filter(r => r.siteId === s.id);
    return {
      id: s.id,
      name: s.name,
      reads: liveS?.reads ?? matchHistory.length,
      dwellTime: liveS?.dwellTime ?? matchHistory.reduce((sum, r) => sum + r.dwellTime, 0),
      articles: s.enabledArticles,
    };
  }).sort((a, b) => b.reads - a.reads);

  // Today's stats (always uses full readHistory, not time-filtered)
  const todayHistory = readHistory.filter(r => now - r.readAt < 86400000);
  const todayReads = todayHistory.length;
  const todayDwell = todayHistory.reduce((s, r) => s + r.dwellTime, 0);

  // Reads per day — last 7 days bar chart data
  const readsPerDay = Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (6 - i) * 86400000;
    const dayEnd = dayStart + 86400000;
    const count = readHistory.filter(r => r.readAt >= dayStart && r.readAt < dayEnd).length;
    return { label: new Date(dayStart).toLocaleDateString([], { weekday: 'short' }), count };
  });
  const maxDay = Math.max(...readsPerDay.map(d => d.count), 1);

  // Top articles — group by URL, count reads
  const articleMap: Record<string, { title: string; count: number; totalDwell: number }> = {};
  filtered.forEach(r => {
    const key = r.articleUrl || r.articleTitle || 'unknown';
    if (!articleMap[key]) articleMap[key] = { title: r.articleTitle || key, count: 0, totalDwell: 0 };
    articleMap[key].count++;
    articleMap[key].totalDwell += r.dwellTime;
  });
  const topArticles = Object.values(articleMap).sort((a, b) => b.count - a.count).slice(0, 10);

  // CSV export of full read history
  function exportCSV() {
    const rows: (string | number)[][] = [
      ['Profile', 'Article Title', 'Article URL', 'Traffic Source', 'Dwell Time (s)', 'Read At'],
      ...readHistory.map(r => [
        profiles.find(p => p.id === r.profileId)?.name || r.profileId,
        r.articleTitle || '',
        r.articleUrl || '',
        r.trafficSource || '',
        r.dwellTime,
        new Date(r.readAt).toISOString(),
      ]),
    ];
    const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visibleProfiles = showAllProfiles ? perProfile : perProfile.slice(0, 8);
  const visibleRates = showAllRates ? profiles : profiles.slice(0, 8);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics</h1>
            <p className="text-gray-500 text-sm mt-0.5">Read time stats & traffic performance</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => fetchAnalytics(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <Download size={12} /> Export CSV
            </button>
            {(['7d', '30d', 'all'] as const).map(r => (
              <button key={r} onClick={() => setTimeRange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${timeRange === r ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : 'All Time'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total Reads',    value: totalReads,              icon: Eye,        color: 'text-green-400',   bg: 'border-green-700/30 bg-green-900/10' },
            { label: 'Today Reads',    value: todayReads,              icon: TrendingUp, color: 'text-emerald-400', bg: 'border-emerald-700/30 bg-emerald-900/10' },
            { label: 'Total Dwell',    value: fmtDwell(totalDwellTime), icon: Clock,     color: 'text-blue-400',    bg: 'border-blue-700/30 bg-blue-900/10' },
            { label: 'Avg Dwell',      value: fmtDwell(avgDwell),      icon: Clock,      color: 'text-cyan-400',    bg: 'border-cyan-700/30 bg-cyan-900/10' },
            { label: 'Sessions',       value: totalSessions,           icon: Users,      color: 'text-purple-400',  bg: 'border-purple-700/30 bg-purple-900/10' },
            { label: 'Ad Impressions', value: adImpressions,           icon: Eye,        color: 'text-orange-400',  bg: 'border-orange-700/30 bg-orange-900/10' },
          ].map(s => (
            <div key={s.label} className={`border rounded-2xl p-4 ${s.bg}`}>
              <s.icon size={18} className={`${s.color} mb-2`} />
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-gray-500 text-xs mt-1">{s.label}</div>
              {liveData && <div className="text-xs text-green-500 mt-1 animate-pulse">● Live</div>}
            </div>
          ))}
        </div>

        {/* Traffic Sources + Daily Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 8-Source Traffic Bars */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <BarChart3 size={16} className="text-blue-400" /> Traffic Sources
            </h2>
            <div className="space-y-2.5">
              {TRAFFIC_SOURCES.map(({ key, label, color, textColor }) => {
                const val = sources[key] ?? 0;
                const pct = totalSourced > 0 ? Math.round((val / totalSourced) * 100) : 0;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${textColor}`}>{label}</span>
                      <span className="text-xs text-gray-400">{val} · {pct}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reads Per Day Bar Chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Activity size={16} className="text-cyan-400" /> Reads Per Day
              <span className="text-xs text-gray-500">(last 7 days)</span>
            </h2>
            <div className="flex items-end gap-2 h-28 mt-2">
              {readsPerDay.map(({ label, count }) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="text-xs text-gray-400 h-4">{count > 0 ? count : ''}</div>
                  <div className="w-full flex items-end justify-center">
                    <div
                      className="w-full bg-green-500 rounded-t transition-all"
                      style={{ height: `${Math.max(Math.round((count / maxDay) * 72), count > 0 ? 4 : 0)}px` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Per-Profile Performance */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Users size={16} className="text-blue-400" /> Per-Profile Performance
            {liveData && <span className="text-xs text-green-400 animate-pulse">● Live</span>}
          </h2>
          {perProfile.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No profiles yet</p>
          ) : (
            <>
              <div className="space-y-2">
                {visibleProfiles.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3 bg-gray-800/50 rounded-xl px-4 py-2.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                    {i === 0 && bestProfile && <Trophy size={12} className="text-yellow-400 flex-shrink-0" />}
                    <span className="text-white text-sm font-medium flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-gray-500 bg-gray-700/60 px-1.5 py-0.5 rounded flex-shrink-0">{p.os}</span>
                    <span className="text-green-400 text-xs font-bold flex-shrink-0">{p.reads} reads</span>
                    <span className="text-blue-400 text-xs flex-shrink-0">{fmtDwell(p.dwellTime)}</span>
                    <span className="text-gray-500 text-xs flex-shrink-0">{p.comments} cmts</span>
                  </div>
                ))}
              </div>
              {perProfile.length > 8 && (
                <button onClick={() => setShowAllProfiles(v => !v)}
                  className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-white transition-colors py-1">
                  {showAllProfiles
                    ? <><ChevronUp size={12} /> Show Less</>
                    : <><ChevronDown size={12} /> Show {perProfile.length - 8} More</>}
                </button>
              )}
            </>
          )}
        </div>

        {/* Top Articles */}
        {topArticles.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-400" /> Top Articles
              <span className="text-xs text-gray-500">
                ({timeRange === '7d' ? '7 Days' : timeRange === '30d' ? '30 Days' : 'All Time'})
              </span>
            </h2>
            <div className="space-y-2">
              {topArticles.map((a, i) => (
                <div key={i} className="flex items-center gap-3 bg-gray-800/50 rounded-xl px-4 py-2.5">
                  <span className="text-gray-500 text-xs w-5 text-right flex-shrink-0">{i + 1}.</span>
                  <span className="text-white text-sm flex-1 truncate">{a.title}</span>
                  <span className="text-green-400 text-xs font-bold flex-shrink-0">{a.count}×</span>
                  <span className="text-blue-400 text-xs flex-shrink-0">{fmtDwell(a.totalDwell)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-Site Performance */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Globe size={16} className="text-emerald-400" /> Per-Site Performance
          </h2>
          {perSite.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No sites yet</p>
          ) : (
            <div className="space-y-2">
              {perSite.map(s => (
                <div key={s.id} className="flex items-center gap-3 bg-gray-800/50 rounded-xl px-4 py-2.5">
                  <Globe size={14} className="text-emerald-400 flex-shrink-0" />
                  <span className="text-white text-sm font-medium flex-1 truncate">{s.name}</span>
                  <span className="text-xs text-gray-500 flex-shrink-0">{s.articles} articles</span>
                  <span className="text-emerald-400 text-xs font-bold flex-shrink-0">{s.reads} reads</span>
                  <span className="text-blue-400 text-xs flex-shrink-0">{fmtDwell(s.dwellTime)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Today's Activity */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Activity size={16} className="text-cyan-400" /> Today's Activity
          </h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{todayReads}</div>
              <div className="text-gray-500 text-xs">Articles Read</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{fmtDwell(todayDwell)}</div>
              <div className="text-gray-500 text-xs">Dwell Time</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{profiles.filter(p => p.status === 'running').length}</div>
              <div className="text-gray-500 text-xs">Active Profiles</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-400">{adImpressions}</div>
              <div className="text-gray-500 text-xs">Ad Impressions</div>
            </div>
          </div>
        </div>

        {/* Daily Rate Limits */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-yellow-400" /> Daily Rate Limits
          </h2>
          <p className="text-xs text-gray-500 mb-4">Per-profile daily read caps to keep traffic natural</p>
          {profiles.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No profiles yet</p>
          ) : (
            <>
              <div className="space-y-2">
                {visibleRates.map(p => {
                  const rl = rateLimits.find(r => r.profileId === p.id);
                  const cap = rl?.dailyReadCap ?? 20;
                  const pReads = rl?.readsToday ?? todayHistory.filter(r => r.profileId === p.id).length;
                  const pct = cap > 0 ? Math.min(100, Math.round((pReads / cap) * 100)) : 0;
                  return (
                    <div key={p.id} className="bg-gray-800/50 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white text-xs font-medium">{p.name}</span>
                        <span className={`text-xs font-bold ${pct >= 100 ? 'text-red-400' : pct > 70 ? 'text-yellow-400' : 'text-green-400'}`}>
                          {pReads}/{cap} reads
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {profiles.length > 8 && (
                <button onClick={() => setShowAllRates(v => !v)}
                  className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-white transition-colors py-1">
                  {showAllRates
                    ? <><ChevronUp size={12} /> Show Less</>
                    : <><ChevronDown size={12} /> Show {profiles.length - 8} More</>}
                </button>
              )}
            </>
          )}
        </div>

        {/* Recent Reads — sorted newest-first, no cap */}
        {filtered.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              Recent Reads
              <span className="text-xs text-gray-500">({filtered.length} total)</span>
            </h2>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {filtered.map(r => (
                <div key={r.id} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded-lg hover:bg-gray-800/50">
                  <span className="text-gray-500 w-24 flex-shrink-0">
                    {new Date(r.readAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                    {new Date(r.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-gray-300 flex-1 truncate">{r.articleTitle}</span>
                  <span className="text-blue-400 flex-shrink-0">{fmtDwell(r.dwellTime)}</span>
                  <span className="text-emerald-400 capitalize flex-shrink-0">{r.trafficSource}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
