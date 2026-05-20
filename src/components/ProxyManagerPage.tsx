import { RefreshCw, Globe, Clock, Shield, AlertTriangle } from 'lucide-react';
import type { Profile } from '../types';
import { PROXY_SERVER, PROXY_PORT, PROXY_PASSWORD, PROXY_PREFIX, US_STATE_CITIES } from '../data/proxyData';

function lifeHours(life: Profile['proxy']['life']): number | null {
  const map: Record<string, number> = { '1hr': 1, '2hr': 2, '4hr': 4, '8hr': 8, '24hr': 24 };
  if (life === 'unknown') return null;
  return map[life] ?? null;
}

interface ProxyManagerPageProps {
  profiles: Profile[];
  onRenewProxy: (id: string) => void;
}

export default function ProxyManagerPage({ profiles, onRenewProxy }: ProxyManagerPageProps) {
  const now = Date.now();
  const activeProxies = profiles.filter(p => p.status === 'running');
  const expiredProxies = profiles.filter(p => p.proxy.expiresAt > 0 && p.proxy.expiresAt < now);
  const uniqueStates = [...new Set(profiles.map(p => p.proxy.state))];


  function formatTime(ms: number) {
    if (ms <= 0) return 'EXPIRED';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <h1 className="text-2xl font-bold text-white">Proxy Manager</h1>
        <p className="text-gray-500 text-sm mt-0.5">Smartproxy residential network — US locations</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Fixed Config */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Shield size={16} className="text-green-400" />
            Fixed Configuration (Never Changes)
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <ConfigRow label="Server" value={PROXY_SERVER} highlight="green" />
              <ConfigRow label="Port" value={String(PROXY_PORT)} highlight="blue" />
              <ConfigRow label="Password" value={PROXY_PASSWORD} highlight="yellow" mono />
              <ConfigRow label="Prefix" value={PROXY_PREFIX} mono />
            </div>
            <div className="space-y-3">
              <ConfigRow label="Area" value="US — Always Fixed" highlight="green" />
              <ConfigRow label="Auth Type" value="Username/Password" />
              <ConfigRow label="Protocol" value="HTTP Proxy" />
              <ConfigRow label="Rotation" value="Per Session" highlight="blue" />
            </div>
          </div>

          {/* Username Formula */}
          <div className="mt-4 bg-gray-800 rounded-xl p-4">
            <div className="text-gray-400 text-xs font-medium mb-2">Username Formula</div>
            <div className="font-mono text-sm">
              <span className="text-blue-400">smart-pwgbkxcy3lyi</span>
              <span className="text-gray-500">_area-</span>
              <span className="text-green-400">US</span>
              <span className="text-gray-500">_state-</span>
              <span className="text-yellow-400">{'{'+'STATE}'}</span>
              <span className="text-gray-500">_city-</span>
              <span className="text-yellow-400">{'{'+'CITY}'}</span>
              <span className="text-gray-500">_life-</span>
              <span className="text-purple-400">{'{'+'LIFE}'}</span>
              <span className="text-gray-500">_session-</span>
              <span className="text-red-400">{'{'+'ID}'}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {[
                { part: 'smart-pwgbkxcy3lyi', who: 'Fixed prefix', badge: 'blue' },
                { part: 'area-US', who: 'Always US', badge: 'green' },
                { part: 'state-{STATE}', who: 'Tool auto-selects', badge: 'yellow' },
                { part: 'city-{CITY}', who: 'Matches state', badge: 'yellow' },
                { part: 'life-{LIFE}', who: 'Tool decides', badge: 'purple' },
                { part: 'session-{ID}', who: 'Unique per profile', badge: 'red' },
              ].map(({ part, who, badge }) => (
                <div key={part} className="bg-gray-900 rounded-lg p-2">
                  <div className={`font-mono text-xs font-bold
                    ${badge === 'blue' ? 'text-blue-400' : badge === 'green' ? 'text-green-400' :
                      badge === 'yellow' ? 'text-yellow-400' : badge === 'purple' ? 'text-purple-400' : 'text-red-400'}`}>
                    {part}
                  </div>
                  <div className="text-gray-600 text-xs mt-0.5">{who}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Active Proxies" value={activeProxies.length} icon="🌐" color="green" />
          <StatCard label="Unique States" value={uniqueStates.length} icon="📍" color="blue" />
          <StatCard label="Expired Sessions" value={expiredProxies.length} icon="⏰" color={expiredProxies.length > 0 ? 'red' : 'gray'} />
          <StatCard label="Total Profiles" value={profiles.length} icon="👤" color="purple" />
        </div>

        {/* State-City Map */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Globe size={16} className="text-blue-400" />
            US State — City Mapping
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(US_STATE_CITIES).map(([state, cities]) => {
              const stateProfiles = profiles.filter(p => p.proxy.state === state);
              return (
                <div key={state} className={`bg-gray-800/60 border rounded-xl p-3 transition-all
                  ${stateProfiles.length > 0 ? 'border-blue-600/30 bg-blue-900/10' : 'border-gray-700'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-semibold text-sm">{state}</span>
                    {stateProfiles.length > 0 && (
                      <span className="text-xs bg-blue-900/40 border border-blue-600/30 text-blue-400 px-2 py-0.5 rounded-full">
                        {stateProfiles.length} profiles
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {cities.map(city => (
                      <span key={city} className={`text-xs px-2 py-0.5 rounded-md
                        ${profiles.some(p => p.proxy.state === state && p.proxy.city === city)
                          ? 'bg-blue-900/40 text-blue-300 border border-blue-700/30'
                          : 'bg-gray-900 text-gray-500 border border-gray-800'}`}>
                        {city}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active Proxy Sessions */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Clock size={16} className="text-yellow-400" />
            Proxy Sessions — All Profiles
          </h2>
          {profiles.length === 0 ? (
            <div className="text-center py-8 text-gray-600">No profiles created yet</div>
          ) : (
            <div className="space-y-2">
              {profiles.map(p => {
                const hasExpiry = p.proxy.expiresAt > 0;
                const timeLeft = hasExpiry ? p.proxy.expiresAt - now : NaN;
                const isExpired = hasExpiry && timeLeft <= 0;
                const hours = lifeHours(p.proxy.life);
                const pct =
                  !hasExpiry || hours == null || !Number.isFinite(timeLeft)
                    ? 0
                    : Math.max(0, Math.min(100, (timeLeft / (hours * 3600000)) * 100));

                return (
                  <div key={p.id} className={`border rounded-xl p-3 transition-all
                    ${isExpired ? 'border-red-700/40 bg-red-900/10' : 'border-gray-800 bg-gray-800/30'}`}>
                    <div className="flex items-center gap-3">
                      {/* Status dot */}
                      <div className={`w-2 h-2 rounded-full flex-shrink-0
                        ${p.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />

                      {/* Profile info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white text-xs font-semibold">{p.name}</span>
                          <span className="text-gray-500 text-xs">
                            {[p.proxy.city, p.proxy.state].filter(Boolean).join(', ') || '—'}
                          </span>
                          {p.ip && <span className="text-green-400 text-xs font-mono">{p.ip}</span>}
                          {isExpired && (
                            <span className="flex items-center gap-1 text-red-400 text-xs">
                              <AlertTriangle size={10} />
                              EXPIRED
                            </span>
                          )}
                        </div>
                        <div className="text-gray-600 text-xs font-mono truncate">{p.proxy.username}</div>
                        {/* Progress bar */}
                        <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isExpired ? 'bg-red-500' : 'bg-green-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Time left */}
                      <div className="text-right flex-shrink-0">
                        <div className={`text-xs font-medium ${!hasExpiry ? 'text-gray-500' : isExpired ? 'text-red-400' : 'text-gray-300'}`}>
                          {!hasExpiry ? 'No expiry' : formatTime(timeLeft)}
                        </div>
                        <div className="text-gray-600 text-xs">{p.proxy.life === 'unknown' ? '—' : p.proxy.life}</div>
                      </div>

                      {/* Renew button */}
                      <button onClick={() => onRenewProxy(p.id)}
                        title="Renew proxy session"
                        className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all flex-shrink-0
                          ${isExpired
                            ? 'bg-red-600/30 border border-red-600/40 text-red-400 hover:bg-red-600/50'
                            : 'bg-gray-700 border border-gray-600 text-gray-400 hover:bg-gray-600 hover:text-gray-200'}`}>
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Golden Rule */}
        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-2xl p-5">
          <h3 className="text-yellow-400 font-bold mb-3 flex items-center gap-2">
            🏆 Golden Rules — Proxy System
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              '1 Profile = 1 Unique IP — Never shared',
              'State + City always match (TX → AUSTIN/DALLAS/HOUSTON)',
              'Session expires → Auto-renewed with new session ID',
              'Server + Port + Password never change',
              'Username format locked — only session ID changes',
              'US area always fixed — no other regions',
            ].map(rule => (
              <div key={rule} className="flex items-start gap-2 text-sm">
                <span className="text-yellow-400 flex-shrink-0">✓</span>
                <span className="text-yellow-200/70">{rule}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value, highlight, mono }: { label: string; value: string; highlight?: string; mono?: boolean }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-400',
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
  };
  return (
    <div className="bg-gray-800/60 rounded-xl px-3 py-2.5 flex items-center justify-between">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className={`text-xs font-medium ${mono ? 'font-mono' : ''} ${highlight ? colorMap[highlight] : 'text-gray-300'}`}>
        {value}
      </span>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  const colorMap: Record<string, string> = {
    green: 'border-green-700/30 bg-green-900/10',
    blue: 'border-blue-700/30 bg-blue-900/10',
    red: 'border-red-700/30 bg-red-900/10',
    gray: 'border-gray-700 bg-gray-800/30',
    purple: 'border-purple-700/30 bg-purple-900/10',
  };
  const valColor: Record<string, string> = {
    green: 'text-green-400', blue: 'text-blue-400', red: 'text-red-400',
    gray: 'text-gray-400', purple: 'text-purple-400',
  };
  return (
    <div className={`border rounded-2xl p-4 ${colorMap[color]}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${valColor[color]}`}>{value}</div>
      <div className="text-gray-500 text-xs mt-1">{label}</div>
    </div>
  );
}
