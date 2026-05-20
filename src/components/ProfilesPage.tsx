import { useState, useMemo } from 'react';
import {
  Plus, CheckSquare, Square, Play, StopCircle, Search, Zap,
  RefreshCw, Trash2, RotateCcw, Download, ChevronLeft, ChevronRight, Clock,
} from 'lucide-react';
import type { Profile, OS, TaskType } from '../types';
import type { ProviderSelection } from '../services/browserProviderApi';
import ProfileCard from './ProfileCard';
import NewProfileModal from './NewProfileModal';
import ProfileSettings from './ProfileSettings';
import AddJobModal from './AddJobModal';
import { backendUrl } from '../services/backendOrigin';

type BrowserProvider = 'morelogin' | 'multilogin';

const PROVIDER_LABELS: Record<ProviderSelection, string> = {
  all: 'All Providers',
  morelogin: 'MoreLogin',
  multilogin: 'Multilogin',
};

type SortKey = 'name' | 'status' | 'proxyExpiry';

const PAGE_SIZE = 24;

interface ProfilesPageProps {
  profiles: Profile[];
  browserProvider?: ProviderSelection;
  loading?: boolean;
  recreatingIds?: Set<string>;

  onCreateProfile: (os: OS, proxyType?: string, profileMode?: string, androidDevice?: string) => Promise<{ code: number; message?: string }>;
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
  onAddJob: (profileId: string, taskType: TaskType, details?: string) => void;
  onRefreshProfiles: () => void;
  onDeleteSelected: () => void;
  onRecreateSelected: () => void;
  onExportConfigs: () => void;
}

