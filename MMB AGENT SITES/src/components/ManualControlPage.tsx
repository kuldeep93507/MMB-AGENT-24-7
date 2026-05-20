import { useState, useCallback, useEffect, useRef } from 'react';
import {
  CheckSquare, Square, Play, StopCircle, Search, Monitor,
  Smartphone, Apple, Globe, ArrowDown, ArrowUp, ExternalLink,
  RefreshCw, X, CheckCircle, AlertCircle, Loader, ToggleLeft,
  ToggleRight, Wifi, WifiOff,
} from 'lucide-react';
import type { Profile } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = 'windows' | 'macos' | 'android';

interface ProfileState {
  profileId: string;
  status: 'idle' | 'active' | 'reading' | 'starting';
  currentArticle: string;
  keepAlive: boolean;
  platform: Platform;
}

interface BatchParams {
  url?: string;
  query?: string;
  title?: string;
  trafficPreference?: string;
}

interface CommandResult {
  profileId: string;
  status: string;
  action?: string;
  error?: string;
}

interface FeedbackEntry {
  id: string;
  text: string;
  type: 'ok' | 'error' | 'info';
}

interface ManualControlPageProps {
  profiles: Profile[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectPlatform(os: string): Platform {
  const l = os.toLowerCase();
  if (l.includes('android')) return 'android';
  if (l.includes('mac') || l.includes('ios')) return 'macos';
  return 'windows';
}

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === 'android') return <Smartphone size={12} className="text-green-400" />;
  if (platform === 'macos')   return <Apple size={12} className="text-gray-300" />;
  return <Monitor size={12} className="text-blue-400" />;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

let feedbackCounter = 0;
function makeFeedback(text: string, type: FeedbackEntry['type']): FeedbackEntry {
  return { id: String(feedbackCounter++), text, type };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManualControlPage({ profiles }: ManualControlPageProps) {
  const [selectedIds, setSelectedIds]     = useState<string[]>([]);
  const [profileStates, setProfileStates] = useState<Record<string, ProfileState>>({});
  const [urlInput, setUrlInput]           = useState('');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [searchQuery, setSearchQuery]     = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [startingIds, setStartingIds]     = useState<Set<string>>(new Set());
  const [stoppingIds, setStoppingIds]     = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy]         = useState(false);
  const [feedback, setFeedback]           = useState<FeedbackEntry[]>([]);
  const feedbackTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Sync profileStates from profiles prop ─────────────────────────────────
  useEffect(() => {
    if (profiles.length === 0) return;
    setProfileStates(prev => {
      const next = { ...prev };
      profiles.forEach(p => {
        if (!next[p.id]) {
          next[p.id] = {
            profileId: p.id,
            status: p.status === 'running' ? 'active' : 'idle',
            currentArticle: '',
            keepAlive: true,
            platform: detectPlatform(p.os),
          };
        } else {
          // Respect local 'starting'/'reading' — only override if profile stopped externally
          if (p.status !== 'running' && next[p.id].status === 'active') {
            next[p.id] = { ...next[p.id], status: 'idle' };
          }
        }
      });
      return next;
    });
  }, [profiles]);

  // ─── Poll /status every 3s for real agent state ────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/backend-api/status');
        if (!res.ok) return;
        const statusMap = await res.json() as Record<string, unknown>;
        setProfileStates(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(id => {
            const agentLive = id in statusMap;
            if (agentLive && next[id].status === 'idle') {
              next[id] = { ...next[id], status: 'active' };
            } else if (!agentLive && next[id].status === 'active') {
              next[id] = { ...next[id], status: 'idle' };
            }
          });
          return next;
        });
      } catch {}
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  // ─── Feedback strip ────────────────────────────────────────────────────────
  const pushFeedback = useCallback((entries: FeedbackEntry[]) => {
    setFeedback(entries.slice(0, 6));
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback([]), 5000);
  }, []);

  // ─── Core: send command to specific profileIds ─────────────────────────────
  const sendCommand = useCallback(async (
    ids: string[],
    command: string,
    params?: BatchParams,
  ): Promise<CommandResult[]> => {
    if (ids.length === 0) return [];
    try {
      const res = await fetch('/backend-api/api/manual/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileIds: ids, command, params }),
      });
      if (!res.ok) return ids.map(id => ({ profileId: id, status: 'http_error' }));
      const data = await res.json();
      return Array.isArray(data.results) ? data.results : [];
    } catch (err: unknown) {
      return ids.map(id => ({ profileId: id, status: 'error', error: err instanceof Error ? err.message : 'network error' }));
    }
  }, []);

  const sendBatchCommand = useCallback(async (command: string, params?: BatchParams) => {
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    const results = await sendCommand(selectedIds, command, params);
    const entries = results.map(r => makeFeedback(
      `[${profiles.find(p => p.id === r.profileId)?.name ?? r.profileId.slice(-4)}] ${r.action ?? r.status ?? r.error}`,
      r.status === 'ok' ? 'ok' : 'error',
    ));
    pushFeedback(entries);
    setBatchBusy(false);
  }, [selectedIds, sendCommand, profiles, pushFeedback]);

  const sendToOne = useCallback(async (profileId: string, command: string, params?: BatchParams) => {
    const results = await sendCommand([profileId], command, params);
    if (results[0]) {
      const name = profiles.find(p => p.id === profileId)?.name ?? profileId.slice(-4);
      pushFeedback([makeFeedback(
        `[${name}] ${results[0].action ?? results[0].status ?? results[0].error}`,
        results[0].status === 'ok' ? 'ok' : 'error',
      )]);
    }
  }, [sendCommand, profiles, pushFeedback]);

  // ─── Start profiles ────────────────────────────────────────────────────────
  const handleStartProfiles = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setStartingIds(new Set(selectedIds));
    setProfileStates(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { if (next[id]) next[id] = { ...next[id], status: 'starting' }; });
      return next;
    });

    try {
      const res = await fetch('/backend-api/api/manual/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileIds: selectedIds,
          // Include browserType per profile so backend can route correctly
          profiles: selectedIds.map(id => ({
            profileId: id,
            browserType: profiles.find(p => p.id === id)?.browserType ?? 'morelogin',
            envId: profiles.find(p => p.id === id)?.envId ?? id,
          })),
        }),
      });
      const data = await res.json();
      const results: CommandResult[] = data.results ?? [];
      const entries: FeedbackEntry[] = [];

      setProfileStates(prev => {
        const next = { ...prev };
        for (const r of results) {
          if (next[r.profileId]) {
            next[r.profileId] = { ...next[r.profileId], status: r.status === 'connected' ? 'active' : 'idle' };
          }
          const name = profiles.find(p => p.id === r.profileId)?.name ?? r.profileId.slice(-4);
          entries.push(makeFeedback(
            `[${name}] ${r.status === 'connected' ? '✓ Connected' : `Failed: ${r.error ?? r.status}`}`,
            r.status === 'connected' ? 'ok' : 'error',
          ));
        }
        return next;
      });
      pushFeedback(entries);
    } catch (err: unknown) {
      pushFeedback([makeFeedback(`Start failed: ${err instanceof Error ? err.message : 'network error'}`, 'error')]);
      setProfileStates(prev => {
        const next = { ...prev };
        selectedIds.forEach(id => { if (next[id]) next[id] = { ...next[id], status: 'idle' }; });
        return next;
      });
    }
    setStartingIds(new Set());
  }, [selectedIds, profiles, pushFeedback]);

  // ─── Stop & Disconnect ─────────────────────────────────────────────────────
  const handleStopProfiles = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setStoppingIds(new Set(selectedIds));
    try {
      await fetch('/backend-api/api/manual/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileIds: selectedIds }),
      });
      setProfileStates(prev => {
        const next = { ...prev };
        selectedIds.forEach(id => {
          if (next[id]) next[id] = { ...next[id], status: 'idle', currentArticle: '' };
        });
        return next;
      });
      pushFeedback([makeFeedback(`${selectedIds.length} profile(s) disconnected`, 'ok')]);
    } catch (err: unknown) {
      pushFeedback([makeFeedback(`Stop failed: ${err instanceof Error ? err.message : 'error'}`, 'error')]);
    }
    setStoppingIds(new Set());
  }, [selectedIds, pushFeedback]);

  // ─── Navigate ──────────────────────────────────────────────────────────────
  const handleNavigate = useCallback(() => {
    const url = normalizeUrl(urlInput);
    if (!url) return;
    if (selectedIds.length === 0) {
      pushFeedback([makeFeedback('No profiles selected', 'error')]);
      return;
    }
    sendBatchCommand('navigate', { url });
    setProfileStates(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => {
        if (next[id]) next[id] = { ...next[id], currentArticle: url };
      });
      return next;
    });
    setUrlInput('');
  }, [urlInput, selectedIds, sendBatchCommand, pushFeedback]);

  // ─── Read Article ──────────────────────────────────────────────────────────
  const handleReadArticle = useCallback(() => {
    const url = normalizeUrl(urlInput);
    if (!url) {
      pushFeedback([makeFeedback('Enter an article URL first', 'error')]);
      return;
    }
    if (selectedIds.length === 0) {
      pushFeedback([makeFeedback('No profiles selected', 'error')]);
      return;
    }
    sendBatchCommand('readArticle', { url, title: 'Manual Read', trafficPreference: 'random' });
    setProfileStates(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => {
        if (next[id]) next[id] = { ...next[id], status: 'reading', currentArticle: url };
      });
      return next;
    });
  }, [urlInput, selectedIds, sendBatchCommand, pushFeedback]);

  // ─── Google Search ─────────────────────────────────────────────────────────
  const handleGoogleSearch = useCallback(() => {
    const q = searchQuery.trim();
    sendBatchCommand('googleSearch', { query: q });
    setShowSearchInput(false);
    setSearchQuery('');
  }, [searchQuery, sendBatchCommand]);

  // ─── Selection ─────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAll   = () => setSelectedIds(filteredProfiles.map(p => p.id));
  const deselectAll = () => setSelectedIds([]);

  const toggleKeepAlive = (id: string) =>
    setProfileStates(prev => ({
      ...prev,
      [id]: { ...prev[id], keepAlive: !prev[id]?.keepAlive },
    }));

  // ─── Derived ───────────────────────────────────────────────────────────────
  const filteredProfiles = profiles.filter(p =>
    !sidebarSearch || p.name.toLowerCase().includes(sidebarSearch.toLowerCase())
  );

  const activeCount  = Object.values(profileStates).filter(s => s.status === 'active').length;
  const readingCount = Object.values(profileStates).filter(s => s.status === 'reading').length;

  const isStarting = startingIds.size > 0;
  const isStopping = stoppingIds.size > 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* LEFT SIDEBAR */}
      <div className="w-64 border-r border-gray-800 bg-gray-950 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-800 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Profiles</h2>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              {activeCount > 0  && <span className="text-green-400">{activeCount} live</span>}
              {readingCount > 0 && <span className="text-emerald-400">{readingCount} reading</span>}
            </div>
          </div>

          {/* Sidebar search */}
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              placeholder="Filter profiles…"
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-gray-300 rounded-lg pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:border-gray-500"
            />
          </div>

          <div className="flex gap-1">
            <button onClick={selectAll}
              className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-lg flex items-center justify-center gap-1">
              <CheckSquare size={10} /> All
            </button>
            <button onClick={deselectAll}
              className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-lg flex items-center justify-center gap-1">
              <Square size={10} /> None
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredProfiles.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">No profiles match</p>
          ) : filteredProfiles.map(p => {
            const state = profileStates[p.id];
            const isSelected = selectedIds.includes(p.id);
            const isStartingThis = startingIds.has(p.id);
            return (
              <button key={p.id} onClick={() => toggleSelect(p.id)}
                className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-all ${
                  isSelected ? 'bg-green-900/30 border border-green-600/40' : 'bg-gray-900 border border-transparent hover:border-gray-700'}`}>
                {/* Status dot */}
                {isStartingThis ? (
                  <Loader size={8} className="text-yellow-400 animate-spin flex-shrink-0" />
                ) : (
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    state?.status === 'active'   ? 'bg-green-500 animate-pulse' :
                    state?.status === 'reading'  ? 'bg-emerald-400 animate-pulse' :
                    state?.status === 'starting' ? 'bg-yellow-500 animate-pulse' :
                                                   'bg-gray-600'}`} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{p.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <PlatformIcon platform={state?.platform ?? 'windows'} />
                    <span className="text-xs text-gray-600">{p.os}</span>
                  </div>
                </div>
                {/* Connected indicator */}
                {state?.status === 'active' || state?.status === 'reading'
                  ? <Wifi size={10} className="text-green-500 flex-shrink-0" />
                  : <WifiOff size={10} className="text-gray-700 flex-shrink-0" />}
                {isSelected && <span className="text-green-400 text-xs flex-shrink-0">✓</span>}
              </button>
            );
          })}
        </div>

        <div className="p-3 border-t border-gray-800 text-xs text-gray-600 text-center">
          {selectedIds.length}/{profiles.length} selected
        </div>
      </div>

      {/* MAIN AREA */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* TOP BAR — Batch Controls */}
        <div className="px-4 py-3 border-b border-gray-800 bg-gray-950/80 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Batch ({selectedIds.length}):</span>

            {/* Start */}
            <button onClick={handleStartProfiles}
              disabled={selectedIds.length === 0 || isStarting || isStopping}
              className="bg-green-600 hover:bg-green-500 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1">
              {isStarting ? <Loader size={10} className="animate-spin" /> : <Play size={10} />}
              {isStarting ? 'Connecting…' : 'Start & Connect'}
            </button>

            {/* Stop & Disconnect */}
            <button onClick={handleStopProfiles}
              disabled={selectedIds.length === 0 || isStarting || isStopping}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1">
              {isStopping ? <Loader size={10} className="animate-spin" /> : <StopCircle size={10} />}
              {isStopping ? 'Stopping…' : 'Stop & Disconnect'}
            </button>

            <div className="w-px h-5 bg-gray-700" />

            <button onClick={() => sendBatchCommand('scrollUp')}
              disabled={selectedIds.length === 0 || batchBusy}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1">
              <ArrowUp size={10} /> Scroll Up
            </button>
            <button onClick={() => sendBatchCommand('scrollDown')}
              disabled={selectedIds.length === 0 || batchBusy}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1">
              <ArrowDown size={10} /> Scroll Down
            </button>
            <button onClick={() => sendBatchCommand('scrollToBottom')}
              disabled={selectedIds.length === 0 || batchBusy}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all">
              ⬇ Bottom
            </button>

            <div className="w-px h-5 bg-gray-700" />

            <button onClick={handleReadArticle}
              disabled={selectedIds.length === 0 || batchBusy}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1">
              <Globe size={10} /> Read Article
            </button>
            <button onClick={() => sendBatchCommand('stopReading')}
              disabled={selectedIds.length === 0 || batchBusy}
              className="bg-orange-700 hover:bg-orange-600 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1">
              <X size={10} /> Stop Reading
            </button>

            <div className="w-px h-5 bg-gray-700" />

            <button onClick={() => sendBatchCommand('openHomepage')}
              disabled={selectedIds.length === 0 || batchBusy}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all">
              🏠 Homepage
            </button>

            {/* Google Search with query input */}
            <div className="relative">
              <button onClick={() => setShowSearchInput(v => !v)}
                disabled={selectedIds.length === 0 || batchBusy}
                className="bg-blue-800 hover:bg-blue-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1">
                <Search size={10} /> Google Search
              </button>
              {showSearchInput && (
                <div className="absolute left-0 top-full mt-1 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 shadow-xl z-20 min-w-72">
                  <input
                    autoFocus
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleGoogleSearch()}
                    placeholder="Search query…"
                    className="flex-1 bg-transparent text-white text-xs placeholder-gray-600 focus:outline-none"
                  />
                  <button onClick={handleGoogleSearch}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-lg text-xs">
                    Go
                  </button>
                  <button onClick={() => setShowSearchInput(false)}
                    className="text-gray-500 hover:text-white">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>

            <button onClick={() => sendBatchCommand('arrangeWindows')}
              disabled={selectedIds.length === 0 || batchBusy}
              className="ml-auto bg-purple-800 hover:bg-purple-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-lg text-xs transition-all">
              ⊞ Arrange
            </button>
          </div>

          {/* Feedback strip */}
          {feedback.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {feedback.map(f => (
                <span key={f.id}
                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg ${
                    f.type === 'ok'    ? 'bg-green-900/30 text-green-400' :
                    f.type === 'error' ? 'bg-red-900/30 text-red-400' :
                                        'bg-gray-800 text-gray-400'}`}>
                  {f.type === 'ok'    ? <CheckCircle size={10} /> :
                   f.type === 'error' ? <AlertCircle size={10} /> : null}
                  {f.text}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* URL BAR */}
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-gray-500 flex-shrink-0" />
            <input type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNavigate()}
              placeholder="Article URL (https:// auto-added if missing)…"
              className="flex-1 bg-transparent text-white text-sm placeholder-gray-600 focus:outline-none" />
            {urlInput && (
              <button onClick={() => setUrlInput('')} className="text-gray-600 hover:text-gray-400">
                <X size={13} />
              </button>
            )}
            <button onClick={handleReadArticle}
              disabled={!urlInput.trim() || selectedIds.length === 0}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1">
              <Globe size={10} /> Read
            </button>
            <button onClick={handleNavigate}
              disabled={!urlInput.trim() || selectedIds.length === 0}
              className="bg-green-600 hover:bg-green-500 disabled:opacity-30 text-white px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1">
              <ExternalLink size={10} /> Navigate
            </button>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 overflow-y-auto p-4">
          {selectedIds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="text-5xl mb-4">👈</div>
              <p className="text-lg font-medium">Select profiles from sidebar</p>
              <p className="text-sm mt-1">Then use batch controls above or per-profile actions below</p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedIds.map(id => {
                const profile = profiles.find(p => p.id === id);
                const state   = profileStates[id];
                if (!profile || !state) return null;
                const isStartingThis = startingIds.has(id) || stoppingIds.has(id);

                return (
                  <div key={id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    {/* Profile header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
                      {/* Status dot */}
                      {isStartingThis
                        ? <Loader size={14} className="text-yellow-400 animate-spin flex-shrink-0" />
                        : <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            state.status === 'active'   ? 'bg-green-500 animate-pulse' :
                            state.status === 'reading'  ? 'bg-emerald-400 animate-pulse' :
                            state.status === 'starting' ? 'bg-yellow-500 animate-pulse' :
                                                          'bg-gray-600'}`} />}

                      <span className="font-semibold text-sm text-white">{profile.name}</span>
                      <PlatformIcon platform={state.platform} />
                      <span className="text-xs text-gray-500">{profile.os}</span>
                      {profile.browserType && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          profile.browserType === 'multilogin' ? 'bg-purple-900/40 text-purple-400' :
                          profile.browserType === 'adspower'   ? 'bg-green-900/40 text-green-400' :
                                                                 'bg-blue-900/40 text-blue-400'}`}>
                          {profile.browserType}
                        </span>
                      )}

                      {/* Status badge */}
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                        state.status === 'reading'  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30' :
                        state.status === 'active'   ? 'bg-green-600/20 text-green-400 border border-green-600/30' :
                        state.status === 'starting' ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/30' :
                                                      'bg-gray-700/50 text-gray-400 border border-gray-600/30'}`}>
                        {state.status}
                      </span>

                      {/* keepAlive toggle */}
                      <button onClick={() => toggleKeepAlive(id)}
                        className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors"
                        title="Keep browser alive after reading">
                        {state.keepAlive
                          ? <ToggleRight size={16} className="text-green-500" />
                          : <ToggleLeft size={16} className="text-gray-600" />}
                        Keep alive
                      </button>

                      {/* Remove from selection */}
                      <button onClick={() => toggleSelect(id)} className="text-gray-700 hover:text-gray-400 ml-2">
                        <X size={14} />
                      </button>
                    </div>

                    {/* Profile body */}
                    <div className="p-4 grid grid-cols-3 gap-4">
                      {/* Current article */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1.5 font-medium">Current Article</p>
                        {state.currentArticle ? (
                          <a href={state.currentArticle} target="_blank" rel="noreferrer"
                            className="text-xs text-emerald-400 truncate block hover:underline">
                            {state.currentArticle}
                          </a>
                        ) : (
                          <p className="text-xs text-gray-600">None</p>
                        )}
                        {state.status === 'reading' && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <Loader size={10} className="text-emerald-400 animate-spin" />
                            <span className="text-xs text-emerald-400">Reading in progress…</span>
                          </div>
                        )}
                      </div>

                      {/* Per-profile navigation */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1.5 font-medium">Navigate (this profile)</p>
                        <div className="flex gap-1">
                          <button onClick={() => sendToOne(id, 'goBack')}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                            ← Back
                          </button>
                          <button onClick={() => sendToOne(id, 'refresh')}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                            <RefreshCw size={10} /> Refresh
                          </button>
                          <button onClick={() => sendToOne(id, 'openHomepage')}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs">
                            🏠
                          </button>
                        </div>
                      </div>

                      {/* Per-profile scroll + actions */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1.5 font-medium">Actions (this profile)</p>
                        <div className="grid grid-cols-2 gap-1">
                          <button onClick={() => sendToOne(id, 'scrollUp')}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                            <ArrowUp size={9} /> Up
                          </button>
                          <button onClick={() => sendToOne(id, 'scrollDown')}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                            <ArrowDown size={9} /> Down
                          </button>
                          <button onClick={() => {
                            const url = normalizeUrl(urlInput);
                            if (url) sendToOne(id, 'readArticle', { url, title: 'Manual Read', trafficPreference: 'random' });
                            else pushFeedback([makeFeedback('Enter URL in the URL bar first', 'error')]);
                          }}
                            className="bg-emerald-800 hover:bg-emerald-700 text-emerald-200 px-2 py-1 rounded text-xs">
                            📖 Read
                          </button>
                          <button onClick={() => sendToOne(id, 'scrollToBottom')}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs">
                            ⬇ Bottom
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
