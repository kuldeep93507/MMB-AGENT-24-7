import { useState, useEffect } from 'react';
import {
  Users, Play, Clock, Globe, TrendingUp, Activity,
  Eye, BookOpen, AlertTriangle, Zap, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Calendar,
} from 'lucide-react';
import type { Profile, Site, ReadHistory } from '../types';

interface DashboardProps {
  profiles: Profile[];
  sites: Site[];
  readHistory: ReadHistory[];
  setActiveTab: (tab: string) => void;
}

interface LiveAnalytics {
  totalReads: number;
  totalDwellTime: number;
  totalSessions: number;
  adImpressions: number;
  trafficSources: Record<string, number>;
}

interface BackendHealth {
  status: string;
  agents: number;
  schedules: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDwell(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const ALL_TRAFFIC_SOURCES = [
  { key: 'google',     label: 'Google',     icon: '🔍', color: 'bg-blue-500' },
  { key: 'bing',       label: 'Bing',       icon: '🔎', color: 'bg-cyan-500' },
  { key: 'duckduckgo', label: 'DuckDuckGo', icon: '🦆', color: 'bg-orange-500' },
  { key: 'yahoo',      label: 'Yahoo',      icon: '📰', color: 'bg-violet-500' },
  { key: 'direct',     label: 'Direct URL', icon: '🔗', color: 'bg-green-500' },
  { key: 'internal',   label: 'Internal',   icon: '📄', color: 'bg-purple-500' },
  { key: 'backlink',   label: 'Backlink',   icon: '↩️', color: 'bg-pink-500' },
  { key: 'social',     label: 'Social',     icon: '📱', color: 'bg-yellow-500' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard({ profiles, sites, readHistory, setActiveTab }: DashboardProps) {
  const [liveData, setLiveData]           = useState<LiveAnalytics | null>(null);
  const [health, setHealth]               = useState<BackendHealth | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllReads, setShowAllReads]   = useState(false);

  // Poll backend health + analytics every 10s
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [hRes, aRes] = await Promise.all([
          fetch('/backend-api/api/health'),
          fetch('/backend-api/api/analytics'),
        ]);
        if (hRes.ok) {
          const h = await hRes.json();
          setHealth(h);
          setBackendOnline(h.status === 'ok');
        } else {
          setBackendOnline(false);
        }
        if (aRes.ok) setLiveData(await aRes.json());
      } catch {
        setBackendOnline(false);
      }
    };
    fetchAll();
    const t = setInterval(fetchAll, 10000);
    return () => clearInterval(t);
  }, []);

  // ─── Derived stats ──────────────────────────────────────────────────────────

  const running       = profiles.filter(p => p.status === 'running').length;
  const starting      = profiles.filter(p => p.status === 'starting').length;
  const errorProfiles = profiles.filter(p => p.status === 'error');
  const activeSites   = sites.filter(s => s.status === 'active').length;
  const totalArticles = sites.reduce((sum, s) => sum + s.enabledArticles, 0);

  const totalReads     = liveData?.totalReads     ?? readHistory.length;
  const totalDwellTime = liveData?.totalDwellTime ?? readHistory.reduce((s, r) => s + r.dwellTime, 0);
  const adImpressions  = liveData?.adImpressions  ?? 0;

  const now = Date.now();
  const todayHistory  = readHistory.filter(r => now - r.readAt < 86400000);
  const todayReads    = todayHistory.length;
  const todayDwell    = todayHistory.reduce((s, r) => s + r.dwellTime, 0);

  // Traffic sources — prefer backend totals, fallback to local
  const trafficCounts: Record<string, number> = {};
  ALL_TRAFFIC_SOURCES.forEach(({ key }) => {
    trafficCounts[key] = liveData?.trafficSources?.[key]
      ?? readHistory.filter(r => r.trafficSource === key).length;
  });
  const totalSourced = Object.values(trafficCounts).reduce((s, v) => s + v, 0);

  // Active profiles
  const activeProfiles = profiles.filter(p => p.status === 'running' || p.status === 'starting');
  const visibleActive  = showAllActive ? activeProfiles : activeProfiles.slice(0, 6);

  // Recent reads — newest-first
  const sortedReads  = [...readHistory].sort((a, b) => b.readAt - a.readAt);
  const visibleReads = showAllReads ? sortedReads.slice(0, 30) : sortedReads.slice(0, 8);

  // Stats cards
  const runningSubText = starting > 0 ? `${starting} starting…` : running > 0 ? `${running} active` : 'All stopped';
  const runningSubColor = starting > 0 ? 'text-yellow-400' : running > 0 ? 'text-green-400' : 'text-gray-500';

  const stats = [
    {
      label: 'Total Profiles', value: profiles.length,
      icon: Users, colorKey: 'blue',
      sub: `${running} running`, subColor: 'text-green-400',
    },
    {
      label: 'Running Now', value: running + starting,
      icon: Play, colorKey: 'green',
      sub: runningSubText, subColor: runningSubColor,
    },
    {
      label: 'Active Sites', value: activeSites,
      icon: Globe, colorKey: 'emerald',
      sub: `${sites.length} total sites`, subColor: 'text-gray-400',
    },
    {
      label: 'Total Articles', value: totalArticles,
      icon: BookOpen, colorKey: 'purple',
      sub: `${sites.reduce((s, si) => s + si.totalArticles, 0)} in pool`, subColor: 'text-purple-300',
    },
    {
      label: 'Total Reads', value: totalReads,
      icon: Eye, colorKey: 'yellow',
      sub: `${todayReads} today`, subColor: 'text-yellow-300',
    },
    {
      label: 'Total Dwell', value: fmtDwell(totalDwellTime),
      icon: Clock, colorKey: 'red',
      sub: `${adImpressions} ad impressions`, subColor: 'text-red-300',
    },
  ];

  const colorMap: Record<string, string> = {
    blue:    'from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400',
    green:   'from-green-500/20 to-green-600/10 border-green-500/30 text-green-400',
    emerald: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400',
    purple:  'from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-400',
    yellow:  'from-yellow-500/20 to-yellow-600/10 border-yellow-500/30 text-yellow-400',
    red:     'from-red-500/20 to-red-600/10 border-red-500/30 text-red-400',
  };

  const iconBg: Record<string, string> = {
    blue: 'bg-blue-500/15', green: 'bg-green-500/15', emerald: 'bg-emerald-500/15',
    purple: 'bg-purple-500/15', yellow: 'bg-yellow-500/15', red: 'bg-red-500/15',
  };

  // Tech stack real statuses
  const techStack = [
    {
      name: 'Sites Backend',
      status: backendOnline === null ? 'Checking…' : backendOnline ? 'Running' : 'Offline',
      ok: backendOnline === true,
      desc: backendOnline && health ? `${health.agents} agents` : 'localhost:3200',
    },
    {
      name: 'Playwright CDP',
      status: backendOnline ? 'Active' : 'Unknown',
      ok: backendOnline === true,
      desc: 'Browser Control',
    },
    {
      name: 'Active Schedules',
      status: health ? `${health.schedules} running` : '—',
      ok: (health?.schedules ?? 0) > 0,
      desc: 'Cron Jobs',
    },
    {
      name: 'Smartproxy',
      status: 'Configured',
      ok: true,
      desc: 'us.smartproxy.net',
    },
    {
      name: 'RSS / Sitemap',
      status: `${totalArticles} articles`,
      ok: totalArticles > 0,
      desc: 'Article Fetcher',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Real-time overview of your Sites automation</p>
        </div>
        <div className={`flex items-center gap-2 border rounded-xl px-4 py-2 transition-colors ${
          backendOnline === true  ? 'bg-gray-800 border-green-700/40' :
          backendOnline === false ? 'bg-red-900/20 border-red-700/40' :
                                    'bg-gray-800 border-gray-700'}`}>
          <div className={`w-2 h-2 rounded-full ${
            backendOnline === true  ? 'bg-green-500 animate-pulse' :
            backendOnline === false ? 'bg-red-500' :
                                      'bg-gray-500 animate-pulse'}`} />
          <span className={`text-sm font-medium ${
            backendOnline === true  ? 'text-gray-300' :
            backendOnline === false ? 'text-red-400' :
                                      'text-gray-500'}`}>
            {backendOnline === true ? 'Live Monitoring' : backendOnline === false ? 'Backend Offline' : 'Connecting…'}
          </span>
        </div>
      </div>

      {/* Error profiles alert */}
      {errorProfiles.length > 0 && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-2xl px-5 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <span className="text-red-300 text-sm font-medium">{errorProfiles.length} profile{errorProfiles.length > 1 ? 's' : ''} in error state: </span>
            <span className="text-red-400 text-xs">{errorProfiles.map(p => p.name).join(', ')}</span>
          </div>
          <button onClick={() => setActiveTab('profiles')}
            className="text-xs text-red-400 hover:text-red-300 border border-red-700/40 px-3 py-1 rounded-lg transition-colors flex-shrink-0">
            Fix →
          </button>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map(({ label, value, icon: Icon, colorKey, sub, subColor }) => (
          <div key={label} className={`bg-gradient-to-br ${colorMap[colorKey]} border rounded-2xl p-5`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">{label}</p>
                <p className="text-3xl font-bold text-white mt-1">{value}</p>
                <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl ${iconBg[colorKey]} flex items-center justify-center flex-shrink-0`}>
                <Icon size={20} className={colorMap[colorKey].split(' ').find(c => c.startsWith('text-')) || 'text-gray-400'} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Today's Summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Calendar size={16} className="text-cyan-400" /> Today's Summary
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center bg-gray-800/40 rounded-xl py-3">
            <div className="text-2xl font-bold text-green-400">{todayReads}</div>
            <div className="text-xs text-gray-500 mt-1">Articles Read</div>
          </div>
          <div className="text-center bg-gray-800/40 rounded-xl py-3">
            <div className="text-2xl font-bold text-blue-400">{fmtDwell(todayDwell)}</div>
            <div className="text-xs text-gray-500 mt-1">Dwell Time</div>
          </div>
          <div className="text-center bg-gray-800/40 rounded-xl py-3">
            <div className="text-2xl font-bold text-purple-400">{running + starting}</div>
            <div className="text-xs text-gray-500 mt-1">Active Profiles</div>
          </div>
          <div className="text-center bg-gray-800/40 rounded-xl py-3">
            <div className="text-2xl font-bold text-orange-400">{adImpressions}</div>
            <div className="text-xs text-gray-500 mt-1">Ad Impressions</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Zap size={16} className="text-yellow-400" /> Quick Actions
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'View Profiles',   tab: 'profiles',       icon: Users,       color: 'text-blue-400   border-blue-700/30   hover:bg-blue-900/20' },
            { label: 'Run Scheduler',   tab: 'scheduler',      icon: Play,        color: 'text-green-400  border-green-700/30  hover:bg-green-900/20' },
            { label: 'Article Shuffle', tab: 'article-shuffle',icon: BookOpen,    color: 'text-purple-400 border-purple-700/30 hover:bg-purple-900/20' },
            { label: 'View Analytics',  tab: 'analytics',      icon: TrendingUp,  color: 'text-cyan-400   border-cyan-700/30   hover:bg-cyan-900/20' },
          ].map(({ label, tab, icon: Icon, color }) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border bg-gray-800/40 transition-all ${color}`}>
              <Icon size={20} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Active Profiles */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Activity size={16} className="text-green-400" />
              Active Profiles
              {activeProfiles.length > 0 && (
                <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">{activeProfiles.length}</span>
              )}
            </h2>
            <button onClick={() => setActiveTab('profiles')} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">View All →</button>
          </div>
          {activeProfiles.length === 0 ? (
            <div className="text-center py-8">
              <Users size={32} className="text-gray-700 mx-auto mb-2" />
              <p className="text-gray-600 text-sm">No active profiles</p>
              <button onClick={() => setActiveTab('profiles')}
                className="mt-3 text-xs text-green-400 hover:text-green-300 border border-green-600/30 px-3 py-1.5 rounded-lg transition-colors">
                View Profiles
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {visibleActive.map(p => (
                  <div key={p.id} className="flex items-center gap-3 bg-gray-800/50 rounded-xl px-3 py-2.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500 animate-pulse'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white text-xs font-medium truncate">{p.name}</span>
                        <span className="text-xs text-gray-600 bg-gray-700/50 px-1 rounded flex-shrink-0">{p.os}</span>
                        {p.browserType && (
                          <span className={`text-xs px-1 rounded flex-shrink-0 ${
                            p.browserType === 'multilogin' ? 'text-purple-400' :
                            p.browserType === 'adspower'   ? 'text-green-400' :
                                                             'text-blue-400'}`}>
                            {p.browserType}
                          </span>
                        )}
                      </div>
                      <span className="text-gray-500 text-xs">{p.currentAction || 'Running…'}</span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                      p.status === 'running' ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'}`}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
              {activeProfiles.length > 6 && (
                <button onClick={() => setShowAllActive(v => !v)}
                  className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-white transition-colors py-1">
                  {showAllActive
                    ? <><ChevronUp size={12} /> Show Less</>
                    : <><ChevronDown size={12} /> Show {activeProfiles.length - 6} More</>}
                </button>
              )}
            </>
          )}
        </div>

        {/* Traffic Sources — all 8 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <TrendingUp size={16} className="text-blue-400" />
              Traffic Sources
            </h2>
            <button onClick={() => setActiveTab('analytics')} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">View All →</button>
          </div>
          <div className="space-y-2.5">
            {ALL_TRAFFIC_SOURCES.map(({ key, label, icon, color }) => {
              const val = trafficCounts[key] ?? 0;
              const pct = totalSourced > 0 ? Math.round((val / totalSourced) * 100) : 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-sm w-5 flex-shrink-0">{icon}</span>
                  <span className="text-gray-400 text-xs w-24 flex-shrink-0 truncate">{label}</span>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-white text-xs font-bold w-7 text-right flex-shrink-0">{val}</span>
                  <span className="text-gray-600 text-xs w-8 text-right flex-shrink-0">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tech Stack Status — real health */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Activity size={16} className="text-blue-400" />
          System Status
        </h2>
        <div className="grid grid-cols-5 gap-3">
          {techStack.map(({ name, status, ok, desc }) => (
            <div key={name} className={`rounded-xl p-3 text-center border transition-colors ${
              ok ? 'bg-green-900/10 border-green-800/30' : 'bg-gray-800/60 border-gray-700/50'}`}>
              <div className="flex justify-center mb-2">
                {ok
                  ? <CheckCircle size={14} className="text-green-400" />
                  : <XCircle size={14} className="text-gray-600" />}
              </div>
              <div className="text-white text-xs font-semibold leading-tight">{name}</div>
              <div className={`text-xs mt-1 ${ok ? 'text-green-400' : 'text-gray-500'}`}>{status}</div>
              <div className="text-gray-600 text-xs mt-1 truncate">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Reads — newest-first */}
      {readHistory.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <BookOpen size={16} className="text-emerald-400" />
              Recent Reads
              <span className="text-xs text-gray-500">({readHistory.length} total)</span>
            </h2>
            <button onClick={() => setActiveTab('analytics')} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">View All →</button>
          </div>
          <div className="space-y-1.5">
            {visibleReads.map(r => (
              <div key={r.id} className="flex items-center gap-3 bg-gray-800/50 rounded-xl px-3 py-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-white text-xs font-medium flex-1 truncate">{r.articleTitle}</span>
                <span className="text-blue-400 text-xs flex-shrink-0">{fmtDwell(r.dwellTime)}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 capitalize flex-shrink-0">{r.trafficSource}</span>
                <span className="text-gray-600 text-xs flex-shrink-0">
                  {new Date(r.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
          {readHistory.length > 8 && (
            <button onClick={() => setShowAllReads(v => !v)}
              className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-white transition-colors py-1">
              {showAllReads
                ? <><ChevronUp size={12} /> Show Less</>
                : <><ChevronDown size={12} /> Show More ({readHistory.length - 8} more)</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
