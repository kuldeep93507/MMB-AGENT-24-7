/**
 * MMB-AGENT Backend Server
 * - Manages profile agents (one per MoreLogin profile)
 * - Connects to MoreLogin API to start/stop profiles
 * - Uses Playwright CDP for browser automation
 * - Human-like behavior for YouTube watching
 */

// Load .env first (lightweight loader, no dotenv dependency)
require('./providers/loadEnv.cjs')();

const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ProfileAgent } = require('./agent.cjs');
const { Orchestrator } = require('./orchestrator.cjs');
const { profileRouter } = require('./providers/profileRouter.cjs');
const { providerFactory } = require('./providers/ProviderFactory.cjs');
const { MultiloginCookiesService } = require('./services/MultiloginCookiesService.cjs');

const cookiesService = new MultiloginCookiesService();
const activityLog = require('./activityLog.cjs');

const app = express();
app.use(cors({
  origin(origin, cb) {
    if (!origin || origin === 'null') return cb(null, true);
    if (origin === 'app://.') return cb(null, true);
    try {
      const h = new URL(origin).hostname;
      if (h === 'localhost' || h === '127.0.0.1') return cb(null, true);
    } catch (_) { /* ignore */ }
    return cb(null, false);
  },
}));
app.use(express.json());

const PORT = 3100;
const MORELOGIN_BASE = 'http://127.0.0.1:40000';
const MORELOGIN_API_KEY = 'dbc21d41137f29238f4679e71b7986decb0581115e34a84e';

const activeAgents = new Map();

// Orchestrator (for scheduled/shuffle runs — worker threads)
const orchestrator = new Orchestrator();

// Clean up completed schedules from runningSchedules to prevent memory leak.
// Fires when a worker reports 'done'. If all workers in a schedule are done,
// remove the schedule entry from the map.
const BACKLINKS_FILE = path.resolve(__dirname, '..', 'backlinks_data.json');

function loadBacklinksFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(BACKLINKS_FILE, 'utf8'));
    return {
      links: Array.isArray(raw.links) ? raw.links : [],
      manualAssign: raw.manualAssign && typeof raw.manualAssign === 'object' ? raw.manualAssign : {},
    };
  } catch {
    return { links: [], manualAssign: {} };
  }
}

function saveBacklinksFile(data) {
  try {
    fs.writeFileSync(BACKLINKS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[Backlinks] Failed to save:', err.message);
  }
}

function markBacklinksUsed(ids) {
  if (!ids?.length) return;
  const data = loadBacklinksFile();
  const set = new Set(ids);
  const now = Date.now();
  data.links = data.links.map((b) =>
    set.has(b.id) ? { ...b, usedCount: (b.usedCount || 0) + 1, lastUsed: now } : b,
  );
  saveBacklinksFile(data);
}

orchestrator.onBacklinkUsed = (ids) => markBacklinksUsed(ids);

orchestrator.onActivityLog = (entry) => activityLog.append(entry);

orchestrator.onWorkerDone = (profileId) => {
  for (const [scheduleId, entry] of runningSchedules) {
    const profiles = entry.schedule?.selectedProfiles || [];
    if (!profiles.includes(profileId)) continue;
    // Check if all workers in this schedule are done/stopped
    const allDone = profiles.every(pid => {
      const ws = orchestrator.workers.get(pid);
      return !ws || ws.status === 'done' || ws.status === 'stopped' || ws.status === 'crashed';
    });
    if (allDone) {
      console.log(`[Orchestrator] Schedule "${entry.schedule?.name}" complete — removing from runningSchedules`);
      runningSchedules.delete(scheduleId);
    }
  }
};

// Watch History — persisted to file
const HISTORY_FILE = path.resolve(__dirname, '..', 'watch_history.json');

function loadWatchHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}
function saveWatchHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    // Log the error so disk-full / permission issues are visible
    console.error('[WatchHistory] Failed to save watch_history.json:', err.message);
  }
}
// profileId → [{ videoTitle, watchedAt, watchPercent }]
const watchHistory = loadWatchHistory();

// Running schedules
const runningSchedules = new Map();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS — UI-configurable, no .env needed
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SETTINGS_FILE = path.resolve(__dirname, '..', 'user-settings.json');

const DEFAULT_SETTINGS = {
  moreloginBaseUrl: 'http://127.0.0.1:40000',
  moreloginApiKey: '',
  moreloginSecurityEnabled: true,
  moreloginPort: '40000',
  multiloginEmail: '',
  multiloginPassword: '',
  multiloginToken: '',
  multiloginFolderId: '',
  proxyServer: 'us.smartproxy.net',
  proxyPort: '3120',
  proxyPassword: '',
  proxyPrefix: '',
  defaultProxyLife: '4hr',
  maxConcurrent: '5',
  multiloginMaxConcurrent: '3',
  multiloginBatchGapMs: '45000',
  browserProvider: 'multilogin',
};

function getMaxConcurrent() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const n = parseInt(s.maxConcurrent, 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* use default */ }
  const envN = parseInt(process.env.MAX_CONCURRENT || '9999', 10);
  return Number.isFinite(envN) && envN > 0 ? envN : 9999;
}

function loadAppSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function parseMoreloginPort(s) {
  if (s.moreloginPort) return String(s.moreloginPort);
  if (s.moreloginBaseUrl) {
    try {
      const u = new URL(s.moreloginBaseUrl);
      if (u.port) return u.port;
    } catch { /* ignore */ }
  }
  return '40000';
}

function applySettingsToEnv(s) {
  const setIfNonEmpty = (envKey, val) => {
    if (val != null && String(val).trim() !== '') process.env[envKey] = String(val).trim();
  };
  setIfNonEmpty('MORELOGIN_API_KEY', s.moreloginApiKey);
  process.env.MORELOGIN_PORT = parseMoreloginPort(s);
  setIfNonEmpty('MULTILOGIN_EMAIL', s.multiloginEmail);
  setIfNonEmpty('MULTILOGIN_PASSWORD', s.multiloginPassword);
  setIfNonEmpty('MULTILOGIN_TOKEN', s.multiloginToken);
  setIfNonEmpty('MULTILOGIN_FOLDER_ID', s.multiloginFolderId);
  if (s.proxyServer) process.env.PROXY_SERVER = String(s.proxyServer);
  if (s.proxyPort) process.env.PROXY_PORT = String(s.proxyPort);
  if (s.proxyPassword != null) process.env.PROXY_PASSWORD = String(s.proxyPassword);
  if (s.proxyPrefix != null) process.env.PROXY_PREFIX = String(s.proxyPrefix);
  if (s.defaultProxyLife) process.env.DEFAULT_PROXY_LIFE = String(s.defaultProxyLife);
  if (s.multiloginMaxConcurrent) process.env.MULTILOGIN_MAX_CONCURRENT = String(s.multiloginMaxConcurrent);
  if (s.multiloginBatchGapMs) process.env.MULTILOGIN_BATCH_GAP_MS = String(s.multiloginBatchGapMs);
}

let appSettings = loadAppSettings();
applySettingsToEnv(appSettings);   // Apply on startup — overrides .env if user-settings.json exists

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MORELOGIN API HELPER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function moreloginRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port: 40000,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MORELOGIN_API_KEY,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ code: -1, msg: 'Invalid JSON response' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', agents: activeAgents.size, schedules: runningSchedules.size, workers: orchestrator.getStats() });
});

