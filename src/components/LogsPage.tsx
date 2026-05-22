import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Trash2, Download, Search, RefreshCw, Pause, Play } from 'lucide-react';
import type { Profile, LogEntry, LogLevel, LogSource } from '../types';
import {
  fetchActivityLogs,
  clearActivityLogs,
  LOG_SOURCE_LABELS,
} from '../utils/logsApi';

interface LogsPageProps {
  profiles: Profile[];
  onClear?: () => void;
}

const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; badge: string; dot: string }> = {
  info: { label: 'INFO', color: 'text-blue-400', badge: 'bg-blue-900/30 border-blue-600/30', dot: 'bg-blue-500' },
  warn: { label: 'WARN', color: 'text-yellow-400', badge: 'bg-yellow-900/30 border-yellow-600/30', dot: 'bg-yellow-500' },
  error: { label: 'ERROR', color: 'text-red-400', badge: 'bg-red-900/30 border-red-600/30', dot: 'bg-red-500' },
  success: { label: 'OK', color: 'text-green-400', badge: 'bg-green-900/30 border-green-600/30', dot: 'bg-green-500' },
};

const SOURCES: (LogSource | 'all')[] = [
  'all', 'worker', 'scheduler', 'shuffle', 'backlink', 'profile', 'manual', 'settings', 'system',
];

function formatLogTime(ts: number): { date: string; time: string } {
  try {
    const d = new Date(ts);
    return {
      date: d.toLocaleDateString(),
      time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  } catch {
    return { date: '—', time: String(ts) };
  }
}

export default function LogsPage({ profiles, onClear }: LogsPageProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<LogSource | 'all'>('all');
  const [profileFilter, setProfileFilter] = useState('');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [loading, setLoading] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchActivityLogs({
        limit: 800,
        level: filter,
        source: sourceFilter,
        profileId: profileFilter || undefined,
        search: search.trim() || undefined,
      });
      setEntries(data.entries);
      setTotal(data.total);
      setFetchError('');
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filter, sourceFilter, profileFilter, search]);

  const displayEntries = useMemo(() => [...entries].reverse(), [entries]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!autoScroll || !logsContainerRef.current) return;
    const el = logsContainerRef.current;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [displayEntries, autoScroll]);

  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, error: 0, success: 0 };
    for (const e of entries) {
      if (e.level in c) c[e.level as LogLevel]++;
    }
    return c;
  }, [entries]);

  const handleClear = async () => {
    if (!window.confirm('Clear all activity logs on server?')) return;
    await clearActivityLogs();
    onClear?.();
    setEntries([]);
    setTotal(0);
    await refresh();
  };

  const exportLogs = (format: 'txt' | 'json') => {
    const logsToExport = displayEntries;
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(logsToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mmb-activity-logs-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
      return;
    }

    const text = logsToExport.map((l) => {
      const { date, time } = formatLogTime(l.timestamp);
      const src = l.source ? LOG_SOURCE_LABELS[l.source] : '—';
      return `[${date} ${time}] [${l.level.toUpperCase()}] [${src}] ${l.profileName ? `[${l.profileName}] ` : ''}${l.message}`;
    }).join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mmb-activity-logs-${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Server-backed timeline — workers, schedules, profiles ({total} stored)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${fetchError ? 'border-red-700/40 text-red-400' : 'border-gray-700 text-gray-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${fetchError ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`} />
              {fetchError || 'Live · 3s'}
            </div>
            <button type="button" onClick={refresh} className="p-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-white" title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button type="button" onClick={() => exportLogs('txt')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 text-sm">
              <Download size={14} /> TXT
            </button>
            <button type="button" onClick={() => exportLogs('json')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 text-sm">
              <Download size={14} /> JSON
            </button>
            <button type="button" onClick={handleClear} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-900/30 border border-red-700/30 text-red-400 hover:bg-red-900/50 text-sm">
              <Trash2 size={14} /> Clear
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'success', 'info', 'warn', 'error'] as const).map((l) => {
            const conf = l === 'all' ? null : LEVEL_CONFIG[l];
            return (
              <button
                key={l}
                type="button"
                onClick={() => setFilter(l)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium uppercase transition-all
                  ${filter === l
                    ? l === 'all' ? 'bg-gray-700 border-gray-600 text-white' : `${conf!.badge} ${conf!.color}`
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}
              >
                {conf && <div className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />}
                {l} {l !== 'all' && counts[l] > 0 ? `(${counts[l]})` : ''}
              </button>
            );
          })}

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as LogSource | 'all')}
            className="bg-gray-800 border border-gray-700 text-gray-300 rounded-xl px-3 py-1.5 text-xs"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All sources' : LOG_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>

          <select
            value={profileFilter}
            onChange={(e) => setProfileFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-300 rounded-xl px-3 py-1.5 text-xs max-w-[160px]"
          >
            <option value="">All profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <div className="relative ml-auto">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search message..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-gray-500 w-48"
            />
          </div>
        </div>
      </div>

      <div ref={logsContainerRef} className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs">
        {loading && entries.length === 0 ? (
          <div className="text-center py-16 text-gray-600">Loading logs…</div>
        ) : displayEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-gray-400 font-sans font-semibold text-base mb-2">No logs match</h3>
            <p className="text-gray-600 font-sans text-sm text-center max-w-sm">
              Start a schedule, shuffle, or profile action. Worker logs stream here automatically.
            </p>
          </div>
        ) : (
          displayEntries.map((log) => {
            const conf = LEVEL_CONFIG[log.level];
            const { date, time } = formatLogTime(log.timestamp);
            const srcLabel = log.source ? LOG_SOURCE_LABELS[log.source] : '—';
            return (
              <div
                key={log.id}
                className={`flex items-start gap-2 px-3 py-2 rounded-xl border transition-all hover:bg-gray-800/30
                  ${log.level === 'error' ? 'border-red-900/30 bg-red-950/20' :
                    log.level === 'warn' ? 'border-yellow-900/30 bg-yellow-950/10' :
                    log.level === 'success' ? 'border-green-900/20 bg-green-950/10' :
                    'border-transparent'}`}
              >
                <span className="text-gray-600 flex-shrink-0 w-[72px] text-right leading-tight">
                  <span className="block text-[10px]">{date}</span>
                  <span>{time}</span>
                </span>
                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${conf.badge} ${conf.color} w-11 text-center`}>
                  {conf.label}
                </span>
                <span className="text-gray-500 flex-shrink-0 w-16 truncate text-[10px] uppercase" title={srcLabel}>
                  {srcLabel}
                </span>
                {log.profileName && (
                  <span className="text-purple-400 flex-shrink-0 max-w-[100px] truncate text-[10px]">
                    [{log.profileName}]
                  </span>
                )}
                <span className={`flex-1 leading-relaxed ${
                  log.level === 'error' ? 'text-red-300' :
                  log.level === 'warn' ? 'text-yellow-300' :
                  log.level === 'success' ? 'text-green-300' :
                  'text-gray-300'}`}>
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="px-6 py-2 border-t border-gray-800 bg-gray-950/50 flex-shrink-0 text-xs text-gray-600 flex items-center gap-4 flex-wrap">
        <span>💾 Server: up to 2000 entries (activity_logs.json)</span>
        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          className="flex items-center gap-1 hover:text-gray-400"
        >
          {autoScroll ? <Pause size={12} /> : <Play size={12} />}
          Auto-scroll: {autoScroll ? 'On' : 'Off'}
        </button>
        <span className="ml-auto">{displayEntries.length} shown</span>
      </div>
    </div>
  );
}
