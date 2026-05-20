import { useState, useRef, useCallback } from 'react';
import {
  Shield, RefreshCw, CheckCircle, XCircle, Clock,
  Globe, Copy, X, AlertTriangle, Zap, Filter, ArrowUpDown,
} from 'lucide-react';
import type { Profile } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProxyCheck {
  profileId: string;
  profileName: string;
  os: string;
  browserType: string;
  ip: string;
  city: string;
  region: string;
  country: string;
  isp: string;
  proxyCity: string;
  proxyState: string;
  expiresAt: number;
  speed: number;
  status: 'ok' | 'slow' | 'failed';
  checkedAt: number;
  error?: string;
}

type StatusFilter = 'all' | 'ok' | 'slow' | 'failed';
type SortKey = 'speed' | 'name' | 'status';

interface ProxyHealthPageProps {
  profiles: Profile[];
  onRenewProxy: (profileId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function speedStatus(ms: number): ProxyCheck['status'] {
  if (ms < 400) return 'ok';
  if (ms < 700) return 'slow';
  return 'failed';
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtExpiry(expiresAt: number) {
  const left = expiresAt - Date.now();
  if (left <= 0) return 'Expired';
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

const STORAGE_KEY = 'mmb-proxy-health-results';

function loadSaved(): ProxyCheck[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function saveResults(results: ProxyCheck[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(results)); } catch {}
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProxyHealthPage({ profiles, onRenewProxy }: ProxyHealthPageProps) {
  const [checks, setChecks]         = useState<ProxyCheck[]>(loadSaved);
  const [checking, setChecking]     = useState(false);
  const [progress, setProgress]     = useState({ current: 0, total: 0 });
  const [filter, setFilter]         = useState<StatusFilter>('all');
  const [sortKey, setSortKey]       = useState<SortKey>('status');
  const [copied, setCopied]         = useState<string | null>(null);
  const [recheckId, setRecheckId]   = useState<string | null>(null);
  const cancelledRef                = useRef(false);

  // ─── Run full check ─────────────────────────────────────────────────────────

  const checkOne = useCallback(async (profile: Profile): Promise<ProxyCheck> => {
    const { proxy } = profile;
    const start = Date.now();
    try {
      const res = await fetch('/backend-api/api/proxy/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server:   proxy?.server   || '',
          port:     proxy?.port     || 3120,
          username: proxy?.username || '',
          password: proxy?.password || '',
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      const speed = data.speed ?? (Date.now() - start);
      const status = data.success ? speedStatus(speed) : 'failed';
      return {
        profileId:   profile.id,
        profileName: profile.name,
        os:          profile.os || 'Windows',
        browserType: profile.browserType || 'morelogin',
        ip:          data.ip   || 'Unknown',
        city:        data.city || '',
        region:      data.region || '',
        country:     data.country || '',
        isp:         data.isp  || '',
        proxyCity:   proxy?.city  || '',
        proxyState:  proxy?.state || '',
        expiresAt:   proxy?.expiresAt || 0,
        speed,
        status,
        checkedAt: Date.now(),
        error: data.success ? undefined : (data.error || 'Connection failed'),
      };
    } catch (err: unknown) {
      return {
        profileId:   profile.id,
        profileName: profile.name,
        os:          profile.os || 'Windows',
        browserType: profile.browserType || 'morelogin',
        ip:          'Unknown',
        city: '', region: '', country: '', isp: '',
        proxyCity:   proxy?.city  || '',
        proxyState:  proxy?.state || '',
        expiresAt:   proxy?.expiresAt || 0,
        speed: Date.now() - start,
        status: 'failed',
        checkedAt: Date.now(),
        error: err instanceof Error ? err.message : 'Timeout',
      };
    }
  }, []);

  const runHealthCheck = useCallback(async () => {
    if (profiles.length === 0) return;
    cancelledRef.current = false;
    setChecking(true);
    setProgress({ current: 0, total: profiles.length });
    const results: ProxyCheck[] = [];

    for (let i = 0; i < profiles.length; i++) {
      if (cancelledRef.current) break;
      setProgress({ current: i + 1, total: profiles.length });
      const result = await checkOne(profiles[i]);
      results.push(result);
      // Show incremental results
      setChecks([...results]);
    }

    saveResults(results);
    setChecking(false);
    setProgress({ current: 0, total: 0 });
  }, [profiles, checkOne]);

  const cancelCheck = () => {
    cancelledRef.current = true;
    setChecking(false);
    setProgress({ current: 0, total: 0 });
  };

  // ─── Per-profile recheck ────────────────────────────────────────────────────

  const recheckProfile = useCallback(async (profile: Profile) => {
    setRecheckId(profile.id);
    const result = await checkOne(profile);
    setChecks(prev => {
      const updated = prev.some(c => c.profileId === profile.id)
        ? prev.map(c => c.profileId === profile.id ? result : c)
        : [...prev, result];
      saveResults(updated);
      return updated;
    });
    setRecheckId(null);
  }, [checkOne]);

  // ─── Renew all failed ───────────────────────────────────────────────────────

  const renewAllFailed = () => {
    checks.filter(c => c.status === 'failed').forEach(c => onRenewProxy(c.profileId));
  };

  // ─── Copy IP ────────────────────────────────────────────────────────────────

  const copyIP = (ip: string, id: string) => {
    navigator.clipboard.writeText(ip).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  // ─── Derived data ───────────────────────────────────────────────────────────

  const okCount     = checks.filter(c => c.status === 'ok').length;
  const slowCount   = checks.filter(c => c.status === 'slow').length;
  const failedCount = checks.filter(c => c.status === 'failed').length;
  const avgSpeed    = checks.length > 0 ? Math.round(checks.reduce((s, c) => s + c.speed, 0) / checks.length) : 0;

  const filtered = checks
    .filter(c => filter === 'all' || c.status === filter)
    .sort((a, b) => {
      if (sortKey === 'speed')  return a.speed - b.speed;
      if (sortKey === 'name')   return a.profileName.localeCompare(b.profileName);
      const order = { failed: 0, slow: 1, ok: 2 };
      return order[a.status] - order[b.status];
    });

  const maxSpeed = Math.max(...checks.map(c => c.speed), 1);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Proxy Health</h1>
            <p className="text-gray-500 text-sm mt-0.5">Real IP check & speed test for all profiles</p>
          </div>
          <div className="flex items-center gap-2">
            {failedCount > 0 && (
              <button onClick={renewAllFailed}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-900/30 border border-red-700/40 text-red-400 hover:text-red-300 text-xs font-medium transition-all">
                <RefreshCw size={12} /> Renew All Failed ({failedCount})
              </button>
            )}
            {checking ? (
              <button onClick={cancelCheck}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 border border-red-600/40 text-red-400 hover:text-red-300 text-sm font-semibold transition-all">
                <X size={14} /> Cancel
              </button>
            ) : (
              <button onClick={runHealthCheck} disabled={profiles.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-semibold transition-all">
                <RefreshCw size={15} /> Run Health Check
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {checking && progress.total > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">
                Checking profile {progress.current} of {progress.total}…
              </span>
              <span className="text-xs text-gray-500">{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Stats cards */}
        {checks.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            <div className="border border-green-700/30 bg-green-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-green-400">{okCount}</div>
              <div className="text-xs text-gray-500">Healthy (&lt;400ms)</div>
            </div>
            <div className="border border-yellow-700/30 bg-yellow-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-yellow-400">{slowCount}</div>
              <div className="text-xs text-gray-500">Slow (400–700ms)</div>
            </div>
            <div className="border border-red-700/30 bg-red-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-red-400">{failedCount}</div>
              <div className="text-xs text-gray-500">Failed (&gt;700ms)</div>
            </div>
            <div className="border border-blue-700/30 bg-blue-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-blue-400">{avgSpeed}ms</div>
              <div className="text-xs text-gray-500">Avg Speed</div>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      {checks.length > 0 && (
        <div className="px-6 py-3 border-b border-gray-800/50 flex items-center gap-3 flex-shrink-0">
          <Filter size={13} className="text-gray-500" />
          {(['all', 'ok', 'slow', 'failed'] as StatusFilter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize ${
                filter === f
                  ? f === 'ok' ? 'bg-green-600/30 text-green-400 border border-green-600/40'
                    : f === 'slow' ? 'bg-yellow-600/30 text-yellow-400 border border-yellow-600/40'
                    : f === 'failed' ? 'bg-red-600/30 text-red-400 border border-red-600/40'
                    : 'bg-gray-700 text-white'
                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>
              {f === 'all' ? `All (${checks.length})` : `${f} (${checks.filter(c => c.status === f).length})`}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <ArrowUpDown size={13} className="text-gray-500" />
            {(['status', 'speed', 'name'] as SortKey[]).map(k => (
              <button key={k} onClick={() => setSortKey(k)}
                className={`px-2.5 py-1 rounded-lg text-xs capitalize transition-all ${
                  sortKey === k ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {checks.length === 0 && !checking ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <Shield size={48} className="mb-4 opacity-30" />
            <p className="text-lg font-medium text-gray-500">No health checks yet</p>
            <p className="text-sm mt-1">Click "Run Health Check" to test all {profiles.length} proxy connections</p>
            {profiles.length === 0 && (
              <p className="text-xs text-yellow-500 mt-3">No profiles loaded — go to Profiles page first.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const isRechecking = recheckId === c.profileId;
              const profile = profiles.find(p => p.id === c.profileId);
              const speedPct = Math.round((c.speed / maxSpeed) * 100);

              return (
                <div key={c.profileId} className={`rounded-xl border px-4 py-3 transition-all ${
                  c.status === 'ok'     ? 'bg-green-900/10 border-green-800/30' :
                  c.status === 'slow'   ? 'bg-yellow-900/10 border-yellow-800/30' :
                                          'bg-red-900/10 border-red-800/30'}`}>

                  <div className="flex items-center gap-3">
                    {/* Status icon */}
                    {isRechecking ? (
                      <RefreshCw size={15} className="text-blue-400 animate-spin flex-shrink-0" />
                    ) : c.status === 'ok' ? (
                      <CheckCircle size={15} className="text-green-400 flex-shrink-0" />
                    ) : c.status === 'slow' ? (
                      <Clock size={15} className="text-yellow-400 flex-shrink-0" />
                    ) : (
                      <XCircle size={15} className="text-red-400 flex-shrink-0" />
                    )}

                    {/* Name + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm font-medium truncate">{c.profileName}</span>
                        <span className="text-xs bg-gray-700/60 text-gray-400 px-1.5 py-0.5 rounded flex-shrink-0">{c.os}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                          c.browserType === 'multilogin' ? 'bg-purple-900/40 text-purple-400' :
                          c.browserType === 'adspower'   ? 'bg-green-900/40 text-green-400' :
                                                           'bg-blue-900/40 text-blue-400'}`}>
                          {c.browserType}
                        </span>
                      </div>

                      {/* IP + location row */}
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400 font-mono">{c.ip}</span>
                          <button onClick={() => copyIP(c.ip, c.profileId)}
                            className="text-gray-600 hover:text-gray-300 transition-colors ml-0.5">
                            {copied === c.profileId
                              ? <CheckCircle size={10} className="text-green-400" />
                              : <Copy size={10} />}
                          </button>
                        </div>
                        {(c.city || c.country) && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Globe size={10} /> {[c.city, c.region, c.country].filter(Boolean).join(', ')}
                          </span>
                        )}
                        {c.isp && <span className="text-xs text-gray-600 truncate max-w-36">{c.isp}</span>}
                        {c.error && (
                          <span className="text-xs text-red-400 flex items-center gap-1">
                            <AlertTriangle size={10} /> {c.error}
                          </span>
                        )}
                      </div>

                      {/* Proxy info + expiry */}
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {(c.proxyCity || c.proxyState) && (
                          <span className="text-xs text-gray-600">
                            Proxy: {[c.proxyCity, c.proxyState].filter(Boolean).join(', ')}
                          </span>
                        )}
                        {c.expiresAt > 0 && (
                          <span className={`text-xs ${c.expiresAt < Date.now() ? 'text-red-400' : c.expiresAt - Date.now() < 1800000 ? 'text-yellow-400' : 'text-gray-600'}`}>
                            {fmtExpiry(c.expiresAt)}
                          </span>
                        )}
                        <span className="text-xs text-gray-700">Checked {fmtTime(c.checkedAt)}</span>
                      </div>

                      {/* Speed bar */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              c.status === 'ok' ? 'bg-green-500' : c.status === 'slow' ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${speedPct}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Speed + actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <div className={`text-sm font-bold ${
                          c.status === 'ok' ? 'text-green-400' : c.status === 'slow' ? 'text-yellow-400' : 'text-red-400'}`}>
                          {c.speed}ms
                        </div>
                        <div className="text-xs text-gray-500 uppercase">{c.status}</div>
                      </div>

                      {/* Per-profile recheck */}
                      <button onClick={() => profile && recheckProfile(profile)}
                        disabled={isRechecking || checking}
                        className="p-1.5 rounded-lg bg-gray-800/60 text-gray-500 hover:text-white disabled:opacity-30 transition-colors"
                        title="Recheck this proxy">
                        <Zap size={13} />
                      </button>

                      {/* Renew proxy */}
                      <button onClick={() => onRenewProxy(c.profileId)}
                        className="p-1.5 rounded-lg bg-gray-800/60 text-gray-500 hover:text-blue-400 transition-colors"
                        title="Renew proxy session">
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center py-10 text-gray-600">
                <p>No proxies match the "{filter}" filter.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
