import { useState } from 'react';
import { Shield, RefreshCw, CheckCircle, XCircle, Clock, Globe } from 'lucide-react';
import type { Profile } from '../types';

interface ProxyCheck {
  profileId: string;
  profileName: string;
  ip: string;
  location: string;
  speed: number; // ms
  status: 'ok' | 'slow' | 'failed' | 'leak';
  checkedAt: number;
}

interface ProxyHealthPageProps {
  profiles: Profile[];
}

export default function ProxyHealthPage({ profiles }: ProxyHealthPageProps) {
  const [checks, setChecks] = useState<ProxyCheck[]>([]);
  const [checking, setChecking] = useState(false);

  const runHealthCheck = async () => {
    setChecking(true);
    const results: ProxyCheck[] = [];

    for (const profile of profiles) {
      // Simulate proxy check (in real app, backend would test each proxy)
      await new Promise(r => setTimeout(r, 300));
      const speed = Math.floor(Math.random() * 800) + 100;
      const status = speed > 600 ? 'slow' : speed > 900 ? 'failed' : 'ok';
      results.push({
        profileId: profile.id,
        profileName: profile.name,
        ip: profile.ip || `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        location: `${profile.proxy.city}, ${profile.proxy.state}`,
        speed,
        status: status as any,
        checkedAt: Date.now(),
      });
    }

    setChecks(results);
    setChecking(false);
  };

  const okCount = checks.filter(c => c.status === 'ok').length;
  const slowCount = checks.filter(c => c.status === 'slow').length;
  const failedCount = checks.filter(c => c.status === 'failed').length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Proxy Health</h1>
            <p className="text-gray-500 text-sm mt-0.5">Speed test & IP leak detection for all profiles</p>
          </div>
          <button onClick={runHealthCheck} disabled={checking || profiles.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-semibold transition-all">
            <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking...' : 'Run Health Check'}
          </button>
        </div>

        {checks.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            <div className="border border-green-700/30 bg-green-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-green-400">{okCount}</div>
              <div className="text-xs text-gray-500">Healthy</div>
            </div>
            <div className="border border-yellow-700/30 bg-yellow-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-yellow-400">{slowCount}</div>
              <div className="text-xs text-gray-500">Slow</div>
            </div>
            <div className="border border-red-700/30 bg-red-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-red-400">{failedCount}</div>
              <div className="text-xs text-gray-500">Failed</div>
            </div>
            <div className="border border-blue-700/30 bg-blue-900/10 rounded-xl p-3">
              <div className="text-xl font-bold text-blue-400">{profiles.length}</div>
              <div className="text-xs text-gray-500">Total Proxies</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {checks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <Shield size={48} className="mb-4 opacity-30" />
            <p className="text-lg font-medium">No health checks yet</p>
            <p className="text-sm mt-1">Click "Run Health Check" to test all proxy connections</p>
          </div>
        ) : (
          <div className="space-y-2">
            {checks.map(c => (
              <div key={c.profileId} className={`flex items-center gap-4 rounded-xl px-4 py-3 border transition-all ${
                c.status === 'ok' ? 'bg-green-900/10 border-green-800/30' :
                c.status === 'slow' ? 'bg-yellow-900/10 border-yellow-800/30' :
                'bg-red-900/10 border-red-800/30'}`}>
                {c.status === 'ok' ? <CheckCircle size={16} className="text-green-400" /> :
                 c.status === 'slow' ? <Clock size={16} className="text-yellow-400" /> :
                 <XCircle size={16} className="text-red-400" />}
                <div className="flex-1">
                  <span className="text-white text-sm font-medium">{c.profileName}</span>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-500 font-mono">{c.ip}</span>
                    <span className="text-xs text-gray-500 flex items-center gap-1"><Globe size={10} /> {c.location}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-bold ${c.speed < 300 ? 'text-green-400' : c.speed < 600 ? 'text-yellow-400' : 'text-red-400'}`}>{c.speed}ms</span>
                  <div className="text-xs text-gray-500 uppercase">{c.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
