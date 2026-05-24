import { useState } from 'react';
import { Plus, CheckSquare, Square, Play, StopCircle, Search, RefreshCw, Trash2, Folder } from 'lucide-react';
import type { Profile, OS, MultiloginProxyType } from '../types';
import ProfileCard from './ProfileCard';
import NewProfileModal from './NewProfileModal';
import { useStore } from '../store/useStore';
import type { ProviderSelection } from '../services/browserProviderApi';

type BrowserProvider = 'morelogin' | 'adspower' | 'multilogin';

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
  onCreateProfile: (os: OS, proxyType?: MultiloginProxyType) => void;
  onStartProfile: (id: string) => void;
  onStopProfile: (id: string) => void;
  onDeleteProfile: (id: string) => void;
  onDeleteSelected?: () => void;
  onRecreateProfile: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartSelected: () => void;
  onStopSelected: () => void;
  onRenewProxy: (id: string) => void;
  onOpenSettings: (id: string) => void;
}

export default function ProfilesPage({
  profiles, loading, onFetchProfiles,
  onCreateProfile, onStartProfile, onStopProfile, onDeleteProfile,
  onRecreateProfile, onToggleSelect, onSelectAll, onDeselectAll,
  onStartSelected, onStopSelected, onRenewProxy, onOpenSettings, onDeleteSelected,
}: ProfilesPageProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterOS, setFilterOS] = useState<'All' | OS>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterProvider, setFilterProvider] = useState<'All' | BrowserProvider>('All');
  const [folderFilter, setFolderFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const browserProvider = useStore((state) => state.browserProvider);
  const setBrowserProvider = useStore((state) => state.setBrowserProvider);
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
    if (folderFilter.trim() && !(p.folderId?.includes(folderFilter.trim()) || p.folderName?.toLowerCase().includes(folderFilter.trim().toLowerCase()))) return false;
    return true;
  });

  // All unique folder IDs from loaded profiles
  const folders = Array.from(new Set(profiles.map(p => p.folderId).filter(Boolean))) as string[];

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

        {/* Provider Quick-Switch */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-gray-500 text-xs font-medium mr-1">Provider:</span>
          {(['morelogin', 'adspower', 'multilogin', 'all'] as ProviderSelection[]).map(p => (
            <button key={p} onClick={() => setBrowserProvider(p)}
              className={`px-3 py-1 rounded-lg border text-xs font-semibold transition-all
                ${browserProvider === p
                  ? p === 'morelogin'  ? 'bg-blue-600/30 border-blue-500/60 text-blue-300'
                  : p === 'adspower'  ? 'bg-emerald-600/30 border-emerald-500/60 text-emerald-300'
                  : p === 'multilogin' ? 'bg-purple-600/30 border-purple-500/60 text-purple-300'
                  : 'bg-cyan-600/30 border-cyan-500/60 text-cyan-300'
                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'}`}>
              {PROVIDER_LABELS[p]}
            </button>
          ))}
          {loading && <span className="text-blue-400 text-xs ml-1">⟳ fetching...</span>}
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

          {/* Delete Selected — with confirm */}
          {selectedCount > 0 && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-red-400 text-xs">Delete {selectedCount} profiles?</span>
                <button onClick={() => { onDeleteSelected?.(); setConfirmDelete(false); }}
                  className="px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-500 transition-all">
                  Yes, Delete
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 rounded-xl bg-gray-700 text-gray-300 text-xs hover:bg-gray-600 transition-all">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/50 border border-red-800/50 text-red-500 hover:bg-red-900/40 transition-all text-xs font-medium">
                <Trash2 size={13} /> Delete Selected ({selectedCount})
              </button>
            )
          )}

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

        {/* Search + Folder Filter */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Search profiles by name or IP..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-green-500" />
          </div>

          {/* Folder ID filter */}
          <div className="relative">
            <Folder size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-500" />
            <input type="text" placeholder="Folder ID or name..." value={folderFilter} onChange={e => setFolderFilter(e.target.value)}
              className="w-48 bg-gray-800 border border-gray-700 text-gray-200 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-yellow-500" />
            {folderFilter && (
              <button onClick={() => setFolderFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">✕</button>
            )}
          </div>

          {/* Folder quick-pick chips — show if profiles have folder info */}
          {folders.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {folders.slice(0, 5).map(fid => {
                const folderProf = profiles.find(p => p.folderId === fid);
                const label = folderProf?.folderName || fid.slice(0, 8);
                return (
                  <button key={fid} onClick={() => setFolderFilter(folderFilter === fid ? '' : fid)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-all border
                      ${folderFilter === fid ? 'bg-yellow-600/30 border-yellow-500/50 text-yellow-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}`}>
                    <Folder size={9} className="inline mr-1" />{label}
                  </button>
                );
              })}
            </div>
          )}

          <span className="text-gray-600 text-xs">{filtered.length} profiles shown</span>
        </div>
      </div>

      {/* Profile Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <RefreshCw size={32} className="text-green-400 animate-spin mb-4" />
            <p className="text-gray-400 text-sm">Fetching profiles from {browserProvider ? PROVIDER_LABELS[browserProvider] : 'provider'}...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="text-6xl mb-4">🤖</div>
            <h3 className="text-gray-400 font-semibold text-lg mb-2">
              {profiles.length === 0 ? 'No Profiles Yet' : 'No profiles match filters'}
            </h3>
            <p className="text-gray-600 text-sm mb-6">
              {profiles.length === 0
                ? `Make sure ${browserProvider ? PROVIDER_LABELS[browserProvider] : 'the browser provider'} is running, then click Refresh or "New Profile"`
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
          onCreate={(os, proxyType) => { onCreateProfile(os, proxyType); setShowNewModal(false); }}
        />
      )}
    </div>
  );
}
