import { useState, useEffect, useCallback } from 'react';
import { Plus, Play, Trash2, Edit3, Clock, Users, Globe, StopCircle, Copy, CheckSquare } from 'lucide-react';
import type { Profile, Site } from '../types';
import { useStore } from '../store/useStore';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type TrafficSource = 'random' | 'google' | 'direct' | 'internal' | 'bing' | 'duckduckgo' | 'yahoo' | 'backlinks';
type ScrollSpeed = 'slow' | 'medium' | 'fast';
type RepeatInterval = '1hr' | '3hr' | '6hr' | '12hr' | 'daily';

interface Schedule {
  id: string;
  name: string;
  provider: string;
  selectedProfiles: string[];
  selectedSites: string[];
  profileDelayMin: number;
  profileDelayMax: number;
  articleDelayMin: number;
  articleDelayMax: number;
  readTimeMin: number;
  readTimeMax: number;
  scrollSpeed: ScrollSpeed;
  articlesPerSession: number;
  runMode: 'manual' | 'scheduled';
  scheduledTime: string;
  repeatEnabled: boolean;
  repeatInterval: RepeatInterval;
  trafficSource: TrafficSource;
  status: 'idle' | 'running' | 'completed' | 'scheduled';
  createdAt: string;
  lastRun: string | null;
  nextRun: string | null;
}

