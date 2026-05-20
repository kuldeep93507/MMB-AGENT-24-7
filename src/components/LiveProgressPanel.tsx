import { useState, useEffect } from 'react';
import { Activity, Loader, CheckCircle, XCircle, Clock, Tv, Square } from 'lucide-react';
import { backendUrl } from '../services/backendOrigin';
import type { Profile } from '../types';

interface WorkerStatus {
  profileId: string;
  status: string;
  currentVideo: string | null;
  progress: string;
  retries: number;
  logs: { time: string; level: string; message: string }[];
  results: { watched: number; failed: number; skipped: number } | null;
  uptime: number;
}

interface WorkerStats {
  total: number;
  running: number;
  done: number;
  error: number;
  waiting: number;
}

interface LiveProgressPanelProps {
  compact?: boolean;
  /** Resolve profile names on worker rows */
  profiles?: Profile[];
  /** When false, always show idle card (dashboard). When true, hide if idle (analytics embed). */
  hideWhenIdle?: boolean;
}

const ACTIVE_WORKER_STATUSES = new Set([
  'running', 'watching', 'searching', 'waiting', 'starting', 'connecting',
]);

export default function LiveProgressPanel({ compact = false, profiles = [], hideWhenIdle = false }: LiveProgressPanelProps) {
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);
  const [stats, setStats] = useState<WorkerStats>({ total: 0, running: 0, done: 0, error: 0, waiting: 0 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  // Poll workers every 3 seconds
  useEffect(() => {
    const fetchWorkers = async () => {
      try {
        const res = await fetch(backendUrl('/api/workers'));
        if (res.ok) {
          const data = await res.json();
          setWorkers(data.workers || []);
          setStats(data.stats || { total: 0, running: 0, done: 0, error: 0, waiting: 0 });
          setIsActive(data.stats?.running > 0 || data.stats?.waiting > 0);
        }
      } catch {}
    };
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 3000);
    return () => clearInterval(interval);
  }, []);

  // Stop a single worker
  const stopWorker = async (profileId: string) => {
    try {
      await fetch(backendUrl(`/api/workers/stop/${profileId}`), { method: 'POST' });
    } catch {}
  };

  // Stop all
  const stopAll = async () => {
    try {
      await fetch(backendUrl('/api/schedule/stop'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch {}
  };

  // Format uptime
  const formatUptime = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    if (hr > 0) return `${hr}h ${min % 60}m`;
    if (min > 0) return `${min}m ${sec % 60}s`;
    return `${sec}s`;
  };

  // Overall progress percentage
  const overallProgress = stats.total > 0 ? Math.round(((stats.done + stats.error) / stats.total) * 100) : 0;

  const profileName = (profileId: string) =>
    profiles.find((p) => p.id === profileId)?.name || `Profile-${profileId.slice(-4)}`;

  if (!isActive && workers.length === 0) {
    if (hideWhenIdle) return null;
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-gray-600" />
          <div>
            <h3 className="text-gray-400 font-medium text-sm">Live Progress</h3>
            <p className="text-gray-600 text-xs">No active tasks. Start a schedule or shuffle to see progress here.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900 border ${isActive ? 'border-green-700/40' : 'border-gray-800'} rounded-2xl p-5 ${isActive ? 'ring-1 ring-green-500/20' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? 'bg-green-600 animate-pulse' : 'bg-gray-700'}`}>
            <Activity size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              Live Progress
              {isActive && <span className="text-xs text-green-400 animate-pulse">● RUNNING</span>}
            </h3>
            <p className="text-gray-500 text-xs">{stats.total} workers • {stats.running} active • {stats.done} done</p>
          </div>
        </div>
        {isActive && (
          <button onClick={stopAll} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1">
            <Square size={12} /> Stop All
          </button>
        )}
      </div>

      {/* Overall Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400">Overall Progress</span>
          <span className="text-xs font-mono text-white">{overallProgress}% ({stats.done + stats.error}/{stats.total})</span>
        </div>
        <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500 relative" style={{ width: `${overallProgress}%`, background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
            {isActive && <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />}
          </div>
        </div>
        <div className="flex gap-4 mt-1.5 text-xs">
          <span className="text-green-400">✓ {stats.done} done</span>
          <span className="text-yellow-400">⏳ {stats.running} running</span>
          <span className="text-blue-400">⏸ {stats.waiting} waiting</span>
          {stats.error > 0 && <span className="text-red-400">✗ {stats.error} failed</span>}
        </div>
      </div>

      {/* Per-Worker Progress */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {workers.map(w => {
          const [done, total] = (w.progress || '0/0').split('/').map(Number);
          const workerPercent = total > 0 ? Math.round((done / total) * 100) : 0;
          const isRunning = w.status === 'running' || w.status === 'watching' || w.status === 'searching';
          const isDone = w.status === 'done';
          const isError = w.status === 'error' || w.status === 'crashed';
          const isExpanded = expanded === w.profileId;

          return (
            <div key={w.profileId} className={`rounded-xl border transition-all ${isRunning ? 'border-green-700/40 bg-green-900/10' : isDone ? 'border-blue-700/30 bg-blue-900/5' : isError ? 'border-red-700/30 bg-red-900/5' : 'border-gray-700 bg-gray-800/50'}`}>
              {/* Worker Row */}
              <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : w.profileId)}>
                {/* Status Icon */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isRunning ? 'bg-green-600' : isDone ? 'bg-blue-600' : isError ? 'bg-red-600' : 'bg-gray-600'}`}>
                  {isRunning && <Loader size={12} className="text-white animate-spin" />}
                  {isDone && <CheckCircle size={12} className="text-white" />}
                  {isError && <XCircle size={12} className="text-white" />}
                  {!isRunning && !isDone && !isError && <Clock size={12} className="text-white" />}
                </div>

                {/* Profile Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-xs font-medium truncate">{profileName(w.profileId)}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isRunning ? 'bg-green-900/50 text-green-400' : isDone ? 'bg-blue-900/50 text-blue-400' : isError ? 'bg-red-900/50 text-red-400' : 'bg-gray-700 text-gray-400'}`}>
                      {w.status}
                    </span>
                  </div>
                  {/* Current Video */}
                  {w.currentVideo && isRunning && (
                    <p className="text-xs text-gray-400 truncate mt-0.5 flex items-center gap-1">
                      <Tv size={10} className="text-red-400 flex-shrink-0" />
                      {w.currentVideo}
                    </p>
                  )}
                </div>

                {/* Progress */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-20">
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${isDone ? 'bg-blue-500' : isError ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${workerPercent}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-mono text-gray-300 w-10 text-right">{w.progress || '0/0'}</span>
                  <span className="text-xs text-gray-500 w-12 text-right">{formatUptime(w.uptime)}</span>
                  {isRunning && (
                    <button onClick={(e) => { e.stopPropagation(); stopWorker(w.profileId); }}
                      className="text-red-400 hover:text-red-300 p-1 rounded transition-all">
                      <Square size={10} />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Logs */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-700/50 mt-1 pt-2">
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {(w.logs || []).slice(-10).map((log, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-gray-600 flex-shrink-0 w-14">{new Date(log.time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${log.level === 'error' ? 'bg-red-500' : log.level === 'success' ? 'bg-green-500' : log.level === 'warn' ? 'bg-yellow-500' : 'bg-gray-500'}`} />
                        <span className={`${log.level === 'error' ? 'text-red-400' : log.level === 'success' ? 'text-green-400' : 'text-gray-400'}`}>{log.message}</span>
                      </div>
                    ))}
                    {(!w.logs || w.logs.length === 0) && <p className="text-gray-600 text-xs">No logs yet</p>}
                  </div>
                  {w.results && (
                    <div className="flex gap-3 mt-2 pt-2 border-t border-gray-700/50 text-xs">
                      <span className="text-green-400">✓ {w.results.watched} watched</span>
                      <span className="text-red-400">✗ {w.results.failed} failed</span>
                      {w.results.skipped > 0 && <span className="text-yellow-400">⏭ {w.results.skipped} skipped</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