// Get all agent statuses (includes worker statuses)
app.get('/api/agents', (req, res) => {
  const manualAgents = [];
  for (const [id, agent] of activeAgents) {
    manualAgents.push(agent.getStatus());
  }
  const workerStatuses = orchestrator.getAllStatuses();
  res.json({ agents: manualAgents, workers: workerStatuses });
});

// Get specific agent status
app.get('/api/agents/:profileId', (req, res) => {
  const agent = activeAgents.get(req.params.profileId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent.getStatus());
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RUN SCHEDULE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/schedule/run', async (req, res) => {
  const { schedule } = req.body;
  if (!schedule) return res.status(400).json({ error: 'Schedule required' });

  const maxConcurrent = getMaxConcurrent();
  const currentRunning = orchestrator.getStats().running + activeAgents.size;
  const requestedProfiles = schedule.selectedProfiles.length;
  const availableSlots = Math.max(0, maxConcurrent - currentRunning);

  if (availableSlots === 0) {
    activityLog.append({
      level: 'warn',
      source: activityLog.inferScheduleSource(schedule),
      message: `Schedule "${schedule.name}" blocked — max concurrent (${maxConcurrent}) reached`,
    });
    return res.status(429).json({ 
      error: `Max concurrent limit reached (${maxConcurrent}). Currently ${currentRunning} running. Stop some first.`,
      running: currentRunning,
      limit: maxConcurrent
    });
  }

  let trimmed = false;
  if (requestedProfiles > availableSlots) {
    schedule.selectedProfiles = schedule.selectedProfiles.slice(0, availableSlots);
    trimmed = true;
    console.log(`[Orchestrator] Trimmed to ${availableSlots} profiles (limit: ${maxConcurrent}, running: ${currentRunning})`);
  }

  const scheduleId = schedule.id || Date.now().toString();
  console.log(`\n━━━ Starting Schedule: ${schedule.name} ━━━`);
  console.log(`Profiles: ${schedule.selectedProfiles.length} | Using Worker Threads`);

  // Store running schedule
  runningSchedules.set(scheduleId, { schedule, status: 'running', startedAt: Date.now() });

  // Use Orchestrator with Worker Threads
  const result = orchestrator.runSchedule(schedule);
  const logSource = activityLog.inferScheduleSource(schedule);
  activityLog.append({
    level: 'success',
    source: logSource,
    message: `Started "${schedule.name}" — ${result.workersSpawned} worker(s)${trimmed ? ` (trimmed from ${requestedProfiles})` : ''}${result.skippedNoVideos ? `, ${result.skippedNoVideos} skipped (no videos)` : ''}`,
  });

  const mlxHint = (schedule.selectedProfiles?.length || 0) > 3
    ? ' Multilogin: profiles start in batches of 3 (plan limit) — check Logs / Workers for CDP errors.'
    : '';

  res.json({
    success: true,
    scheduleId,
    message: `Schedule "${schedule.name}" started with ${result.workersSpawned} worker(s).${mlxHint}`,
    workersSpawned: result.workersSpawned,
    skippedNoVideos: result.skippedNoVideos || 0,
    multiloginBatchSize: result.multiloginBatchSize || null,
    trimmed,
    limit: maxConcurrent,
    running: currentRunning,
  });
});

// Schedule list persistence (server-side backup; UI also syncs on save)
const SCHEDULES_FILE = path.resolve(__dirname, '..', 'schedules_data.json');

function loadSchedulesFile() {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')); } catch { return []; }
}
function saveSchedulesFile(list) {
  try { fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(list, null, 2)); } catch (err) {
    console.error('[Schedules] Failed to save:', err.message);
  }
}

app.get('/api/schedules', (req, res) => {
  res.json({ schedules: loadSchedulesFile() });
});

app.put('/api/schedules', (req, res) => {
  const { schedules } = req.body;
  if (!Array.isArray(schedules)) return res.status(400).json({ error: 'schedules array required' });
  saveSchedulesFile(schedules);
  res.json({ success: true, count: schedules.length });
});

app.get('/api/schedule/progress', (req, res) => {
  const raw = req.query.profileIds;
  const profileIds = typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (!profileIds.length) return res.status(400).json({ error: 'profileIds query required' });
  res.json({ stats: orchestrator.getStatsForProfiles(profileIds) });
});

app.get('/api/concurrency', (req, res) => {
  const limit = getMaxConcurrent();
  const workerStats = orchestrator.getStats();
  const running = workerStats.running + activeAgents.size;
  res.json({ limit, running, available: Math.max(0, limit - running), workers: workerStats });
});

