import { useState, useRef, useCallback } from 'react';
import {
  Shield, RefreshCw, CheckCircle, XCircle, Globe, AlertTriangle,
} from 'lucide-react';
import type { Profile } from '../types';
import { backendUrl } from '../services/backendOrigin';
import { getProxyConfigFromSettings } from '../utils/settingsApi';

interface ProxyCheck {
  profileId: string;
  profileName: string;
  ip: string;
  location: string;
  speed: number;
  status: 'ok' | 'slow' | 'failed';
  checkedAt: number;
  error?: string;
}

interface ProxyHealthPageProps {
  profiles: Profile[];
  onRenewProxy?: (profileId: string) => void;
}

function speedStatus(ms: number): ProxyCheck['status'] {
  if (ms < 400) return 'ok';
  if (ms < 900) return 'slow';
  return 'failed';
}

export default function ProxyHealthPage({ profiles }: ProxyHealthPageProps) {
  const [checks, setChecks] = useState<ProxyCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const cancelledRef = useRef(false);

  const checkOne = useCallback(async (profile: Profile): Promise<ProxyCheck> => {
    const settings = getProxyConfigFromSettings();
    const { proxy } = profile;
    const server = proxy?.server || settings.proxyServer || 'us.smartproxy.net';
    const port = proxy?.port || parseInt(settings.proxyPort || '3120', 10);
    const username = proxy?.username || '';
    const password = proxy?.password || settings.proxyPassword || '';
    const start = Date.now();

    try {
      const res = await fetch(backendUrl('/api/proxy/check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, port, username, password }),
        signal: AbortSignal.timeout(12000),
      });
      const data = await res.json();
      const speed = data.speed ?? (Date.now() - start);
      const ok = !!data.success && data.ip && data.ip !== 'Unknown';
      const location = [data.city, data.region, data.country].filter(Boolean).join(', ') || 'Unknown';
      return {
        profileId: profile.id,
        profileName: profile.name,
        ip: data.ip || 'Unknown',
        location,
        speed,
        status: ok ? speedStatus(speed) : 'failed',
        checkedAt: Date.now(),
        error: ok ? undefined : (data.error || 'Connection failed'),
      };
    } catch (err: unknown) {
      return {
        profileId: profile.id,
        profileName: profile.name,
        ip: '—',
        location: '—',
        speed: Date.now() - start,
        status: 'failed',
        checkedAt: Date.now(),
        error: err instanceof Error ? err.message : 'Check failed',
      };
    }
  }, []);

  const runHealthCheck = async () => {
    if (!profiles.length) return;
    setChecking(true);
    cancelledRef.current = false;
    setProgress({ current: 0, total: profiles.length });
    const results: ProxyCheck[] = [];

    for (let i = 0; i < profiles.length; i++) {
      if (cancelledRef.current) break;
      const result = await checkOne(profiles[i]);
      results.push(result);
      setChecks([...results]);
      setProgress({ current: i + 1, total: profiles.length });
    }

    setChecking(false);
  };

  const okCount = checks.filter((c) => c.status === 'ok').length;
  const slowCount = checks.filter((c) => c.status === 'slow').length;
  const failedCount = checks.filter((c) => c.status === 'failed').length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Proxy Health</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Real proxy check via backend — IP, geo, and latency per profile
            </p>
          </div>
          <button
            onClick={runHealthCheck}
            disabled={checking || profiles.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-semibold transition-all"
          >
            <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
            {checking ? `Checking ${progress.current}/${progress.total}…` : 'Run Health Check'}
          </button>
        </div>

        {checks.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            <StatBox label="Healthy" value={okCount} color="green" />
            <StatBox label="Slow" value={slowCount} color="yellow" />
            <StatBox label="Failed" value={failedCount} color="red" />
            <StatBox label="Checked" value={checks.length} color="blue" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {checks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Shield size={48} className="text-gray-700 mb-4" />
            <p className="text-gray-500">Run a check to test each profile&apos;s proxy through the server.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {checks.map((c) => (
              <div key={c.profileId} className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                <StatusIcon status={c.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium truncate">{c.profileName}</div>
                  <div className="text-gray-500 text-xs flex items-center gap-2 mt-0.5">
                    <Globe size={12} />
                    {c.ip} · {c.location}
                  </div>
                  {c.error && (
                    <div className="text-red-400 text-xs mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} /> {c.error}
                    </div>
                  )}
                </div>
                <div className="text-right text-sm">
                  <div className={c.status === 'ok' ? 'text-green-400' : c.status === 'slow' ? 'text-yellow-400' : 'text-red-400'}>
                    {c.speed}ms
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    green: 'border-green-700/30 bg-green-900/10 text-green-400',
    yellow: 'border-yellow-700/30 bg-yellow-900/10 text-yellow-400',
    red: 'border-red-700/30 bg-red-900/10 text-red-400',
    blue: 'border-blue-700/30 bg-blue-900/10 text-blue-400',
  };
  return (
    <div className={`border rounded-xl p-3 ${colors[color]}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function StatusIcon({ status }: { status: ProxyCheck['status'] }) {
  if (status === 'ok') return <CheckCircle size={18} className="text-green-400 flex-shrink-0" />;
  if (status === 'slow') return <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0" />;
  return <XCircle size={18} className="text-red-400 flex-shrink-0" />;
}