interface ProgressEntry {
  profileId: string;
  status: 'starting' | 'connected' | 'reading' | 'done' | 'error' | 'skipped';
  articlesRead: number;
  startedAt?: number;
  completedAt?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TRAFFIC_SOURCES: { value: TrafficSource; label: string; icon: string }[] = [
  { value: 'random',     label: 'Random Mix',  icon: '🎲' },
  { value: 'google',     label: 'Google',      icon: '🔍' },
  { value: 'direct',     label: 'Direct',      icon: '🔗' },
  { value: 'internal',   label: 'Internal',    icon: '↩️' },
  { value: 'bing',       label: 'Bing',        icon: '🔵' },
  { value: 'duckduckgo', label: 'DuckDuckGo',  icon: '🦆' },
  { value: 'yahoo',      label: 'Yahoo',       icon: '🟣' },
  { value: 'backlinks',  label: 'Backlinks',   icon: '🔙' },
];

const REPEAT_OPTIONS: { value: RepeatInterval; label: string }[] = [
  { value: '1hr',   label: 'Every 1 hour' },
  { value: '3hr',   label: 'Every 3 hours' },
  { value: '6hr',   label: 'Every 6 hours' },
  { value: '12hr',  label: 'Every 12 hours' },
  { value: 'daily', label: 'Daily' },
];

const REPEAT_MS: Record<RepeatInterval, number> = {
  '1hr':   3_600_000,
  '3hr':  10_800_000,
  '6hr':  21_600_000,
  '12hr': 43_200_000,
  'daily': 86_400_000,
};

const STATUS_COLORS: Record<string, string> = {
  idle:      'bg-gray-600 text-white',
  running:   'bg-green-500 text-white animate-pulse',
  completed: 'bg-blue-500 text-white',
  scheduled: 'bg-purple-500 text-white',
};

const PROGRESS_COLORS: Record<string, string> = {
  starting:  'text-yellow-400',
  connected: 'text-blue-400',
  reading:   'text-green-400',
  done:      'text-emerald-400',
  error:     'text-red-400',
  skipped:   'text-gray-500',
};

const generateId = () => Math.random().toString(36).slice(2, 11);

function calcNextRun(interval: RepeatInterval): string {
  return new Date(Date.now() + REPEAT_MS[interval]).toISOString().slice(0, 16);
}

function defaultSchedule(provider: string): Schedule {
  return {
    id: generateId(), name: '', provider,
    selectedProfiles: [], selectedSites: [],
    profileDelayMin: 5, profileDelayMax: 30,
    articleDelayMin: 20, articleDelayMax: 60,
    readTimeMin: 30, readTimeMax: 300,
    scrollSpeed: 'medium', articlesPerSession: 5,
    runMode: 'manual', scheduledTime: '',
    repeatEnabled: false, repeatInterval: '6hr',
    trafficSource: 'random',
    status: 'idle', createdAt: new Date().toISOString().split('T')[0],
    lastRun: null, nextRun: null,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SchedulerPageProps {
  profiles: Profile[];
  sites: Site[];
}

export default function SchedulerPage({ profiles, sites }: SchedulerPageProps) {
  const browserProvider = useStore((s) => s.browserProvider);

  const [view, setView] = useState<'list' | 'create'>('list');
  const [schedules, setSchedules] = useState<Schedule[]>(() => {
    try {
      const d = localStorage.getItem('mmb_sites_schedules');
      return d ? JSON.parse(d) : [];
    } catch { return []; }
  });
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [liveProgress, setLiveProgress] = useState<Record<string, ProgressEntry[]>>({});

  // Persist schedules
  useEffect(() => {
    try { localStorage.setItem('mmb_sites_schedules', JSON.stringify(schedules)); } catch {}
  }, [schedules]);

  // ── Fix #1 + #3: Status polling — update running→completed, handle repeat ──
  useEffect(() => {
    const hasRunning = schedules.some(s => s.status === 'running');
    if (!hasRunning) return;

    const t = setInterval(async () => {
      try {
        const res = await fetch('/backend-api/api/scheduler/status');
        const data: Record<string, { status: string; completedAt?: number; progress?: ProgressEntry[] }> = await res.json();

        // Update live progress display
        const newProgress: Record<string, ProgressEntry[]> = {};
        for (const [id, info] of Object.entries(data)) {
          if (info.progress) newProgress[id] = info.progress;
        }
        setLiveProgress(newProgress);

        setSchedules(prev => prev.map(s => {
          const srv = data[s.id];
          if (!srv || s.status !== 'running') return s;
          if (srv.status === 'completed' || srv.status === 'idle') {
            // Fix #3: calculate next run for repeating schedules
            if (s.repeatEnabled && s.repeatInterval && srv.status === 'completed') {
              return { ...s, status: 'scheduled', nextRun: calcNextRun(s.repeatInterval) };
            }
            return { ...s, status: srv.status === 'completed' ? 'completed' : 'idle' };
          }
          return s;
        }));
      } catch {}
    }, 5000);

    return () => clearInterval(t);
  }, [schedules]);

  // ── Fix #2: Auto-scheduler — fire scheduled tasks when nextRun arrives ──
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date().toISOString().slice(0, 16);
      setSchedules(prev => prev.map(s => {
        if (s.status !== 'scheduled' || !s.nextRun) return s;
        if (s.nextRun <= now) {
          triggerRun(s);
          return { ...s, status: 'running', lastRun: new Date().toISOString() };
        }
        return s;
      }));
    }, 60_000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fix #13: Resolve articles from selected sites, include in payload ──
  const buildPayload = useCallback((schedule: Schedule) => {
    const resolvedArticles = sites
      .filter(site => schedule.selectedSites.includes(site.id))
      .flatMap(site => site.articles.filter(a => a.enabled).map(a => ({ url: a.url, title: a.title })));
    return { ...schedule, resolvedArticles };
  }, [sites]);

  const triggerRun = useCallback(async (schedule: Schedule) => {
    try {
      await fetch('/backend-api/api/scheduler/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(schedule)),
      });
    } catch {}
  }, [buildPayload]);

  // ── Fix #1: Run handler — status polling handles completion ──
  const handleRun = async (id: string) => {
    const schedule = schedules.find(s => s.id === id);
    if (!schedule) return;
    setSchedules(p => p.map(s => s.id === id ? { ...s, status: 'running', lastRun: new Date().toISOString() } : s));
    await triggerRun(schedule);
  };

  // ── Fix #5: Stop running schedule ──
  const handleStop = async (id: string) => {
    try {
      await fetch('/backend-api/api/scheduler/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId: id }),
      });
    } catch {}
    setSchedules(p => p.map(s => s.id === id ? { ...s, status: 'idle' } : s));
  };

  const handleDelete = (id: string) => setSchedules(prev => prev.filter(s => s.id !== id));

