import { Bell, Wifi, Clock, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Profile, LogEntry } from '../types';
import { useStore } from '../store/useStore';

interface TopBarProps {
  profiles: Profile[];
  logs: LogEntry[];
  activeTab: string;
  newArticleCount?: number;
  onClearArticleCount?: () => void;
}

const PROVIDER_OPTIONS = [
  { value: 'morelogin',  label: 'MoreLogin',  icon: '🔵' },
  { value: 'multilogin', label: 'Multilogin', icon: '🟣' },
  { value: 'adspower',   label: 'AdsPower',   icon: '🟢' },
  { value: 'all',        label: 'All',        icon: '🌐' },
] as const;

export default function TopBar({ profiles, logs, activeTab, newArticleCount = 0, onClearArticleCount }: TopBarProps) {
  const [time, setTime] = useState(new Date());
  const [providerOpen, setProviderOpen] = useState(false);
  const browserProvider = useStore((s) => s.browserProvider);
  const setBrowserProvider = useStore((s) => s.setBrowserProvider);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentProvider = PROVIDER_OPTIONS.find(p => p.value === browserProvider) ?? PROVIDER_OPTIONS[0];

  const running = profiles.filter(p => p.status === 'running').length;
  const recentErrors = logs.filter(l => l.level === 'error' && Date.now() - l.timestamp < 3600000).length;

  const tabLabels: Record<string, string> = {
    dashboard: 'Dashboard',
    profiles: 'Profiles',
    sites: 'Sites',
    monitor: 'Live Monitor',
    'article-shuffle': 'Article Shuffle',
    engagement: 'Engagement',
    backlinks: 'Backlinks',
    scheduler: 'Scheduler',
    manual: 'Manual Control',
    analytics: 'Analytics',
    comments: 'Comment Templates',
    'profile-settings': 'Profile Settings',
    'rate-limits': 'Rate Limits',
    logs: 'Activity Logs',
    settings: 'Settings',
  };

  return (
    <header className="h-14 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-white font-semibold text-lg">{tabLabels[activeTab] || 'Dashboard'}</h1>
        {running > 0 && (
          <span className="text-xs bg-green-600/20 text-green-400 border border-green-600/30 px-2 py-0.5 rounded-full">
            {running} reading
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {/* Browser Provider Switcher */}
        <div className="relative">
          <button
            onClick={() => setProviderOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-600 text-xs font-medium transition-all"
          >
            <span>{currentProvider.icon}</span>
            <span>{currentProvider.label}</span>
            <ChevronDown size={11} className={`transition-transform ${providerOpen ? 'rotate-180' : ''}`} />
          </button>
          {providerOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
              {PROVIDER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setBrowserProvider(opt.value); setProviderOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-gray-800 transition-all
                    ${browserProvider === opt.value ? 'text-green-400 bg-green-900/20' : 'text-gray-300'}`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                  {browserProvider === opt.value && <span className="ml-auto text-green-500">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-gray-500 text-xs">
          <Clock size={12} />
          <span>{time.toLocaleTimeString()}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-500 text-xs">
          <Wifi size={12} className="text-green-500" />
          <span>Online</span>
        </div>
        <div className="relative">
          <button
            onClick={onClearArticleCount}
            className="relative p-1 rounded-lg hover:bg-gray-800 transition-colors"
            title={newArticleCount > 0 ? `${newArticleCount} new article reads — click to clear` : 'No new reads'}
          >
            <Bell size={16} className={newArticleCount > 0 ? 'text-green-400' : 'text-gray-500'} />
            {newArticleCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                {newArticleCount > 9 ? '9+' : newArticleCount}
              </span>
            )}
            {recentErrors > 0 && newArticleCount === 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center">
                {recentErrors}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