export default function ProfilesPage({
  profiles, browserProvider, loading = false, recreatingIds = new Set(),
  onCreateProfile, onStartProfile, onStopProfile, onDeleteProfile,
  onRecreateProfile, onToggleSelect, onSelectAll, onDeselectAll,
  onStartSelected, onStopSelected, onRenewProxy, onAddJob,
  onRefreshProfiles, onDeleteSelected, onRecreateSelected, onExportConfigs,
}: ProfilesPageProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [settingsProfileId, setSettingsProfileId] = useState<string | null>(null);
  const [showAddJob, setShowAddJob] = useState(false);
  const [search, setSearch] = useState('');
  const [filterOS, setFilterOS] = useState<'All' | OS>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterProvider, setFilterProvider] = useState<'All' | BrowserProvider>('All');
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [page, setPage] = useState(1);
  const [arrangeError, setArrangeError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const selectedCount = profiles.filter(p => p.selected).length;
  const runningCount = profiles.filter(p => p.status === 'running').length;
  const settingsProfile = settingsProfileId ? profiles.find(p => p.id === settingsProfileId) || null : null;

  const providerCounts = profiles.reduce<Record<string, number>>((acc, p) => {
    const key = p.browserType || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const filtered = useMemo(() => {
    let list = profiles.filter(p => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.ip?.includes(search)) return false;
      if (filterOS !== 'All' && p.os !== filterOS) return false;
      if (filterStatus !== 'All' && p.status !== filterStatus) return false;
      if (filterProvider !== 'All' && p.browserType !== filterProvider) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      const ae = a.proxy.expiresAt || 0;
      const be = b.proxy.expiresAt || 0;
      return ae - be;
    });
    return list;
  }, [profiles, search, filterOS, filterStatus, filterProvider, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleArrangeWindows = async () => {
    const runningIds = profiles.filter(p => p.status === 'running').map(p => p.id);
    if (runningIds.length === 0) {
      setArrangeError('No running profiles — start profiles first, then arrange windows.');
      return;
    }
    setArrangeError(null);
    try {
      const res = await fetch(backendUrl('/api/manual/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileIds: runningIds, command: 'arrangeWindows' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArrangeError(data.message || data.error || `Server error ${res.status}`);
        return;
      }
      if (data.success === false) {
        setArrangeError(data.message || 'Arrange windows failed');
      }
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Network error — is backend running?');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    if (!window.confirm(`Delete ${selectedCount} selected profile(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    await onDeleteSelected();
    setBulkBusy(false);
  };

  const handleBulkRecreate = async () => {
    if (selectedCount === 0) return;
    if (!window.confirm(`Recreate ${selectedCount} profile(s)? Old profiles will be replaced (new proxy + fingerprint).`)) return;
    setBulkBusy(true);
    await onRecreateSelected();
    setBulkBusy(false);
  };

  return (
    <div className="flex flex-col h-full">
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
              {loading && (
                <span className="text-xs text-yellow-400 animate-pulse">Refreshing…</span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-0.5">
              {profiles.length} total • {runningCount} running • {selectedCount} selected
            </p>
            {Object.keys(providerCounts).length > 1 && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {providerCounts.morelogin !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-900/40 border border-blue-700/30 text-blue-400">
                    🔵 MoreLogin: {providerCounts.morelogin}
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
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={onRefreshProfiles}
              disabled={loading}
              title="Reload profiles from MoreLogin / Multilogin"
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onExportConfigs}
              title="Backup profile automation settings (localStorage)"
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm"
            >
              <Download size={15} />
              Export configs
            </button>
            <button
              type="button"
              onClick={handleArrangeWindows}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600/20 border border-purple-600/30 text-purple-400 hover:bg-purple-600/30 transition-all text-sm font-medium"
            >
              ⊞ Arrange Windows
            </button>
            <button
              type="button"
              onClick={() => setShowAddJob(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-600/20 border border-yellow-600/30 text-yellow-400 hover:bg-yellow-600/30 transition-all text-sm font-medium"
            >
              <Zap size={15} />
              Add Job
            </button>
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-semibold shadow-lg shadow-red-900/30"
            >
              <Plus size={15} />
              New Profile
            </button>
          </div>
        </div>

        {/* Coming Soon — fixed channels shortcut (#11) */}
        <div className="mb-4 rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 flex items-start gap-3">
          <Clock size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-200 text-sm font-medium">Coming Soon — Run fixed channels from Profiles</p>
            <p className="text-amber-200/70 text-xs mt-1 leading-relaxed">
              Ek click se selected profiles par tumhare 2 built-in YouTube channels ki videos chalana.
              Abhi ke liye <span className="text-amber-100">Scheduler</span> ya <span className="text-amber-100">Video Shuffle</span> use karo.
            </p>
          </div>
        </div>

        {arrangeError && (
          <div className="mb-3 rounded-xl border border-red-700/40 bg-red-900/20 px-3 py-2 text-xs text-red-300 flex justify-between gap-2">
            <span>{arrangeError}</span>
            <button type="button" onClick={() => setArrangeError(null)} className="text-red-400 hover:text-red-200">✕</button>
          </div>
        )}

        <div className="mb-3 rounded-xl border border-blue-800/30 bg-blue-950/20 px-3 py-2 text-[11px] text-blue-200/80 leading-relaxed">
          Profile settings (watch time, likes, traffic) are stored in this browser&apos;s localStorage.
          Use <strong className="text-blue-300">Export configs</strong> to backup — clearing browser data will remove them.
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={onSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 text-xs font-medium">
            <CheckSquare size={13} /> Select All
          </button>
          <button type="button" onClick={onDeselectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 text-xs font-medium">
            <Square size={13} /> Deselect
          </button>
          <button type="button" onClick={onStartSelected} disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-900/30 border border-green-700/40 text-green-400 disabled:opacity-40 text-xs font-medium">
            <Play size={13} /> Start ({selectedCount})
          </button>
          <button type="button" onClick={onStopSelected} disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-900/30 border border-red-700/40 text-red-400 disabled:opacity-40 text-xs font-medium">
            <StopCircle size={13} /> Stop ({selectedCount})
          </button>
          <button type="button" onClick={handleBulkRecreate} disabled={selectedCount === 0 || bulkBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-900/30 border border-blue-700/40 text-blue-400 disabled:opacity-40 text-xs font-medium">
            <RotateCcw size={13} className={bulkBusy ? 'animate-spin' : ''} /> Recreate selected
          </button>
          <button type="button" onClick={handleBulkDelete} disabled={selectedCount === 0 || bulkBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-900/20 border border-red-800/40 text-red-500 disabled:opacity-40 text-xs font-medium">
            <Trash2 size={13} /> Delete selected
          </button>

          <div className="w-px h-5 bg-gray-700 mx-1" />

          {(['All', 'Windows', 'Android', 'macOS', 'Unknown'] as const).map(os => (
            <button key={os} type="button" onClick={() => { setFilterOS(os); setPage(1); }}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all
                ${filterOS === os ? 'bg-red-600/20 border-red-500/40 text-red-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
              {os}
            </button>
          ))}

          <div className="w-px h-5 bg-gray-700 mx-1" />

          {(['All', 'running', 'stopped', 'starting', 'error', 'recreating'] as const).map(s => (
            <button key={s} type="button" onClick={() => { setFilterStatus(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium capitalize transition-all
                ${filterStatus === s ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
              {s}
            </button>
          ))}

          {Object.keys(providerCounts).length > 1 && (
            <>
              <div className="w-px h-5 bg-gray-700 mx-1" />
              {(['All', 'morelogin', 'multilogin'] as const).map(p => (
                <button key={p} type="button" onClick={() => { setFilterProvider(p); setPage(1); }}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all
                    ${filterProvider === p ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                  {p === 'All' ? 'All Providers' : PROVIDER_LABELS[p]}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search profiles by name or IP..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-gray-500"
            />
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            className="bg-gray-800 border border-gray-700 text-gray-300 rounded-xl px-3 py-2 text-xs"
          >
            <option value="name">Sort: Name</option>
            <option value="status">Sort: Status</option>
            <option value="proxyExpiry">Sort: Proxy expiry</option>
          </select>
          <span className="text-gray-600 text-xs">
            {filtered.length} shown • page {safePage}/{totalPages}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="text-6xl mb-4">🤖</div>
            <h3 className="text-gray-400 font-semibold text-lg mb-2">
              {profiles.length === 0 ? 'No Profiles Yet' : 'No profiles match filters'}
            </h3>
            {profiles.length === 0 && (
              <button type="button" onClick={() => setShowNewModal(true)}
                className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold">
                <Plus size={16} /> Create First Profile
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pageItems.map(profile => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                isRecreating={recreatingIds.has(profile.id) || profile.status === 'recreating'}
                onStart={onStartProfile}
                onStop={onStopProfile}
                onSettings={id => setSettingsProfileId(id)}
                onDelete={onDeleteProfile}
                onRecreate={onRecreateProfile}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="flex-shrink-0 px-6 py-3 border-t border-gray-800 flex items-center justify-center gap-4">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 disabled:opacity-40 text-xs"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-gray-500 text-xs">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 disabled:opacity-40 text-xs"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}

      {showNewModal && (
        <NewProfileModal
          onClose={() => setShowNewModal(false)}
          onCreate={onCreateProfile}
          activeProvider={browserProvider === 'morelogin' ? 'morelogin' : browserProvider === 'multilogin' ? 'multilogin' : 'all'}
        />
      )}
      {settingsProfile && (
        <ProfileSettings
          profile={settingsProfile}
          onClose={() => setSettingsProfileId(null)}
          onRenewProxy={id => { onRenewProxy(id); }}
        />
      )}
      {showAddJob && (
        <AddJobModal
          profiles={profiles}
          onClose={() => setShowAddJob(false)}
          onAddJob={onAddJob}
        />
      )}
    </div>
  );
}