  // ── Fix #14: Duplicate schedule ──
  const handleDuplicate = (s: Schedule) => {
    setSchedules(prev => [...prev, {
      ...s, id: generateId(), name: `${s.name} (Copy)`,
      status: 'idle', lastRun: null, nextRun: null,
      createdAt: new Date().toISOString().split('T')[0],
    }]);
  };

  const handleCreate = () => {
    setEditingSchedule(defaultSchedule(browserProvider || 'morelogin'));
    setActiveStep(1);
    setView('create');
  };

  const handleSave = () => {
    if (!editingSchedule) return;
    const toSave = { ...editingSchedule };
    if (toSave.runMode === 'scheduled' && toSave.scheduledTime) {
      toSave.status = 'scheduled';
      toSave.nextRun = toSave.scheduledTime;
    }
    setSchedules(prev => {
      const exists = prev.find(s => s.id === toSave.id);
      return exists ? prev.map(s => s.id === toSave.id ? toSave : s) : [...prev, toSave];
    });
    setView('list');
  };

  const upd = (patch: Partial<Schedule>) =>
    setEditingSchedule(prev => prev ? { ...prev, ...patch } : prev);

  // ── Fix #10: Step validation ──
  const canGoNext = () => {
    if (!editingSchedule) return false;
    if (activeStep === 1) return editingSchedule.name.trim().length > 0 && editingSchedule.selectedProfiles.length > 0;
    if (activeStep === 2) return editingSchedule.selectedSites.length > 0;
    return true;
  };

  const running = schedules.filter(s => s.status === 'running').length;
  const scheduled = schedules.filter(s => s.status === 'scheduled').length;

