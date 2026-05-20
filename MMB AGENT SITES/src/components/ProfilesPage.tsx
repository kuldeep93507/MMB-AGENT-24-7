import { useState } from 'react';
import { Plus, CheckSquare, Square, Play, StopCircle, Search, RefreshCw } from 'lucide-react';
import type { Profile, OS } from '../types';
import ProfileCard from './ProfileCard';
import NewProfileModal from './NewProfileModal';
import { useStore } from '../store/useStore';

type BrowserProvider = 'morelogin' | 'adspower' | 'multilogin';
type ProviderSelection = BrowserProvider | 'all';

const PROVIDER_LABELS: Record<ProviderSelection, string> = {
  all: 'All Providers',
  morelogin: 'MoreLogin',
  adspower: 'AdsPower',
  multilogin: 'Multilogin',
};

interface ProfilesPageProps {
  profiles: Profile[];
  loading: boolean;
  onFetchProfiles: () => void;
  onCreateProfile: (os: OS) => void;
  onStartProfile: (id: string) => void;
  onStopProfile: (id: string) => void;
  onDeleteProfile: (id: string) => void;
  onRecreateProfile: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartSelected: () => void;
  onStopSelected: () => void;
  onRenewProxy: (id: string) => void;
  onOpenSettings: () => void;
}

export default function ProfilesPage({
  profiles, loading, onFetchProfiles,
  onCreateProfile, onStartProfile, onStopProfile, onDeleteProfile,
  onRecreateProfile, onToggleSelect, onSelectAll, onDeselectAll,
  onStartSelected, onStopSelected, onRenewProxy, onOpenSettings,
}: ProfilesPageProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterOS, setFilterOS] = useState<'All' | OS>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterProvider, setFilterProvider] = useState<'All' | BrowserProvider>('All');

  const browserProvider = useStore((state) => state.browserProvider);
  const selectedCount = profiles.filter(p => p.selected).length;
  const runningCount = profiles.filter(p => p.status === 'running').length;

  // Per-provider breakdown — useful in "All Providers" mode
  const providerCounts = profiles.reduce<Record<string, number>>((acc, p) => {
    const key = p.browserType || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const filtered = profiles.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.ip?.includes(search)) return false;
    if (filterOS !== 'All' && p.os !== filterOS) return false;
    if (filterStatus !== 'All' && p.status !== filterStatus) return false;
    if (filterProvider !== 'All' && p.browserType !== filterProvider) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">Profiles</h1>
              {browserProvider && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-600/20 border border-blue-500/30 text-blue-400">
                  {PROVIDER_LABELS[browserProvider]}
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-0.5">
              {profiles.length} total • {runningCount} running • {selectedCount} selected
              {loading && <span className="text-blue-400 ml-2">⟳ Fetching...</span>}
            </p>
            {/* Per-provider breakdown — only shown when profiles span multiple providers */}
            {Object.keys(providerCounts).length > 1 && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {providerCounts.morelogin !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-900/40 border border-blue-700/30 text-blue-400">
                    🔵 MoreLogin: {providerCounts.morelogin}
                  </span>
                )}
                {providerCounts.adspower !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-900/40 border border-emerald-700/30 text-emerald-400">
                    🟢 AdsPower: {providerCounts.adspower}
                  </span>
                )}
                {providerCounts.multilogin !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-900/40 border border-purple-700/30 text-purple-400">
                    🟣 Multilogin: {providerCounts.multilogin}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onFetchProfiles} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-all text-sm font-medium">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button onClick={() => {
                fetch('/backend-api/api/manual/batch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ profileIds: profiles.filter(p => p.status === 'running').map(p => p.id), command: 'arrangeWindows' }),
                }).catch(() => {});
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600/20 border border-purple-600/30 text-purple-400 hover:bg-purple-600/30 transition-all text-sm font-medium">
              ⊞ Arrange Windows
            </button>
            <button onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white transition-all text-sm font-semibold shadow-lg shadow-green-900/30">
              <Plus size={15} />
              New Profile
            </button>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-all text-xs font-medium">
            <CheckSquare size={13} /> Select All
          </button>
          <button onClick={onDeselectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-all text-xs font-medium">
            <Square size={13} /> Deselect All
          </button>
          <button onClick={onStartSelected} disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-900/30 border border-green-700/40 text-green-400 hover:bg-green-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-medium">
            <Play size={13} /> Start Selected ({selectedCount})
          </button>
          <button onClick={onStopSelected} disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-900/30 border border-red-700/40 text-red-400 hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-medium">
            <StopCircle size={13} /> Stop Selected ({selectedCount})
          </button>

          <div className="w-px h-5 bg-gray-700 mx-1" />

          {/* OS Filter */}
          {(['All', 'Windows', 'Android', 'macOS'] as const).map(os => (
            <button key={os} onClick={() => setFilterOS(os)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all
                ${filterOS === os ? 'bg-green-600/20 border-green-500/40 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
              {os}
            </button>
          ))}

          <div className="w-px h-5 bg-gray-700 mx-1" />

          {/* Status Filter */}
          {(['All', 'running', 'stopped', 'starting', 'error'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all capitalize
                ${filterStatus === s ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
              {s}
            </button>
          ))}

          {/* Provider Filter — only render when profiles span multiple providers */}
          {Object.keys(providerCounts).length > 1 && (
            <>
              <div className="w-px h-5 bg-gray-700 mx-1" />
              {(['All', 'morelogin', 'adspower', 'multilogin'] as const).map(p => (
                <button key={p} onClick={() => setFilterProvider(p)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all
                    ${filterProvider === p
                      ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                  {p === 'All' ? 'All Providers' : PROVIDER_LABELS[p]}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Search */}
        <div className="mt-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Search profiles by name or IP..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-green-500" />
          </div>
          <span className="text-gray-600 text-xs">{filtered.length} profiles shown</span>
        </div>
      </div>

      {/* Profile Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <RefreshCw size={32} className="text-green-400 animate-spin mb-4" />
            <p className="text-gray-400 text-sm">Fetching profiles from MoreLogin...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="text-6xl mb-4">🤖</div>
            <h3 className="text-gray-400 font-semibold text-lg mb-2">
              {profiles.length === 0 ? 'No Profiles Yet' : 'No profiles match filters'}
            </h3>
            <p className="text-gray-600 text-sm mb-6">
              {profiles.length === 0
                ? 'Make sure MoreLogin is running, then click Refresh or "New Profile"'
                : 'Try adjusting your search or filters'}
            </p>
            {profiles.length === 0 && (
              <div className="flex gap-3">
                <button onClick={onFetchProfiles}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all">
                  <RefreshCw size={14} /> Retry Fetch
                </button>
                <button onClick={() => setShowNewModal(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-all">
                  <Plus size={14} /> Create Profile
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(profile => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                onStart={onStartProfile}
                onStop={onStopProfile}
                onSettings={onOpenSettings}
                onDelete={onDeleteProfile}
                onRecreate={onRecreateProfile}
                onToggleSelect={onToggleSelect}
                onRenewProxy={onRenewProxy}
              />
            ))}
          </div>
        )}
      </div>

      {/* New Profile Modal */}
      {showNewModal && (
        <NewProfileModal
          onClose={() => setShowNewModal(false)}
          onCreate={(os) => { onCreateProfile(os); setShowNewModal(false); }}
        />
      )}
    </div>
  );
}