// Stop a running schedule
app.post('/api/schedule/stop', async (req, res) => {
  const { scheduleId } = req.body;

  if (scheduleId) {
    // Stop only the specific schedule's workers
    const schedule = runningSchedules.get(scheduleId);
    if (schedule) {
      const profileIds = schedule.schedule?.selectedProfiles || [];
      for (const profileId of profileIds) {
        orchestrator.stopWorker(profileId);
      }
      runningSchedules.delete(scheduleId);
      const src = activityLog.inferScheduleSource(schedule.schedule);
      activityLog.append({
        level: 'warn',
        source: src,
        message: `Stopped schedule "${schedule.schedule?.name || scheduleId}" (${profileIds.length} workers)`,
      });
      res.json({ success: true, message: `Schedule ${scheduleId} stopped (${profileIds.length} workers)` });
    } else {
      res.json({ success: false, message: 'Schedule not found' });
    }
  } else {
    // No scheduleId — stop everything
    orchestrator.stopAll();
    for (const [profileId, agent] of activeAgents) {
      await agent.disconnect();
      activeAgents.delete(profileId);
    }
    runningSchedules.clear();
    activityLog.append({ level: 'warn', source: 'system', message: 'Stop all — all workers and manual agents stopped' });
    res.json({ success: true, message: 'All workers and agents stopped' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ACTIVITY LOGS — unified server-backed timeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/logs', (req, res) => {
  const result = activityLog.getLogs({
    limit: req.query.limit,
    since: req.query.since,
    level: req.query.level,
    source: req.query.source,
    profileId: req.query.profileId,
    search: req.query.search,
  });
  res.json(result);
});

app.post('/api/logs', (req, res) => {
  const { level, message, profileId, profileName, source, id, timestamp } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  const entry = activityLog.append({ level, message, profileId, profileName, source, id, timestamp });
  res.json({ success: true, entry });
});

app.delete('/api/logs', (req, res) => {
  activityLog.clear();
  res.json({ success: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REAL-TIME ANALYTICS TRACKING — Persisted to file
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ANALYTICS_FILE = path.resolve(__dirname, '..', 'analytics_data.json');

function loadAnalytics() {
  try { return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8')); } catch {}
  return { totalViews: 0, totalWatchTime: 0, totalSessions: 0, totalLikes: 0, totalSubscribes: 0, totalComments: 0, perProfile: {}, recentActivity: [] };
}

// Debounced save — batch writes every 5 seconds instead of every single request
let _analyticsSaveTimer = null;
function saveAnalytics(data) {
  if (_analyticsSaveTimer) return; // Already scheduled
  _analyticsSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2)); } catch {}
    _analyticsSaveTimer = null;
  }, 5000);
}

const analyticsData = loadAnalytics();

// Track an action
app.post('/api/analytics/track', (req, res) => {
  const { profileId, action, value } = req.body;
  if (!profileId || !action) return res.status(400).json({ error: 'profileId and action required' });

  // Initialize profile if needed
  if (!analyticsData.perProfile[profileId]) {
    analyticsData.perProfile[profileId] = { views: 0, watchTime: 0, likes: 0, subscribes: 0, comments: 0 };
  }
  const p = analyticsData.perProfile[profileId];

  switch (action) {
    case 'view': analyticsData.totalViews++; p.views++; break;
    case 'watchTime': analyticsData.totalWatchTime += (value || 0); p.watchTime += (value || 0); break;
    case 'like': analyticsData.totalLikes++; p.likes++; break;
    case 'subscribe': analyticsData.totalSubscribes++; p.subscribes++; break;
    case 'comment': analyticsData.totalComments++; p.comments++; break;
    case 'session': analyticsData.totalSessions++; break;
    case 'ads_total': analyticsData.totalAds = (analyticsData.totalAds || 0) + (value || 1); break;
    case 'ads_skipped': analyticsData.adsSkipped = (analyticsData.adsSkipped || 0) + (value || 1); break;
    case 'ads_watched_full': analyticsData.adsWatchedFull = (analyticsData.adsWatchedFull || 0) + (value || 1); break;
    case 'ad_watch_time': analyticsData.adWatchTime = (analyticsData.adWatchTime || 0) + (value || 0); break;
    case 'traffic_youtube-search': analyticsData.trafficYouTube = (analyticsData.trafficYouTube || 0) + 1; break;
    case 'traffic_google': analyticsData.trafficGoogle = (analyticsData.trafficGoogle || 0) + 1; break;
    case 'traffic_bing': analyticsData.trafficBing = (analyticsData.trafficBing || 0) + 1; break;
    case 'traffic_direct': analyticsData.trafficDirect = (analyticsData.trafficDirect || 0) + 1; break;
    case 'traffic_direct-fallback': analyticsData.trafficDirect = (analyticsData.trafficDirect || 0) + 1; break;
    case 'traffic_channel-page': analyticsData.trafficChannel = (analyticsData.trafficChannel || 0) + 1; break;
    case 'traffic_backlink':
    case 'traffic_backlink-direct-fallback':
      analyticsData.trafficBacklink = (analyticsData.trafficBacklink || 0) + 1;
      break;
  }

  analyticsData.recentActivity.push({ profileId, action, value, time: Date.now() });
  if (analyticsData.recentActivity.length > 500) analyticsData.recentActivity = analyticsData.recentActivity.slice(-500);

  // Daily log — store per-day data for date filtering
  if (!analyticsData.dailyLog) analyticsData.dailyLog = [];
  analyticsData.dailyLog.push({ profileId, action, value: value || 1, time: Date.now() });
  // Keep last 30 days of daily log (max ~50k entries)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (analyticsData.dailyLog.length > 50000) {
    analyticsData.dailyLog = analyticsData.dailyLog.filter(e => e.time > thirtyDaysAgo);
  }

  // Persist to file
  saveAnalytics(analyticsData);
  res.json({ success: true });
});

function buildDailyTrendFromLogs(logs) {
  const buckets = {};
  for (const entry of logs) {
    if (!entry || !entry.time) continue;
    const dayKey = new Date(entry.time).toISOString().slice(0, 10);
    if (!buckets[dayKey]) buckets[dayKey] = { date: dayKey, views: 0, watchTime: 0 };
    if (entry.action === 'view') buckets[dayKey].views++;
    if (entry.action === 'watchTime') buckets[dayKey].watchTime += entry.value || 0;
  }
  return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateAnalyticsFromLogs(logs, recentActivity, filterMeta) {
  const filtered = {
    totalViews: 0, totalWatchTime: 0, totalSessions: 0,
    totalLikes: 0, totalSubscribes: 0, totalComments: 0,
    totalAds: 0, adsSkipped: 0, adsWatchedFull: 0, adWatchTime: 0,
    trafficYouTube: 0, trafficGoogle: 0, trafficBing: 0, trafficDirect: 0, trafficChannel: 0,
    trafficBacklink: 0,
    perProfile: {},
    recentActivity: recentActivity || [],
    dailyTrend: buildDailyTrendFromLogs(logs),
    ...filterMeta,
  };

  for (const entry of logs) {
    const { profileId, action, value } = entry;
    if (!filtered.perProfile[profileId]) {
      filtered.perProfile[profileId] = { views: 0, watchTime: 0, likes: 0, subscribes: 0, comments: 0 };
    }
    const p = filtered.perProfile[profileId];

    switch (action) {
      case 'view': filtered.totalViews++; p.views++; break;
      case 'watchTime': filtered.totalWatchTime += (value || 0); p.watchTime += (value || 0); break;
      case 'like': filtered.totalLikes++; p.likes++; break;
      case 'subscribe': filtered.totalSubscribes++; p.subscribes++; break;
      case 'comment': filtered.totalComments++; p.comments++; break;
      case 'session': filtered.totalSessions++; break;
      case 'ads_total': filtered.totalAds += (value || 1); break;
      case 'ads_skipped': filtered.adsSkipped += (value || 1); break;
      case 'ads_watched_full': filtered.adsWatchedFull += (value || 1); break;
      case 'ad_watch_time': filtered.adWatchTime += (value || 0); break;
      case 'traffic_youtube-search': filtered.trafficYouTube++; break;
      case 'traffic_google': filtered.trafficGoogle++; break;
      case 'traffic_bing': filtered.trafficBing++; break;
      case 'traffic_direct': case 'traffic_direct-fallback': filtered.trafficDirect++; break;
      case 'traffic_channel-page': filtered.trafficChannel++; break;
      case 'traffic_backlink':
      case 'traffic_backlink-direct-fallback':
        filtered.trafficBacklink++;
        break;
      default: break;
    }
  }
  return filtered;
}

app.post('/api/analytics/reset-today-engagement', (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const t0 = todayStart.getTime();
    const engagement = new Set(['like', 'subscribe', 'comment']);
    analyticsData.dailyLog = (analyticsData.dailyLog || []).filter(
      (e) => !(e.time >= t0 && engagement.has(e.action)),
    );
    saveAnalytics(analyticsData);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get analytics (with optional date filter)
app.get('/api/analytics', (req, res) => {
  const { filter } = req.query; // 'today', 'yesterday', '7d', '30d', 'all'
  
  if (!filter || filter === 'all') {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const logs = (analyticsData.dailyLog || []).filter((e) => e.time >= thirtyDaysAgo);
    const recent = (analyticsData.recentActivity || []).filter((e) => e.time >= thirtyDaysAgo);
    return res.json({
      ...analyticsData,
      dailyTrend: buildDailyTrendFromLogs(logs),
      recentActivity: recent.slice(-100),
      filter: 'all',
    });
  }
  
  // Calculate time range
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  let fromTime = 0;
  let toTime = now;
  
  switch (filter) {
    case 'today':
      fromTime = todayStart.getTime();
      break;
    case 'yesterday':
      fromTime = todayStart.getTime() - 24 * 60 * 60 * 1000;
      toTime = todayStart.getTime();
      break;
    case '7d':
      fromTime = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      fromTime = now - 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      return res.json(analyticsData);
  }
  
  const logs = (analyticsData.dailyLog || []).filter(e => e.time >= fromTime && e.time <= toTime);
  const recent = (analyticsData.recentActivity || []).filter(e => e.time >= fromTime && e.time <= toTime);
  res.json(aggregateAnalyticsFromLogs(logs, recent.slice(-100), { filter, fromTime, toTime }));
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WATCH HISTORY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/history', (req, res) => {
  res.json(watchHistory);
});

app.get('/api/history/:profileId', (req, res) => {
  res.json(watchHistory[req.params.profileId] || []);
});

app.post('/api/history/add', (req, res) => {
  const { profileId, videoTitle, watchPercent, videoId } = req.body;
  if (!profileId || !videoTitle) return res.status(400).json({ error: 'profileId and videoTitle required' });
  if (!watchHistory[profileId]) watchHistory[profileId] = [];
  const vid = videoId ? String(videoId).trim() : '';
  if (vid && watchHistory[profileId].some((h) => h.videoId === vid)) {
    return res.json({ success: true, duplicate: true });
  }
  watchHistory[profileId].push({
    videoTitle,
    videoId: vid || undefined,
    watchedAt: Date.now(),
    watchPercent: watchPercent || 100,
  });
  if (watchHistory[profileId].length > 200) watchHistory[profileId] = watchHistory[profileId].slice(-200);
  saveWatchHistory(watchHistory);
  res.json({ success: true });
});

// Check if video already watched by profile (24h window)
app.post('/api/history/check', (req, res) => {
  const { profileId, videoTitle } = req.body;
  const history = watchHistory[profileId] || [];
  const cutoff = Date.now() - 86400000; // 24 hours
  const alreadyWatched = history.some(h => h.videoTitle === videoTitle && h.watchedAt > cutoff);
  res.json({ alreadyWatched });
});

/** Normalized shuffle/automation sync — reads same store as /api/history (last 14 days). */
app.get('/api/watch-history/:profileId', (req, res) => {
  const { profileId } = req.params;
  try {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const list = watchHistory[profileId] || [];
    const filtered = list.filter((h) => (h.watchedAt || 0) > cutoff);
    res.json({ code: 0, data: filtered });
  } catch {
    res.json({ code: 0, data: [] });
  }
});

/** Push video-id row used by Video Shuffle — merges with orchestrator rows in watch_history.json */
app.post('/api/watch-history/add', (req, res) => {
  const { profileId, videoId, videoTitle } = req.body || {};
  if (!profileId || !videoId) {
    return res.status(400).json({ code: -1, message: 'Missing profileId or videoId' });
  }
  try {
    if (!watchHistory[profileId]) watchHistory[profileId] = [];
    const exists = watchHistory[profileId].some((h) => h.videoId === videoId);
    if (!exists) {
      watchHistory[profileId].push({
        videoId,
        videoTitle: videoTitle || '',
        watchedAt: Date.now(),
      });
      if (watchHistory[profileId].length > 200) {
        watchHistory[profileId] = watchHistory[profileId].slice(-200);
      }
      saveWatchHistory(watchHistory);
    }
    return res.json({ code: 0, message: 'History saved' });
  } catch (err) {
    return res.status(500).json({ code: -1, message: err.message || String(err) });
  }
});

app.delete('/api/watch-history/:profileId', (req, res) => {
  const { profileId } = req.params;
  try {
    delete watchHistory[profileId];
    saveWatchHistory(watchHistory);
    res.json({ code: 0, message: 'History cleared' });
  } catch (err) {
    res.status(500).json({ code: -1, message: err.message || String(err) });
  }
});

// Video Shuffle state (assignments + channel min/max + enabled channels)
const SHUFFLE_FILE = path.resolve(__dirname, '..', 'shuffle_data.json');

function loadShuffleFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(SHUFFLE_FILE, 'utf8'));
    return {
      assignments: Array.isArray(raw.assignments) ? raw.assignments : [],
      channelConfigs: Array.isArray(raw.channelConfigs) ? raw.channelConfigs : [],
      enabledChannelIds: Array.isArray(raw.enabledChannelIds) ? raw.enabledChannelIds : [],
    };
  } catch {
    return { assignments: [], channelConfigs: [], enabledChannelIds: [] };
  }
}

function saveShuffleFile(data) {
  try {
    fs.writeFileSync(SHUFFLE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[Shuffle] Failed to save:', err.message);
  }
}

app.get('/api/shuffle/state', (req, res) => {
  res.json(loadShuffleFile());
});

app.get('/api/backlinks', (req, res) => {
  res.json(loadBacklinksFile());
});

app.put('/api/backlinks', (req, res) => {
  const { links, manualAssign } = req.body || {};
  const prev = loadBacklinksFile();
  const next = {
    links: Array.isArray(links) ? links : prev.links,
    manualAssign: manualAssign && typeof manualAssign === 'object' ? manualAssign : prev.manualAssign,
  };
  saveBacklinksFile(next);
  res.json({ success: true, ...next });
});

app.post('/api/backlinks/mark-used', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  markBacklinksUsed(ids);
  res.json({ success: true, count: ids.length });
});

app.put('/api/shuffle/state', (req, res) => {
  const { assignments, channelConfigs, enabledChannelIds } = req.body || {};
  const prev = loadShuffleFile();
  const next = {
    assignments: Array.isArray(assignments) ? assignments : prev.assignments,
    channelConfigs: Array.isArray(channelConfigs) ? channelConfigs : prev.channelConfigs,
    enabledChannelIds: Array.isArray(enabledChannelIds) ? enabledChannelIds : prev.enabledChannelIds,
  };
  saveShuffleFile(next);
  res.json({ success: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROXY ROTATION — Real server-side session rotate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** POST /api/proxy/rotate
 *  Generates a fresh SmartProxy session (new session ID, same state/city/life).
 *  Returns the new proxy config so the frontend can update its state.
 *  Does NOT update the Multilogin profile — that requires a profile recreate.
 */
const proxyRotator = require('./services/ProxyRotator.cjs');

const { updateProviderProxy } = require('./services/ProxyProfileUpdater.cjs');

app.post('/api/proxy/rotate', async (req, res) => {
  const { profileId, currentProxy, browserType } = req.body || {};
  if (!profileId) return res.status(400).json({ success: false, error: 'profileId required' });

  try {
    // Generate a fresh proxy keeping same geo (state/city) but new session ID
    const { server, port, password, prefix } = proxyRotator._getProxyEnv();

    if (!password || !prefix) {
      return res.status(500).json({ success: false, error: 'Proxy credentials not configured in .env' });
    }

    // Use state/city from current proxy if available, else pick random
    const state = currentProxy?.state || null;
    const city = currentProxy?.city || null;
    const life = currentProxy?.life || '120';

    // Generate a new session ID that's not in the current assignments
    const sessionId = proxyRotator._generateUniqueSessionId();

    const username = state && city
      ? `${prefix}_area-US_state-${state}_city-${city}_life-${life}_session-${sessionId}`
      : `${prefix}_area-US_session-${sessionId}_life-${life}`;

    const now = Date.now();
    const LIFE_MS_MAP = { '60': 3600000, '120': 7200000, '240': 14400000, '480': 28800000, '1440': 86400000 };

    const newProxy = {
      server,
      port,
      username,
      password,
      state: state || 'NEWYORK',
      city: city || 'NEWYORK',
      life,
      sessionId,
      assignedAt: now,
      expiresAt: now + (LIFE_MS_MAP[life] || 7200000),
    };

    // Update the registration
    proxyRotator.registerAssignment(profileId, newProxy);

    let providerUpdated = false;
    let providerMessage = '';
    const bt = (browserType || '').toLowerCase();
    if (bt === 'morelogin' || bt === 'multilogin') {
      const push = await updateProviderProxy(profileId, bt, newProxy);
      providerUpdated = push.success;
      providerMessage = push.success ? push.message : (push.error || 'Provider update failed');
      if (!push.success) {
        console.warn(`[ProxyRotate] Provider push failed for ${profileId}: ${providerMessage}`);
      }
    }

    console.log(`[ProxyRotate] Profile ${profileId.slice(-4)} → new session ${sessionId} (provider: ${providerUpdated})`);
    res.json({
      success: true,
      proxy: newProxy,
      providerUpdated,
      providerMessage: providerMessage || undefined,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCHEDULED TIMER — Check every minute for due schedules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const scheduledJobs = new Map(); // scheduleId → { schedule, nextRun }

app.post('/api/schedule/timer/set', (req, res) => {
  const { schedule } = req.body;
  if (!schedule || !schedule.scheduledTime) return res.status(400).json({ error: 'schedule with scheduledTime required' });
  
  const scheduleId = schedule.id || Date.now().toString();
  scheduledJobs.set(scheduleId, {
    schedule,
    nextRun: new Date(schedule.scheduledTime).getTime(),
    repeat: schedule.repeatEnabled ? schedule.repeatInterval : null,
  });
  console.log(`[Timer] Schedule "${schedule.name}" set for ${schedule.scheduledTime} (repeat: ${schedule.repeatInterval || 'none'})`);
  res.json({ success: true, scheduleId });
});

app.get('/api/schedule/timer/list', (req, res) => {
  const list = [];
  for (const [id, job] of scheduledJobs) {
    list.push({ id, name: job.schedule.name, nextRun: job.nextRun, repeat: job.repeat });
  }
  res.json(list);
});

app.post('/api/schedule/timer/cancel', (req, res) => {
  const { scheduleId } = req.body;
  scheduledJobs.delete(scheduleId);
  res.json({ success: true });
});

// Check every 60 seconds for due schedules
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of scheduledJobs) {
    if (job.nextRun && now >= job.nextRun) {
      console.log(`[Timer] ⏰ Schedule "${job.schedule.name}" is DUE — running now!`);
      // Run the schedule
      orchestrator.runSchedule(job.schedule);
      
      // Calculate next run if repeat enabled
      const scheduleId = job.schedule?.id || id;
      runningSchedules.set(scheduleId, { schedule: job.schedule, status: 'running', startedAt: Date.now() });

      if (job.repeat) {
        const intervals = { '1hr': 3600000, '3hr': 10800000, '6hr': 21600000, '12hr': 43200000, '24hr': 86400000, 'daily': 86400000 };
        job.nextRun = now + (intervals[job.repeat] || 21600000);
        console.log(`[Timer] Next run: ${new Date(job.nextRun).toLocaleString()}`);
      } else {
        scheduledJobs.delete(id);
      }
    }
  }
}, 60000); // Check every minute

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WORKER THREAD STATUS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/workers', (req, res) => {
  res.json({ workers: orchestrator.getAllStatuses(), stats: orchestrator.getStats() });
});

app.get('/api/workers/:profileId', (req, res) => {
  const status = orchestrator.getWorkerStatus(req.params.profileId);
  if (!status) return res.status(404).json({ error: 'Worker not found' });
  res.json(status);
});

app.post('/api/workers/stop/:profileId', (req, res) => {
  orchestrator.stopWorker(req.params.profileId);
  res.json({ success: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROVIDER PING — Sidebar connection status
// Checks LOCAL app port only — no cloud auth needed
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/providers/ping', (req, res) => {
  const https = require('https');
  const http = require('http');
  const provider = (req.query.provider || process.env.BROWSER_PROVIDER || 'morelogin').toLowerCase();

  if (provider === 'multilogin') {
    // Ping LOCAL Multilogin launcher (port 45001) — any HTTP response = app is running
    const options = { hostname: 'launcher.mlx.yt', port: 45001, path: '/api/v1/profile/active', method: 'GET', timeout: 5000, rejectUnauthorized: false };
    let sent = false;
    const reply = (data) => { if (!sent) { sent = true; res.json(data); } };
    const r = https.request(options, () => reply({ code: 0, message: 'Multilogin launcher running' }));
    r.on('error', () => reply({ code: -1, message: 'Multilogin app not running — please open it' }));
    r.on('timeout', () => { r.destroy(); reply({ code: -1, message: 'Multilogin launcher timeout' }); });
    r.end();
  } else {
    // Ping MoreLogin local API (port 40000)
    const mlPort = parseInt(process.env.MORELOGIN_PORT || '40000', 10);
    let sent = false;
    const reply = (data) => { if (!sent) { sent = true; res.json(data); } };
    const r = http.request({ hostname: '127.0.0.1', port: mlPort, path: '/', method: 'GET', timeout: 3000 }, () => reply({ code: 0, message: 'MoreLogin running' }));
    r.on('error', () => reply({ code: -1, message: 'MoreLogin app not running — please open it' }));
    r.on('timeout', () => { r.destroy(); reply({ code: 0, message: 'MoreLogin running' }); });
    r.end();
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MANUAL CONTROL — Batch commands for selected profiles
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Start profiles for manual control (connect CDP but don't automate)
app.post('/api/manual/start', async (req, res) => {
  const { profileIds } = req.body;
  if (!profileIds || !Array.isArray(profileIds)) return res.status(400).json({ error: 'profileIds required' });

  const results = [];
  for (const profileId of profileIds) {
    try {
      // Start profile via provider (MultiLogin/MoreLogin)
      let debugPort = null;
      const provider = providerFactory.getProvider();
      const startRes = await provider.startProfile(profileId);
      if (startRes.code === 0 && startRes.data?.cdpPort) {
        debugPort = startRes.data.cdpPort;
      } else {
        // Start may take time — wait and retry once
        await sleep(8000);
        const retry = await provider.startProfile(profileId);
        if (retry.code === 0 && retry.data?.cdpPort) debugPort = retry.data.cdpPort;
      }

      if (debugPort) {
        // Connect agent
        const agent = new ProfileAgent(profileId, `Manual-${profileId.slice(-4)}`, debugPort);
        await agent.connect();
        activeAgents.set(profileId, agent);

        // Ensure at least one page exists (open YouTube if no tabs)
        try {
          const pages = agent.context.pages();
          if (pages.length === 0) {
            const newPage = await agent.context.newPage();
            await newPage.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          }
        } catch {}

        // Auto-cleanup after 30 minutes of inactivity
        agent._cleanupTimer = setTimeout(async () => {
          if (activeAgents.has(profileId)) {
            console.log(`[Manual] Auto-cleanup: agent ${profileId.slice(-4)} idle 30min`);
            await agent.disconnect().catch(() => {});
            activeAgents.delete(profileId);
          }
        }, 30 * 60 * 1000);

        results.push({ profileId, status: 'connected', debugPort });
      } else {
        results.push({ profileId, status: 'failed', error: 'No debug port' });
      }
    } catch (err) {
      results.push({ profileId, status: 'failed', error: err.message });
    }
  }
  // Return real success/failure based on actual connection results
  const connectedCount = results.filter(r => r.status === 'connected').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  const allFailed = connectedCount === 0;

  activityLog.append({
    level: allFailed ? 'error' : connectedCount > 0 ? 'success' : 'warn',
    source: 'manual',
    message: allFailed
      ? `Manual start failed for ${failedCount} profile(s)`
      : `Manual CDP: ${connectedCount} connected, ${failedCount} failed`,
  });

  res.status(allFailed ? 500 : 200).json({
    success: !allFailed,
    connected: connectedCount,
    failed: failedCount,
    results,
    message: allFailed
      ? `All ${failedCount} profiles failed to connect`
      : `${connectedCount} connected, ${failedCount} failed`,
  });
});

// Batch command for manual control — PARALLEL execution with unique behavior per profile
app.post('/api/manual/batch', async (req, res) => {
  const { profileIds, command, params } = req.body;
  if (!profileIds || !command) return res.status(400).json({ error: 'profileIds and command required' });

  // Reset cleanup timer for all active profiles (user is actively using them)
  for (const profileId of profileIds) {
    const agent = activeAgents.get(profileId);
    if (agent && agent._cleanupTimer) {
      clearTimeout(agent._cleanupTimer);
      agent._cleanupTimer = setTimeout(async () => {
        if (activeAgents.has(profileId)) {
          console.log(`[Manual] Auto-cleanup: agent ${profileId.slice(-4)} idle 30min`);
          await agent.disconnect().catch(() => {});
          activeAgents.delete(profileId);
        }
      }, 30 * 60 * 1000);
    }
  }

  // Run ALL profiles in PARALLEL (not sequential)
  const promises = profileIds.map(async (profileId, index) => {
    const agent = activeAgents.get(profileId);
    if (!agent || !agent.context) {
      return { profileId, status: 'not_connected' };
    }

    try {
      let pages = agent.context.pages();
      let page = pages[pages.length - 1];
      if (!page) {
        page = await agent.context.newPage();
        await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }

      // Tiny stagger (20-100ms) — just enough to not be identical timestamps
      await sleep(Math.floor(Math.random() * 80) + 20);

      switch (command) {
        case 'scrollDown': {
          // UNIQUE curve per profile — different amount, speed, pattern
          const totalAmount = randomDelay(150, 600); // Wide range = unique per profile
          const steps = randomDelay(3, 8);
          const acceleration = 0.5 + Math.random() * 1.5; // Some fast start, some slow start
          for (let s = 0; s < steps; s++) {
            // Curve: accelerate then decelerate (not straight line)
            const progress = s / steps;
            const curveMultiplier = Math.sin(progress * Math.PI * acceleration); // Sine curve
            const stepAmount = (totalAmount / steps) * (0.5 + curveMultiplier);
            const jitter = stepAmount + (Math.random() * 20 - 10);
            await page.mouse.wheel(0, jitter);
            await sleep(randomDelay(15, 40));
          }
          return { profileId, status: 'ok', action: `scrolled down ${totalAmount}px (curve)` };
        }
        case 'scrollUp': {
          const totalAmount = randomDelay(150, 600);
          const steps = randomDelay(3, 8);
          const acceleration = 0.5 + Math.random() * 1.5;
          for (let s = 0; s < steps; s++) {
            const progress = s / steps;
            const curveMultiplier = Math.sin(progress * Math.PI * acceleration);
            const stepAmount = (totalAmount / steps) * (0.5 + curveMultiplier);
            await page.mouse.wheel(0, -(stepAmount + (Math.random() * 20 - 10)));
            await sleep(randomDelay(15, 40));
          }
          return { profileId, status: 'ok', action: `scrolled up ${totalAmount}px (curve)` };
        }
        case 'search': {
          const query = params?.query || '';
          if (!query) return { profileId, status: 'no_query' };
          
          // TRAFFIC MIX — each profile gets different search method
          const methods = ['youtube', 'youtube', 'youtube', 'google', 'bing']; // 60% YT, 20% Google, 20% Bing
          const method = methods[(index * 3 + profileId.charCodeAt(profileId.length - 1)) % methods.length];
          
          if (method === 'google') {
            await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(randomDelay(1000, 2000));
            const gInput = await page.$('input[name="q"], textarea[name="q"]');
            if (gInput) { await gInput.click(); await sleep(300); }
            for (const char of (query + ' youtube')) {
              await page.keyboard.type(char, { delay: randomDelay(50, 150) });
            }
            await sleep(500);
            await page.keyboard.press('Enter');
            return { profileId, status: 'ok', action: `searched via Google: ${query}` };
          } else if (method === 'bing') {
            await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(randomDelay(1000, 2000));
            const bInput = await page.$('input[name="q"], #sb_form_q');
            if (bInput) { await bInput.click(); await sleep(300); }
            for (const char of (query + ' youtube')) {
              await page.keyboard.type(char, { delay: randomDelay(50, 150) });
            }
            await sleep(500);
            await page.keyboard.press('Enter');
            return { profileId, status: 'ok', action: `searched via Bing: ${query}` };
          } else {
            // YouTube search
            const currentUrl = page.url();
            if (!currentUrl.includes('youtube.com')) {
              await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
              await sleep(randomDelay(1000, 2000));
            }
            await page.keyboard.press('/');
            await sleep(randomDelay(500, 800));
            await page.keyboard.press('Control+a');
            await sleep(100);
            await page.keyboard.press('Backspace');
            await sleep(200);
            for (const char of query) {
              await page.keyboard.type(char, { delay: randomDelay(50, 150) });
            }
            await sleep(500);
            await page.keyboard.press('Enter');
            return { profileId, status: 'ok', action: `searched via YouTube: ${query}` };
          }
        }
        case 'play': {
          await page.evaluate(() => { const v = document.querySelector('video'); if (v) v.play(); });
          return { profileId, status: 'ok', action: 'play' };
        }
        case 'pause': {
          await page.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); });
          return { profileId, status: 'ok', action: 'pause' };
        }
        case 'next': {
          const nextBtn = await page.$('.ytp-next-button, [aria-label="Next"]');
          if (nextBtn) await nextBtn.click();
          return { profileId, status: 'ok', action: 'next' };
        }
        case 'stop': {
          await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } });
          return { profileId, status: 'ok', action: 'stop' };
        }
        case 'skipForward': {
          await page.keyboard.press('l');
          return { profileId, status: 'ok', action: 'skipped +10s' };
        }
        case 'skipBackward': {
          await page.keyboard.press('j');
          return { profileId, status: 'ok', action: 'skipped -10s' };
        }
        case 'newTab': {
          const newPage = await agent.context.newPage();
          await newPage.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          return { profileId, status: 'ok', action: 'new tab opened' };
        }
        case 'openYoutube': {
          await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.evaluate(() => { document.cookie = 'PREF=f6=400; path=/; domain=.youtube.com'; }).catch(() => {});
          return { profileId, status: 'ok', action: 'YouTube opened' };
        }
        case 'clickVideo': {
          const vid = await page.$('ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title-link');
          if (vid) { await vid.click(); return { profileId, status: 'ok', action: 'clicked video' }; }
          return { profileId, status: 'not_found', action: 'no video to click' };
        }
        case 'clickLike': {
          const likeBtn = await page.$('like-button-view-model button, #top-level-buttons-computed ytd-toggle-button-renderer:first-child button');
          if (likeBtn) { await likeBtn.click(); return { profileId, status: 'ok', action: 'liked' }; }
          return { profileId, status: 'not_found' };
        }
        case 'clickSubscribe': {
          const subBtn = await page.$('#subscribe-button button, ytd-subscribe-button-renderer button');
          if (subBtn) { await subBtn.click(); return { profileId, status: 'ok', action: 'subscribed' }; }
          return { profileId, status: 'not_found' };
        }
        case 'arrangeWindows': {
          const allAgents = [...activeAgents.values()];
          const totalWindows = allAgents.length;
          if (totalWindows === 0) return { profileId, status: 'no_agents' };
          const cols = Math.ceil(Math.sqrt(totalWindows));
          const winW = Math.floor(1920 / cols);
          const winH = Math.floor(1080 / Math.ceil(totalWindows / cols));
          let idx = allAgents.findIndex(a => a.profileId === profileId);
          if (idx === -1) idx = 0;
          const x = (idx % cols) * winW;
          const y = Math.floor(idx / cols) * winH;
          try {
            const cdpSession = await page.context().newCDPSession(page);
            const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
            await cdpSession.send('Browser.setWindowBounds', { windowId, bounds: { left: x, top: y, width: winW, height: winH, windowState: 'normal' } });
            return { profileId, status: 'ok', action: `arranged at ${x},${y}` };
          } catch (err) { return { profileId, status: 'error', action: err.message }; }
        }
        case 'shortsWarmup': {
          const shortsCount = params?.count || 10;
          await page.goto('https://www.youtube.com/shorts', { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(randomDelay(2000, 4000));
          for (let s = 0; s < shortsCount; s++) {
            await sleep(randomDelay(5000, 30000));
            if (Math.random() < 0.15) {
              const likeBtn = await page.$('button[aria-label*="like"], #like-button button');
              if (likeBtn) await likeBtn.click().catch(() => {});
            }
            await page.keyboard.press('ArrowDown');
            await sleep(randomDelay(500, 1500));
          }
          return { profileId, status: 'ok', action: `Shorts warmup: ${shortsCount} shorts` };
        }
        default:
          return { profileId, status: 'unknown_command' };
      }
    } catch (err) {
      return { profileId, status: 'error', error: err.message };
    }
  });

  const results = await Promise.all(promises);
  res.json({ success: true, results });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Legacy save (kept for backward compat — new /api/settings POST handles everything)
app.post('/api/settings/save', (req, res) => {
  const { moreloginApiKey } = req.body;
  if (moreloginApiKey) {
    appSettings.moreloginApiKey = moreloginApiKey;
    applySettingsToEnv(appSettings);
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appSettings, null, 2)); } catch {}
  }
  res.json({ success: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO UPDATE — git pull + npm install
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/update/run', async (req, res) => {
  const { execSync } = require('child_process');
  const path = require('path');
  const projectDir = path.resolve(__dirname, '..');

  console.log('━━━ Running Update ━━━');
  try {
    // Step 1: git pull
    console.log('[Update] Running git pull...');
    const pullResult = execSync('git pull', { cwd: projectDir, encoding: 'utf8', timeout: 30000 });
    console.log('[Update] git pull:', pullResult.trim());

    // Step 2: npm install (in case new packages)
    console.log('[Update] Running npm install...');
    execSync('npm install', { cwd: projectDir, encoding: 'utf8', timeout: 60000 });
    console.log('[Update] npm install done');

    // Step 3: Read new version
    let newVersion = '1.0.0';
    try {
      const versionFile = require('fs').readFileSync(path.join(projectDir, 'version.json'), 'utf8');
      newVersion = JSON.parse(versionFile).version;
    } catch {}

    console.log(`[Update] ✅ Updated to v${newVersion}`);
    res.json({ success: true, message: 'Update complete! Restart to apply.', newVersion, pullResult: pullResult.trim() });
  } catch (err) {
    console.error('[Update] ❌ Failed:', err.message);
    res.json({ success: false, message: 'Update failed: ' + err.message });
  }
});

app.get('/api/update/version', (req, res) => {
  const path = require('path');
  try {
    const versionFile = require('fs').readFileSync(path.resolve(__dirname, '..', 'version.json'), 'utf8');
    res.json(JSON.parse(versionFile));
  } catch {
    res.json({ version: '1.0.0', lastUpdate: '', changelog: [] });
  }
});

// Push update to GitHub (from main laptop)
app.post('/api/update/push', async (req, res) => {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const projectDir = path.resolve(__dirname, '..');
  const { version, changelog } = req.body;

  if (!version || !changelog) return res.status(400).json({ success: false, message: 'version and changelog required' });

  console.log(`━━━ Pushing Update v${version} ━━━`);
  try {
    // Step 1: Update version.json
    const versionData = { version, lastUpdate: new Date().toISOString().split('T')[0], changelog };
    fs.writeFileSync(path.join(projectDir, 'version.json'), JSON.stringify(versionData, null, 2));
    console.log('[Push] version.json updated');

    // Step 2: git add all (safe — no user input)
    execFileSync('git', ['add', '-A'], { cwd: projectDir, encoding: 'utf8' });
    console.log('[Push] git add done');

    // Step 3: git commit — using array args (no shell injection possible)
    const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '');
    const safeChangelog = Array.isArray(changelog) ? changelog.slice(0, 3).join(', ') : String(changelog).slice(0, 100);
    const commitMsg = `v${safeVersion}: ${safeChangelog}`;
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: projectDir, encoding: 'utf8' });
    console.log('[Push] git commit done');

    // Step 4: git push (safe — no user input)
    const pushResult = execFileSync('git', ['push'], { cwd: projectDir, encoding: 'utf8', timeout: 30000 });
    console.log('[Push] git push done:', pushResult.trim());

    console.log(`[Push] ✅ v${version} pushed to GitHub!`);
    res.json({ success: true, message: `v${version} pushed to GitHub!` });
  } catch (err) {
    console.error('[Push] ❌ Failed:', err.message);
    res.json({ success: false, message: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROFILE AGENT RUNNER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runProfileAgent(profileId, schedule, index, delayMs) {
  // Wait for staggered start
  console.log(`[Agent ${index + 1}] Waiting ${Math.round(delayMs / 1000)}s before starting profile ${profileId}...`);
  await sleep(delayMs);

  try {
    // Step 1: Start browser profile via provider (MultiLogin/MoreLogin)
    console.log(`[Agent ${index + 1}] Starting profile: ${profileId}`);
    let debugPort = null;

    const provider = providerFactory.getProvider();
    const startRes = await provider.startProfile(profileId);

    if (startRes.code === 0 && startRes.data?.cdpPort) {
      debugPort = startRes.data.cdpPort;
      console.log(`[Agent ${index + 1}] Profile started! CDP port: ${debugPort}`);
    } else {
      // Start might take time — wait and retry once
      console.log(`[Agent ${index + 1}] Start response: ${startRes.message || 'waiting...'} — retrying in 10s...`);
      await sleep(10000);
      const retryRes = await provider.startProfile(profileId);
      if (retryRes.code === 0 && retryRes.data?.cdpPort) {
        debugPort = retryRes.data.cdpPort;
        console.log(`[Agent ${index + 1}] Profile now running! CDP port: ${debugPort}`);
      } else {
        console.error(`[Agent ${index + 1}] Failed to start profile after retry`);
        return;
      }
    }

    if (!debugPort) {
      console.error(`[Agent ${index + 1}] No debug port available`);
      return;
    }

    // Step 2: Create agent and connect via CDP
    const agent = new ProfileAgent(profileId, `Profile-${profileId.slice(-4)}`, debugPort);
    activeAgents.set(profileId, agent);

    const connected = await agent.connect();
    if (!connected) {
      console.error(`[Agent ${index + 1}] CDP connection failed`);
      activeAgents.delete(profileId);
      return;
    }

    // Step 3: Get videos to watch
    const videos = getVideosForProfile(profileId, schedule);
    console.log(`[Agent ${index + 1}] Videos to watch: ${videos.length}`);

    // Step 4: Watch each video with delay between them
    for (let vi = 0; vi < videos.length; vi++) {
      const video = videos[vi];
      const tabDelay = randomDelay(schedule.tabDelayMin * 1000, schedule.tabDelayMax * 1000);

      if (vi > 0) {
        console.log(`[Agent ${index + 1}] Waiting ${Math.round(tabDelay / 1000)}s before next video...`);
        await sleep(tabDelay);
      }

      if (video.mode === 'url') {
        await agent.watchByUrl(video.value);
      } else {
        // Find channel name for search context
        const channelName = video.channelName || '';
        await agent.searchAndWatch(video.value, channelName);
      }
    }

    // Step 5: Done — disconnect Playwright AND close browser profile
    await agent.disconnect();
    activeAgents.delete(profileId);

    // Close browser to free RAM
    try {
      const provider = providerFactory.getProvider();
      await provider.stopProfile(profileId);
      console.log(`[Agent ${index + 1}] ✅ All videos watched! Browser closed.`);
    } catch (closeErr) {
      console.log(`[Agent ${index + 1}] ✅ Videos done. Browser close failed: ${closeErr.message}`);
    }

  } catch (err) {
    console.error(`[Agent ${index + 1}] Error: ${err.message}`);
    activeAgents.delete(profileId);
    // Try to close browser even on error
    try {
      const provider = providerFactory.getProvider();
      await provider.stopProfile(profileId);
    } catch {}
  }
}

// Get videos assigned to a profile from schedule
function getVideosForProfile(profileId, schedule) {
  const videos = [];

  if (schedule.assignmentMode === 'same-all') {
    for (const cs of (schedule.sameForAll || [])) {
      const channelName = cs.channelName || '';
      for (const v of cs.videos) {
        videos.push({ ...v, channelName });
      }
    }
  } else {
    const pa = (schedule.perProfile || []).find(p => p.profileId === profileId);
    if (pa) {
      for (const cs of pa.channelSelections) {
        const channelName = cs.channelName || '';
        for (const v of cs.videos) {
          videos.push({ ...v, channelName });
        }
      }
    }
  }

  return videos;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MULTI-BROWSER PROVIDER ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use(profileRouter);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MULTILOGIN COOKIE WARMING ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/cookies/websites — list available target websites
app.get('/api/cookies/websites', async (req, res) => {
  const result = await cookiesService.getTargetWebsites();
  res.status(result.code === 0 ? 200 : 502).json(result);
});

// POST /api/cookies/metadata — create cookie warming metadata for a profile
// Body: { profileId, targetWebsite }
app.post('/api/cookies/metadata', async (req, res) => {
  const { profileId, targetWebsite = 'mix' } = req.body || {};
  if (!profileId) {
    return res.status(400).json({ code: -5, message: 'profileId is required', data: null });
  }
  const result = await cookiesService.createCookieMetadata(profileId, targetWebsite);
  res.status(result.code === 0 ? 200 : 502).json(result);
});

// PUT /api/cookies/metadata — update cookie warming target website
// Body: { profileId, targetWebsite, additionalWebsite? }
app.put('/api/cookies/metadata', async (req, res) => {
  const { profileId, targetWebsite, additionalWebsite } = req.body || {};
  if (!profileId || !targetWebsite) {
    return res.status(400).json({ code: -5, message: 'profileId and targetWebsite are required', data: null });
  }
  const result = await cookiesService.updateCookieMetadata(profileId, targetWebsite, additionalWebsite);
  res.status(result.code === 0 ? 200 : 502).json(result);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/settings — return current settings
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: appSettings });
});

// POST /api/settings — save + hot-apply to process.env + clear provider cache
app.post('/api/settings', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ success: false, error: 'Invalid body' });

  // Drop removed legacy keys if present
  const {
    startDelay, actionDelay, maxRetries, cronEnabled, cronSchedule, cronAction,
    mcpEnabled, mcpPort, dbPath, walMode, pm2Name, pm2Instances,
    ...clean
  } = updates;

  appSettings = { ...appSettings, ...clean };
  if (clean.moreloginBaseUrl && !clean.moreloginPort) {
    appSettings.moreloginPort = parseMoreloginPort(appSettings);
  }

  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to write settings: ' + err.message });
  }

  applySettingsToEnv(appSettings);

  try { providerFactory.clearCache(); } catch {}

  console.log('[Settings] Saved and applied:', Object.keys(clean).join(', '));
  activityLog.append({
    level: 'success',
    source: 'settings',
    message: `Settings saved (${Object.keys(clean).length} field(s))`,
  });
  res.json({ success: true, message: 'Settings saved and applied!', settings: appSettings });
});

app.post('/api/settings/test/morelogin', async (req, res) => {
  const base = req.body?.moreloginBaseUrl || `http://127.0.0.1:${parseMoreloginPort(req.body || {})}`;
  const apiKey = req.body?.moreloginApiKey || process.env.MORELOGIN_API_KEY || '';
  const headers = { 'Content-Type': 'application/json' };
  if (req.body?.moreloginSecurityEnabled !== false && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${base.replace(/\/$/, '')}/api/env/page`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pageNo: 1, pageSize: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (r.ok) return res.json({ ok: true, message: `MoreLogin API reachable (${r.status})` });
    return res.json({ ok: false, message: `MoreLogin returned HTTP ${r.status}` });
  } catch (err) {
    res.json({ ok: false, message: err.message || 'Cannot reach MoreLogin — is the desktop app running?' });
  }
});

app.post('/api/settings/test/multilogin', async (req, res) => {
  try {
    if (req.body && typeof req.body === 'object') {
      applySettingsToEnv({ ...appSettings, ...req.body });
      try { providerFactory.clearCache(); } catch {}
    }
    const provider = providerFactory.getProvider('multilogin');
    const token = process.env.MULTILOGIN_TOKEN;
    const email = process.env.MULTILOGIN_EMAIL;
    if (!token && !email) {
      return res.json({ ok: false, message: 'Save Multilogin token or email/password first' });
    }
    const list = await provider.listProfiles();
    if (list.code === 0) {
      return res.json({ ok: true, message: `Multilogin OK — ${(list.data || []).length} profiles in folder` });
    }
    return res.json({ ok: false, message: list.message || 'Multilogin auth failed' });
  } catch (err) {
    res.json({ ok: false, message: err.message || 'Multilogin test failed' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.listen(PORT, () => {
  const providerName = (process.env.BROWSER_PROVIDER || 'morelogin').toUpperCase();
  console.log(`\n🤖 MMB-AGENT Backend Server running on http://localhost:${PORT}`);
  console.log(`   Browser Provider: ${providerName}`);
  console.log(`   Playwright CDP: Ready`);
  console.log(`   Worker Threads: Enabled (crash isolation)`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /api/health`);
  console.log(`     GET  /api/agents`);
  console.log(`     GET  /api/workers`);
  console.log(`     GET  /api/logs`);
  console.log(`     POST /api/logs`);
  console.log(`     DELETE /api/logs`);
  console.log(`     POST /api/schedule/run    (Worker Threads)`);
  console.log(`     POST /api/schedule/stop`);
  console.log(`     POST /api/manual/start    (Direct CDP)`);
  console.log(`     POST /api/manual/batch`);
  console.log(`     POST /api/update/run`);
  console.log(`     POST /api/update/push`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