  // ─────────────────────────────────────────────
  // LIST VIEW
  // ─────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Scheduler</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                {schedules.length} schedules • {running} running • {scheduled} scheduled
              </p>
            </div>
            <button onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold shadow-lg shadow-green-900/30 transition-all">
              <Plus size={15} /> New Schedule
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total',     val: schedules.length,                               icon: '📋', color: 'border-blue-700/30 bg-blue-900/10' },
              { label: 'Running',   val: running,                                         icon: '▶️', color: 'border-green-700/30 bg-green-900/10' },
              { label: 'Scheduled', val: scheduled,                                       icon: '⏰', color: 'border-purple-700/30 bg-purple-900/10' },
              { label: 'Sites',     val: sites.filter(s => s.status === 'active').length, icon: '🌐', color: 'border-emerald-700/30 bg-emerald-900/10' },
            ].map(s => (
              <div key={s.label} className={`border rounded-xl p-3 ${s.color}`}>
                <div className="text-lg">{s.icon}</div>
                <div className="text-xl font-bold text-white">{s.val}</div>
                <div className="text-gray-500 text-xs">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <div className="text-6xl mb-4">📅</div>
              <h3 className="text-gray-400 font-semibold text-lg mb-2">No Schedules Yet</h3>
              <p className="text-gray-600 text-sm mb-6">Create a schedule to automate article reading across profiles</p>
              <button onClick={handleCreate}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-all">
                <Plus size={16} /> Create First Schedule
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map(s => {
                const progress = liveProgress[s.id] || [];
                const totalProfiles = s.selectedProfiles.length;
                const doneProfiles = progress.filter(p => p.status === 'done' || p.status === 'error').length;
                const totalArticles = progress.reduce((n, p) => n + (p.articlesRead || 0), 0);

                return (
                  <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h3 className="text-lg font-bold text-white">{s.name || 'Unnamed'}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status]}`}>
                            {s.status.toUpperCase()}
                          </span>
                          <span className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                            {s.runMode === 'scheduled' ? '⏰ Auto' : '🖱️ Manual'}
                          </span>
                          {s.repeatEnabled && (
                            <span className="bg-purple-900/40 text-purple-400 border border-purple-700/30 text-xs px-2 py-0.5 rounded-full">
                              🔁 {s.repeatInterval}
                            </span>
                          )}
                          <span className="bg-gray-800/60 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                            {s.provider || 'morelogin'}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-gray-400 flex-wrap">
                          <span className="flex items-center gap-1"><Users size={12} /> {s.selectedProfiles.length} profiles</span>
                          <span className="flex items-center gap-1"><Globe size={12} /> {s.selectedSites.length} sites</span>
                          <span className="flex items-center gap-1"><Clock size={12} /> {s.articleDelayMin}-{s.articleDelayMax}s delay</span>
                          <span>📖 {s.readTimeMin}-{s.readTimeMax}s read</span>
                          <span>📄 {s.articlesPerSession} articles/session</span>
                          {(() => {
                            const src = TRAFFIC_SOURCES.find(t => t.value === s.trafficSource);
                            return src ? <span>{src.icon} {src.label}</span> : null;
                          })()}
                        </div>

                        {s.nextRun && (
                          <p className="text-xs text-purple-400 mt-1">Next: {new Date(s.nextRun).toLocaleString()}</p>
                        )}
                        {s.lastRun && (
                          <p className="text-xs text-gray-500 mt-0.5">Last: {new Date(s.lastRun).toLocaleString()}</p>
                        )}

                        {/* Fix #11: Live progress */}
                        {s.status === 'running' && progress.length > 0 && (
                          <div className="mt-3 bg-gray-800/50 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs text-gray-400 font-medium">
                                Progress: {doneProfiles}/{totalProfiles} profiles • {totalArticles} articles read
                              </span>
                              <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 transition-all"
                                  style={{ width: `${totalProfiles ? (doneProfiles / totalProfiles) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {progress.map((p, idx) => (
                                <span key={idx} className={`text-xs px-2 py-0.5 rounded-full bg-gray-700 ${PROGRESS_COLORS[p.status]}`}>
                                  {p.profileId.slice(-6)} · {p.status}{p.articlesRead ? ` (${p.articlesRead})` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                        {/* Fix #5: Stop button for running schedules */}
                        {s.status === 'running' ? (
                          <button onClick={() => handleStop(s.id)} title="Stop Schedule"
                            className="bg-red-700 hover:bg-red-600 text-white px-3 py-2 rounded-xl text-sm transition-all">
                            <StopCircle size={14} />
                          </button>
                        ) : (
                          <button onClick={() => handleRun(s.id)} title="Run Now"
                            disabled={s.status === 'running'}
                            className="bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-3 py-2 rounded-xl text-sm transition-all">
                            <Play size={14} />
                          </button>
                        )}
                        <button onClick={() => { setEditingSchedule(s); setActiveStep(1); setView('create'); }} title="Edit"
                          className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-xl text-sm transition-all">
                          <Edit3 size={14} />
                        </button>
                        {/* Fix #14: Duplicate */}
                        <button onClick={() => handleDuplicate(s)} title="Duplicate"
                          className="bg-blue-900/40 hover:bg-blue-800/60 text-blue-400 px-3 py-2 rounded-xl text-sm transition-all">
                          <Copy size={14} />
                        </button>
                        <button onClick={() => handleDelete(s.id)} title="Delete"
                          className="bg-red-900/40 hover:bg-red-800/60 text-red-400 px-3 py-2 rounded-xl text-sm transition-all">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // CREATE / EDIT WIZARD
  // ─────────────────────────────────────────────
  if (!editingSchedule) return null;

  const STEPS = [
    { num: 1, label: 'Name & Profiles', icon: '📝' },
    { num: 2, label: 'Sites & Traffic',  icon: '🌐' },
    { num: 3, label: 'Timing & Delays',  icon: '⏰' },
    { num: 4, label: 'Review',           icon: '✅' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Wizard Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setView('list')} className="text-gray-400 hover:text-white text-sm">← Back</button>
          <span className="text-gray-600">/</span>
          <span className="text-white font-semibold">{editingSchedule.name || 'New Schedule'}</span>
        </div>
        <div className="flex items-center justify-between relative">
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-800 z-0" />
          <div className="absolute top-5 left-0 h-0.5 bg-green-600 z-0 transition-all duration-500"
            style={{ width: `${((activeStep - 1) / (STEPS.length - 1)) * 100}%` }} />
          {STEPS.map(step => (
            <div key={step.num} className="flex flex-col items-center z-10">
              <button onClick={() => step.num < activeStep && setActiveStep(step.num)}
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-all
                  ${activeStep === step.num ? 'bg-green-600 border-green-500 text-white shadow-lg shadow-green-900/50'
                    : activeStep > step.num ? 'bg-green-900 border-green-600 text-green-300'
                    : 'bg-gray-900 border-gray-700 text-gray-500'}`}>
                {activeStep > step.num ? '✓' : step.icon}
              </button>
              <span className={`text-xs mt-2 font-medium ${activeStep === step.num ? 'text-green-400' : 'text-gray-500'}`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Wizard Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* ── Step 1: Name & Profiles ── */}
          {activeStep === 1 && (
            <>
              <h2 className="text-xl font-bold">📝 Schedule Name & Profiles</h2>

              <div className="space-y-1">
                <label className="text-gray-400 text-xs">Schedule Name *</label>
                <input type="text" value={editingSchedule.name}
                  onChange={e => upd({ name: e.target.value })}
                  placeholder="e.g. Morning Traffic Boost, SEO Campaign..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-green-500" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="font-semibold text-gray-200">
                    Profiles <span className="text-green-400">({editingSchedule.selectedProfiles.length} selected)</span>
                    {editingSchedule.selectedProfiles.length === 0 && (
                      <span className="text-red-400 text-xs ml-2">* required</span>
                    )}
                  </label>
                  <button onClick={() => upd({
                    selectedProfiles: editingSchedule.selectedProfiles.length === profiles.length
                      ? [] : profiles.map(p => p.id)
                  })} className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300">
                    <CheckSquare size={12} />
                    {editingSchedule.selectedProfiles.length === profiles.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                {profiles.length === 0 ? (
                  <div className="bg-gray-800 rounded-xl p-4 text-center text-gray-500 text-sm">
                    No profiles loaded. Go to Profiles tab and click Refresh.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {profiles.map(p => {
                      const selected = editingSchedule.selectedProfiles.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => {
                          const sel = selected
                            ? editingSchedule.selectedProfiles.filter(x => x !== p.id)
                            : [...editingSchedule.selectedProfiles, p.id];
                          upd({ selectedProfiles: sel });
                        }}
                          className={`flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all text-left
                            ${selected ? 'border-green-500 bg-green-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                            ${selected ? 'bg-green-600' : 'bg-gray-700'}`}>
                            {p.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-xs truncate text-white">{p.name}</p>
                            <p className="text-xs text-gray-500">{p.os} · {p.browserType || 'local'}</p>
                          </div>
                          {selected && <span className="text-green-400 text-xs flex-shrink-0">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Step 2: Sites & Traffic ── */}
          {activeStep === 2 && (
            <>
              <h2 className="text-xl font-bold">🌐 Sites & Traffic Source</h2>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="font-semibold text-gray-200">
                    Active Sites <span className="text-emerald-400">({editingSchedule.selectedSites.length} selected)</span>
                    {editingSchedule.selectedSites.length === 0 && (
                      <span className="text-red-400 text-xs ml-2">* at least 1 required</span>
                    )}
                  </label>
                  <button onClick={() => {
                    const all = sites.filter(s => s.status === 'active').map(s => s.id);
                    upd({ selectedSites: editingSchedule.selectedSites.length === all.length ? [] : all });
                  }} className="text-xs text-emerald-400 hover:text-emerald-300">
                    {editingSchedule.selectedSites.length === sites.filter(s => s.status === 'active').length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                {sites.filter(s => s.status === 'active').length === 0 ? (
                  <div className="bg-gray-800 rounded-xl p-4 text-center text-gray-500 text-sm">
                    No active sites. Add sites in the Sites tab first.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {sites.filter(s => s.status === 'active').map(site => {
                      const selected = editingSchedule.selectedSites.includes(site.id);
                      const articleCount = site.articles.filter(a => a.enabled).length;
                      return (
                        <button key={site.id} onClick={() => {
                          const sel = selected
                            ? editingSchedule.selectedSites.filter(x => x !== site.id)
                            : [...editingSchedule.selectedSites, site.id];
                          upd({ selectedSites: sel });
                        }}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left
                            ${selected ? 'border-emerald-500 bg-emerald-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}>
                          <Globe size={16} className={selected ? 'text-emerald-400 flex-shrink-0' : 'text-gray-500 flex-shrink-0'} />
                          <div className="flex-1">
                            <p className="font-medium text-sm text-white">{site.name}</p>
                            <p className="text-xs text-gray-500">{articleCount} enabled articles</p>
                          </div>
                          {selected && <span className="text-emerald-400 text-xs">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Fix #8: Full 8 traffic sources */}
              <div>
                <label className="text-gray-400 text-xs mb-2 block font-medium">Traffic Source</label>
                <div className="grid grid-cols-4 gap-2">
                  {TRAFFIC_SOURCES.map(src => (
                    <button key={src.value} onClick={() => upd({ trafficSource: src.value })}
                      className={`p-2.5 rounded-xl border text-xs text-center transition-all flex flex-col items-center gap-1
                        ${editingSchedule.trafficSource === src.value
                          ? 'border-green-500 bg-green-900/20 text-green-400'
                          : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'}`}>
                      <span className="text-base">{src.icon}</span>
                      <span>{src.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Step 3: Timing & Delays ── */}
          {activeStep === 3 && (
            <>
              <h2 className="text-xl font-bold">⏰ Timing & Delays</h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-gray-400 text-xs mb-1 block">Run Mode</label>
                  <div className="flex gap-2">
                    {(['manual', 'scheduled'] as const).map(m => (
                      <button key={m} onClick={() => upd({ runMode: m })}
                        className={`flex-1 py-2.5 rounded-xl border text-sm font-medium capitalize transition-all
                          ${editingSchedule.runMode === m
                            ? 'border-green-500 bg-green-900/20 text-green-400'
                            : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'}`}>
                        {m === 'manual' ? '🖱️ Manual' : '⏰ Scheduled (auto-run)'}
                      </button>
                    ))}
                  </div>
                </div>

                {editingSchedule.runMode === 'scheduled' && (
                  <>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">First Run Time</label>
                      <input type="datetime-local" value={editingSchedule.scheduledTime}
                        onChange={e => upd({ scheduledTime: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">Repeat Interval</label>
                      <select value={editingSchedule.repeatInterval}
                        onChange={e => upd({ repeatInterval: e.target.value as RepeatInterval, repeatEnabled: true })}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none">
                        {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-gray-800 pt-4">
                <p className="text-gray-400 text-xs font-medium mb-3">Profile Start Stagger</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Min delay (sec)</label>
                    <input type="number" min={0} value={editingSchedule.profileDelayMin}
                      onChange={e => upd({ profileDelayMin: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Max delay (sec)</label>
                    <input type="number" min={0} value={editingSchedule.profileDelayMax}
                      onChange={e => upd({ profileDelayMax: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-800 pt-4">
                <p className="text-gray-400 text-xs font-medium mb-3">Article Delay (between articles)</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Min (sec)</label>
                    <input type="number" min={0} value={editingSchedule.articleDelayMin}
                      onChange={e => upd({ articleDelayMin: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                  </div>
                  <div>
                    {/* Fix #12: articleDelayMax now actually used */}
                    <label className="text-gray-500 text-xs mb-1 block">Max (sec)</label>
                    <input type="number" min={0} value={editingSchedule.articleDelayMax}
                      onChange={e => upd({ articleDelayMax: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                  </div>
                </div>
              </div>

              {/* Fix #6: Read time settings */}
              <div className="border-t border-gray-800 pt-4">
                <p className="text-gray-400 text-xs font-medium mb-3">Read Time per Article</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Min (sec)</label>
                    <input type="number" min={10} value={editingSchedule.readTimeMin}
                      onChange={e => upd({ readTimeMin: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Max (sec)</label>
                    <input type="number" min={10} value={editingSchedule.readTimeMax}
                      onChange={e => upd({ readTimeMax: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-gray-800 pt-4">
                {/* Fix #7: Scroll speed */}
                <div>
                  <label className="text-gray-400 text-xs mb-2 block font-medium">Scroll Speed</label>
                  <div className="flex gap-2">
                    {(['slow', 'medium', 'fast'] as const).map(sp => (
                      <button key={sp} onClick={() => upd({ scrollSpeed: sp })}
                        className={`flex-1 py-2 rounded-xl border text-xs capitalize transition-all
                          ${editingSchedule.scrollSpeed === sp
                            ? 'border-blue-500 bg-blue-900/20 text-blue-400'
                            : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'}`}>
                        {sp}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fix #9: Articles per session */}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block font-medium">Articles per Session</label>
                  <input type="number" min={1} max={50} value={editingSchedule.articlesPerSession}
                    onChange={e => upd({ articlesPerSession: Number(e.target.value) })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-green-500" />
                  <p className="text-gray-600 text-xs mt-1">Max articles per profile per run</p>
                </div>
              </div>
            </>
          )}

          {/* ── Step 4: Review ── */}
          {activeStep === 4 && (
            <>
              <h2 className="text-xl font-bold">✅ Review</h2>
              <div className="bg-gray-800 rounded-xl p-5 space-y-3">
                {[
                  ['Name',              editingSchedule.name],
                  ['Provider',         editingSchedule.provider],
                  ['Profiles',         `${editingSchedule.selectedProfiles.length} selected`],
                  ['Sites',            `${editingSchedule.selectedSites.length} selected`],
                  ['Traffic Source',   TRAFFIC_SOURCES.find(t => t.value === editingSchedule.trafficSource)?.label || editingSchedule.trafficSource],
                  ['Run Mode',         editingSchedule.runMode],
                  ['Profile Stagger',  `${editingSchedule.profileDelayMin}–${editingSchedule.profileDelayMax}s`],
                  ['Article Delay',    `${editingSchedule.articleDelayMin}–${editingSchedule.articleDelayMax}s`],
                  ['Read Time',        `${editingSchedule.readTimeMin}–${editingSchedule.readTimeMax}s`],
                  ['Scroll Speed',     editingSchedule.scrollSpeed],
                  ['Articles/Session', `${editingSchedule.articlesPerSession}`],
                  ...(editingSchedule.runMode === 'scheduled' ? [
                    ['First Run',      editingSchedule.scheduledTime ? new Date(editingSchedule.scheduledTime).toLocaleString() : '—'],
                    ['Repeat',         editingSchedule.repeatInterval],
                  ] : []),
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">{label}</span>
                    <span className="text-white text-sm font-medium">{val}</span>
                  </div>
                ))}
              </div>

              {/* Article preview */}
              {editingSchedule.selectedSites.length > 0 && (() => {
                const count = sites
                  .filter(s => editingSchedule.selectedSites.includes(s.id))
                  .reduce((n, s) => n + s.articles.filter(a => a.enabled).length, 0);
                const perRun = Math.min(count, editingSchedule.articlesPerSession);
                return (
                  <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-3 text-sm text-green-300">
                    ✅ {editingSchedule.selectedProfiles.length} profiles will each read up to{' '}
                    <strong>{perRun}</strong> of <strong>{count}</strong> articles via{' '}
                    {TRAFFIC_SOURCES.find(t => t.value === editingSchedule.trafficSource)?.label} traffic
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>

      {/* Wizard Footer */}
      <div className="px-6 py-4 border-t border-gray-800 bg-gray-950/50 flex-shrink-0 flex justify-between items-center">
        <button onClick={() => activeStep > 1 ? setActiveStep(activeStep - 1) : setView('list')}
          className="bg-gray-800 hover:bg-gray-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all">
          ← Previous
        </button>

        {/* Fix #10: Validation on each step */}
        {activeStep < STEPS.length ? (
          <button onClick={() => setActiveStep(activeStep + 1)}
            disabled={!canGoNext()}
            title={!canGoNext() ? (
              activeStep === 1 ? 'Enter a name and select at least 1 profile'
                : activeStep === 2 ? 'Select at least 1 site'
                : ''
            ) : ''}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all">
            Next Step →
          </button>
        ) : (
          <button onClick={handleSave}
            className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-900/30">
            ✓ Save Schedule
          </button>
        )}
      </div>
    </div>
  );
}
