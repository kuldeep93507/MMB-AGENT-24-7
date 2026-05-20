import { Play, Square, Settings, Trash2, RefreshCw, Globe, Clock, RotateCw } from 'lucide-react';
import type { Profile } from '../types';

interface ProfileCardProps {
  profile: Profile;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onSettings: (id: string) => void;
  onDelete: (id: string) => void;
  onRecreate: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onRenewProxy: (id: string) => void;
}

const STATUS_CONFIG = {
  running: { label: 'Running', dot: 'bg-green-500 animate-pulse', badge: 'bg-green-900/40 text-green-400 border-green-600/30' },
  stopped: { label: 'Stopped', dot: 'bg-gray-500', badge: 'bg-gray-800 text-gray-400 border-gray-700' },
  starting: { label: 'Starting...', dot: 'bg-yellow-500 animate-pulse', badge: 'bg-yellow-900/40 text-yellow-400 border-yellow-600/30' },
  error: { label: 'Error', dot: 'bg-red-500 animate-pulse', badge: 'bg-red-900/40 text-red-400 border-red-600/30' },
  recreating: { label: 'Recreating', dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-900/40 text-blue-400 border-blue-600/30' },
};

const OS_CONFIG = {
  Windows: { icon: '🪟', color: 'bg-blue-900/40 text-blue-400 border-blue-700/30' },
  Android: { icon: '🤖', color: 'bg-green-900/40 text-green-400 border-green-700/30' },
  macOS: { icon: '🍎', color: 'bg-purple-900/40 text-purple-400 border-purple-700/30' },
};

// Browser provider badge styling — distinct color per provider so users can
// tell at a glance which antidetect tool a profile belongs to.
const PROVIDER_CONFIG = {
  morelogin:  { label: 'MoreLogin',  icon: '🔵', color: 'bg-blue-900/40 text-blue-400 border-blue-700/30' },
  adspower:   { label: 'AdsPower',   icon: '🟢', color: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/30' },
  multilogin: { label: 'Multilogin', icon: '🟣', color: 'bg-purple-900/40 text-purple-400 border-purple-700/30' },
} as const;

export default function ProfileCard({ profile, onStart, onStop, onSettings, onDelete, onRecreate, onToggleSelect, onRenewProxy }: ProfileCardProps) {
  const status = STATUS_CONFIG[profile.status];
  const osConf = OS_CONFIG[profile.os];
  const providerConf = profile.browserType ? PROVIDER_CONFIG[profile.browserType] : null;

  const timeLeft = profile.proxy.expiresAt - Date.now();
  const isExpired = timeLeft <= 0;
  const timeLeftStr = isExpired ? 'Expired' : formatTime(timeLeft);

  function formatTime(ms: number) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }

  const canStart = profile.status === 'stopped' || profile.status === 'error';
  const canStop = profile.status === 'running' || profile.status === 'starting';

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden transition-all duration-200
      ${profile.selected ? 'border-green-500/50 ring-1 ring-green-500/30' : 'border-gray-800 hover:border-gray-700'}`}>

      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <input type="checkbox" checked={profile.selected} onChange={() => onToggleSelect(profile.id)}
          className="w-4 h-4 accent-green-500 flex-shrink-0 cursor-pointer" />
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base border flex-shrink-0 ${osConf.color}`}>
          {osConf.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm truncate">{profile.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-md border font-medium flex-shrink-0 ${osConf.color}`}>{profile.os}</span>
            {providerConf && (
              <span
                title={`Browser provider: ${providerConf.label}`}
                className={`text-xs px-1.5 py-0.5 rounded-md border font-medium flex-shrink-0 flex items-center gap-1 ${providerConf.color}`}
              >
                <span className="text-[10px]">{providerConf.icon}</span>
                {providerConf.label}
              </span>
            )}
          </div>
          <div className="text-gray-500 text-xs truncate font-mono">{profile.id}</div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium flex-shrink-0 ${status.badge}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Globe size={12} className="text-gray-500 flex-shrink-0" />
            <span className={`text-xs font-mono ${profile.ip && !profile.ip.startsWith('debug:') ? 'text-green-400' : 'text-gray-600'}`}>
              {profile.ip && !profile.ip.startsWith('debug:') ? profile.ip : '—.—.—.—'}
            </span>
          </div>
          <div className="text-xs text-gray-500">{profile.proxy.city !== 'Unknown' ? `${profile.proxy.city}, ` : ''}{profile.proxy.state}</div>
          <div className="flex items-center gap-1 ml-auto">
            <Clock size={11} className="text-gray-600" />
            <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-gray-500'}`}>{timeLeftStr}</span>
          </div>
        </div>

        <div className="bg-gray-800/60 rounded-lg px-3 py-1.5">
          <div className="text-gray-600 text-xs truncate font-mono">
            session: <span className="text-gray-400">{profile.proxy.sessionId}</span> • life: <span className="text-gray-400">{profile.proxy.life}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${profile.status === 'running' ? 'bg-green-500' : 'bg-gray-600'}`} />
          <span className="text-gray-400 text-xs">{profile.currentAction}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-800/40 rounded-lg px-2 py-1.5 text-center">
            <div className="text-gray-600 text-xs">Canvas</div>
            <div className="text-green-400 text-xs font-medium">Noise</div>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-2 py-1.5 text-center">
            <div className="text-gray-600 text-xs">WebRTC</div>
            <div className="text-green-400 text-xs font-medium">Private</div>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-2 py-1.5 text-center">
            <div className="text-gray-600 text-xs">Timezone</div>
            <div className="text-blue-400 text-xs font-medium truncate">{profile.fingerprint.timezone.split('/')[1] || 'US'}</div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-2">
        <button onClick={() => onStart(profile.id)} disabled={!canStart} title="Start Profile"
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all
            ${canStart ? 'bg-green-600/20 border border-green-600/40 text-green-400 hover:bg-green-600/30' : 'bg-gray-800/50 border border-gray-700 text-gray-600 cursor-not-allowed'}`}>
          <Play size={12} /> Start
        </button>
        <button onClick={() => onStop(profile.id)} disabled={!canStop} title="Stop Profile"
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all
            ${canStop ? 'bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30' : 'bg-gray-800/50 border border-gray-700 text-gray-600 cursor-not-allowed'}`}>
          <Square size={12} /> Stop
        </button>
        <button onClick={() => onSettings(profile.id)} title="Profile Settings"
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-all">
          <Settings size={12} />
        </button>
        <button onClick={() => onRenewProxy(profile.id)} title="Renew Proxy Session"
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-orange-900/20 border border-orange-700/30 text-orange-400 hover:bg-orange-900/30 transition-all">
          <RotateCw size={12} />
        </button>
        <button onClick={() => onRecreate(profile.id)} title="Refresh Fingerprint"
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-blue-900/20 border border-blue-700/30 text-blue-400 hover:bg-blue-900/30 transition-all">
          <RefreshCw size={12} />
        </button>
        <button onClick={() => onDelete(profile.id)} title="Delete Profile"
          className="flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold bg-red-900/20 border border-red-700/30 text-red-500 hover:bg-red-900/30 transition-all">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
