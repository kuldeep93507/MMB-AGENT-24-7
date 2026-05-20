import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Trash2, Download, Search, Copy, CheckCircle,
  ChevronsUp, ChevronsDown, RefreshCw, Server, Monitor,
  ChevronDown, AlertTriangle,
} from 'lucide-react';
import type { LogEntry } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerLog {
  id: string;
  level: string;
  message: string;
  profileId?: string;
  timestamp: number;
}

interface LogsPageProps {
  logs: LogEntry[];
  onClear: () => void;
  onClearByLevel: (level: LogEntry['level']) => void;
}

type LevelFilter = 'all' | 'info' | 'warn' | 'error' | 'success';
type LogSource   = 'frontend' | 'backend';

const PAGE_SIZE = 100;

const LEVEL_CONFIG: Record<string, {
  label: string; color: string; badge: string; dot: string; rowBg: string;
}> = {
  info:    { label: 'INFO',    color: 'text-blue-400',   badge: 'bg-blue-900/30 border-blue-600/30',   dot: 'bg-blue-500',   rowBg: 'border-transparent' },
  warn:    { label: 'WARN',    color: 'text-yellow-400', badge: 'bg-yellow-900/30 border-yellow-600/30',dot: 'bg-yellow-500', rowBg: 'border-yellow-900/30 bg-yellow-950/10' },
  error:   { label: 'ERROR',   color: 'text-red-400',    badge: 'bg-red-900/30 border-red-600/30',     dot: 'bg-red-500',    rowBg: 'border-red-900/30 bg-red-950/20' },
  success: { label: 'OK',      color: 'text-green-400',  badge: 'bg-green-900/30 border-green-600/30', dot: 'bg-green-500',  rowBg: 'border-green-900/20 bg-green-950/10' },
  debug:   { label: 'DEBUG',   color: 'text-gray-400',   badge: 'bg-gray-800 border-gray-700',         dot: 'bg-gray-500',   rowBg: 'border-transparent' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function confFor(level: string) {
  return LEVEL_CONFIG[level] ?? LEVEL_CONFIG.debug;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LogsPage({ logs, onClear, onClearByLevel }: LogsPageProps) {
  const [filter, setFilter]           = useState<LevelFilter>('all');
  const [search, setSearch]           = useState('');
  const [source, setSource]           = useState<LogSource>('frontend');
  const [serverLogs, setServerLogs]   = useState<ServerLog[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [page, setPage]               = useState(1);
  const [autoScroll, setAutoScroll]   = useState(true);
  const [copied, setCopied]           = useState<string | null>(null);
  const [showClearMenu, setShowClearMenu] = useState(false);
  const [clearConfirm, setClearConfirm]  = useState<'all' | LogEntry['level'] | null>(null);
  const containerRef                  = useRef<HTMLDivElement>(null);
  const prevLogLen                    = useRef(logs.length);

  // ─── Auto-scroll to top when new frontend logs arrive ─────────────────────
  useEffect(() => {
    if (source === 'frontend' && autoScroll && logs.length !== prevLogLen.current) {
      containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevLogLen.current = logs.length;
  }, [logs.length, autoScroll, source]);

  // ─── Fetch backend / server logs ──────────────────────────────────────────
  const fetchServerLogs = useCallback(async () => {
    setServerLoading(true);
    try {
      const res = await fetch('/backend-api/logs');
      if (res.ok) setServerLogs(await res.json());
    } catch {}
    setServerLoading(false);
  }, []);

  useEffect(() => {
    if (source === 'backend') fetchServerLogs();
  }, [source, fetchServerLogs]);

  // ─── Derived data ──────────────────────────────────────────────────────────

  const activeLogs = source === 'backend' ? serverLogs : logs;

  const filtered = activeLogs.filter(l => {
    if (filter !== 'all' && l.level !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const msg = l.message.toLowerCase();
      const name = ('profileName' in l ? (l as LogEntry).profileName : l.profileId) ?? '';
      if (!msg.includes(q) && !name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const displayed = filtered.slice(0, page * PAGE_SIZE);
  const hasMore   = filtered.length > displayed.length;

  const counts: Record<string, number> = { info: 0, warn: 0, error: 0, success: 0 };
  activeLogs.forEach(l => { if (l.level in counts) counts[l.level]++; });

  // ─── Actions ───────────────────────────────────────────────────────────────

  const copyLog = (log: typeof activeLogs[0]) => {
    const name = 'profileName' in log ? (log as LogEntry).profileName : log.profileId;
    const text = `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}]${name ? ` [${name}]` : ''} ${log.message}`;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(log.id);
    setTimeout(() => setCopied(null), 1500);
  };

  const exportLogs = () => {
    const rows = filtered.map(l => {
      const name = 'profileName' in l ? (l as LogEntry).profileName : l.profileId;
      return `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}]${name ? ` [${name}]` : ''} ${l.message}`;
    });
    const src = source === 'backend' ? 'server' : 'frontend';
    const lvl = filter !== 'all' ? `-${filter}` : '';
    const blob = new Blob([rows.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `sites-logs-${src}${lvl}-${isoDate()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const confirmClear = (type: 'all' | LogEntry['level']) => {
    setClearConfirm(type);
    setShowClearMenu(false);
  };

  const executeClear = () => {
    if (!clearConfirm) return;
    if (clearConfirm === 'all') onClear();
    else onClearByLevel(clearConfirm);
    setClearConfirm(null);
  };

  const scrollToTop    = () => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  const scrollToBottom = () => containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {activeLogs.length} entries · {source === 'frontend' ? 'Frontend store' : 'Backend server'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Source toggle */}
            <div className="flex items-center bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              <button onClick={() => { setSource('frontend'); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-all ${source === 'frontend' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                <Monitor size={12} /> Frontend
              </button>
              <button onClick={() => { setSource('backend'); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-all ${source === 'backend' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                <Server size={12} /> Server
                {source === 'backend' && (
                  <button onClick={e => { e.stopPropagation(); fetchServerLogs(); }}
                    className="ml-1 text-gray-400 hover:text-white">
                    <RefreshCw size={10} className={serverLoading ? 'animate-spin' : ''} />
                  </button>
                )}
              </button>
            </div>

            {/* Auto-scroll toggle */}
            <button onClick={() => setAutoScroll(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-all ${
                autoScroll ? 'bg-green-900/20 border-green-700/40 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
              <ChevronsUp size={12} /> Auto-scroll {autoScroll ? 'ON' : 'OFF'}
            </button>

            {/* Export filtered */}
            <button onClick={exportLogs}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-all text-xs">
              <Download size={13} /> Export{filter !== 'all' ? ` (${filter})` : ''}
            </button>

            {/* Clear menu */}
            <div className="relative">
              <button onClick={() => setShowClearMenu(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-900/30 border border-red-700/30 text-red-400 hover:bg-red-900/50 transition-all text-xs">
                <Trash2 size={13} /> Clear <ChevronDown size={11} />
              </button>
              {showClearMenu && (
                <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden min-w-44">
                  <button onClick={() => confirmClear('all')}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-red-400 hover:bg-red-900/20 transition-colors">
                    <Trash2 size={12} /> Clear All Logs
                  </button>
                  {(['error', 'warn', 'info', 'success'] as const).map(lvl => (
                    <button key={lvl} onClick={() => confirmClear(lvl)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-gray-800 transition-colors ${confFor(lvl).color}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${confFor(lvl).dot}`} />
                      Clear {lvl} ({counts[lvl] ?? 0})
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confirm clear dialog */}
        {clearConfirm && (
          <div className="mb-3 flex items-center gap-3 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-2.5">
            <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
            <span className="text-red-300 text-xs flex-1">
              {clearConfirm === 'all'
                ? 'Clear ALL logs? This cannot be undone.'
                : `Clear all "${clearConfirm}" logs?`}
            </span>
            <button onClick={executeClear}
              className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs hover:bg-red-500 transition-colors">
              Yes, Clear
            </button>
            <button onClick={() => setClearConfirm(null)}
              className="px-3 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs hover:bg-gray-600 transition-colors">
              Cancel
            </button>
          </div>
        )}

        {/* Filters + Search */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'success', 'info', 'warn', 'error'] as const).map(l => {
            const conf = l === 'all' ? null : confFor(l);
            const count = l === 'all' ? activeLogs.length : (counts[l] ?? 0);
            return (
              <button key={l} onClick={() => { setFilter(l); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all
                  ${filter === l
                    ? l === 'all'
                      ? 'bg-gray-700 border-gray-600 text-white'
                      : `${conf!.badge} ${conf!.color}`
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                {conf && <div className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />}
                <span className="uppercase">{l}</span>
                <span className="opacity-70">({count})</span>
              </button>
            );
          })}

          <div className="relative ml-auto">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Search logs…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-gray-500 w-52" />
          </div>
        </div>
      </div>

      {/* Log Entries */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs">
        {/* Scroll navigation */}
        {displayed.length > 10 && (
          <div className="flex justify-end gap-1 mb-2 sticky top-0 z-10">
            <button onClick={scrollToTop}
              className="p-1.5 bg-gray-800/90 border border-gray-700 rounded-lg text-gray-500 hover:text-white transition-colors" title="Jump to top">
              <ChevronsUp size={12} />
            </button>
            <button onClick={scrollToBottom}
              className="p-1.5 bg-gray-800/90 border border-gray-700 rounded-lg text-gray-500 hover:text-white transition-colors" title="Jump to bottom">
              <ChevronsDown size={12} />
            </button>
          </div>
        )}

        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-gray-400 font-sans font-semibold text-base mb-2">
              {source === 'backend' && serverLoading ? 'Loading server logs…' : 'No logs found'}
            </h3>
            <p className="text-gray-600 font-sans text-sm">
              {filter !== 'all' || search
                ? 'Try changing the filter or clearing the search'
                : source === 'backend'
                  ? 'Server activity will appear here'
                  : 'System activity will appear here in real-time'}
            </p>
          </div>
        ) : (
          <>
            {displayed.map(log => {
              const conf = confFor(log.level);
              const profileLabel = 'profileName' in log
                ? (log as LogEntry).profileName
                : log.profileId
                  ? log.profileId.slice(0, 8)
                  : null;

              return (
                <div key={log.id} className={`group flex items-start gap-3 px-3 py-2 rounded-xl border transition-all hover:bg-gray-800/40 ${conf.rowBg}`}>
                  {/* Timestamp */}
                  <span className="text-gray-600 flex-shrink-0 w-28 text-right pt-0.5">
                    {fmtTimestamp(log.timestamp)}
                  </span>

                  {/* Level badge */}
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-bold border ${conf.badge} ${conf.color} w-14 text-center`}>
                    {conf.label}
                  </span>

                  {/* Profile name */}
                  {profileLabel && (
                    <span
                      title={profileLabel}
                      className="text-purple-400 flex-shrink-0 max-w-[140px] truncate cursor-default">
                      [{profileLabel}]
                    </span>
                  )}

                  {/* Message */}
                  <span className={`flex-1 leading-relaxed break-all ${conf.color}`}>
                    {log.message}
                  </span>

                  {/* Copy button */}
                  <button onClick={() => copyLog(log)}
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 text-gray-600 hover:text-gray-300 transition-all"
                    title="Copy log line">
                    {copied === log.id
                      ? <CheckCircle size={12} className="text-green-400" />
                      : <Copy size={12} />}
                  </button>
                </div>
              );
            })}

            {/* Load More */}
            {hasMore && (
              <div className="pt-2 pb-1 text-center">
                <button onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-white text-xs transition-all">
                  <ChevronDown size={12} />
                  Load {Math.min(PAGE_SIZE, filtered.length - displayed.length)} older entries
                  ({filtered.length - displayed.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-2 border-t border-gray-800 bg-gray-950/50 flex-shrink-0 text-xs text-gray-600 flex items-center gap-4">
        <span>
          {source === 'frontend'
            ? `📦 ${logs.length}/500 stored in memory`
            : `🖥️ ${serverLogs.length} server logs loaded`}
        </span>
        <span className={autoScroll ? 'text-green-600' : 'text-gray-700'}>
          🔄 Auto-scroll: {autoScroll ? 'On' : 'Off'}
        </span>
        {search && <span className="text-yellow-600">🔍 Searching: "{search}"</span>}
        <span className="ml-auto">{filtered.length} entries matched · showing {displayed.length}</span>
      </div>

      {/* Click-outside to close clear menu */}
      {showClearMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowClearMenu(false)} />
      )}
    </div>
  );
}
