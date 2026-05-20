/**
 * MMB-AGENT Sites Backend Server
 * - Real Playwright CDP automation via ProfileAgent
 * - Persistent analytics (JSON file)
 * - Read history tracking (prevents repeat)
 * - MoreLogin profile management
 * - Staggered profile starts
 * - Profile close after session
 */

// Load .env first (lightweight loader, no dotenv dependency)
require('../../server/providers/loadEnv.cjs')();

const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ProfileAgent } = require('./agent.cjs');
const { Orchestrator } = require('./orchestrator.cjs');
const { profileRouter } = require('../../server/providers/profileRouter.cjs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(profileRouter);

const PORT = 3200;
// NOTE: moreloginRequest() reads appSettings at call time — do NOT cache key/port here

const activeAgents = new Map();
const orchestrator = new Orchestrator();
const runningSchedules = new Map();
const cancelledSchedules = new Set();
// Cache: profileId → cdpPort (set on successful start, used when "already running")
const cdpPortCache = new Map();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERSISTENT DATA FILES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DATA_DIR = path.join(__dirname, '..', 'data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics_data.json');
const READ_HISTORY_FILE = path.join(DATA_DIR, 'read_history.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load analytics from file
function loadAnalytics() {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    }
  } catch {}
  return {
    totalReads: 0, totalDwellTime: 0, totalSessions: 0, adImpressions: 0,
    perProfile: {}, perSite: {}, trafficSources: { google: 0, bing: 0, duckduckgo: 0, yahoo: 0, direct: 0, internal: 0, backlink: 0, social: 0 },
    recentActivity: [],
  };
}

function saveAnalytics() {
  try { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analyticsData, null, 2)); } catch {}
}

// Load read history from file
function loadReadHistory() {
  try {
    if (fs.existsSync(READ_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(READ_HISTORY_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveReadHistory() {
  try { fs.writeFileSync(READ_HISTORY_FILE, JSON.stringify(readHistoryData, null, 2)); } catch {}
}

const analyticsData = loadAnalytics();
const readHistoryData = loadReadHistory(); // { profileId: [{ url, title, readAt }] }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS  — UI-configurable, no .env needed
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  // MoreLogin
  moreloginApiKey:           '0df5ef07ccfd376ba7461deab39c040f6f80db8fc5829bfd',
  moreloginPort:             '40000',
  moreloginSecurityEnabled:  true,
  // Multilogin
  multiloginEmail:    '',
  multiloginPassword: '',
  multiloginToken:    '',
  multiloginFolderId: 'fb5dbb2c-c1dc-45ee-9fa1-f34819d84bf2',
  // AdsPower
  adspowerApiKey: '',
  adspowerPort:   '50325',
  // Proxy
  proxyServer:   'us.smartproxy.net',
  proxyPort:     '3120',
  proxyPassword: 'xEdCpOSFn3nd4ixu',
  proxyPrefix:   'smart-pwgbkxcy3lyi',
  defaultProxyLife: '4hr',
  // Automation
  startDelay:     '5000',
  actionDelay:    '2000',
  maxConcurrent:  '5',
  maxRetries:     '3',
  backendPort:    '3200',
  // Cron
  cronEnabled:  false,
  cronSchedule: '0 9 * * *',
  cronAction:   'start_all',
};

function loadAppSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function applySettingsToEnv(s) {
  if (s.moreloginApiKey)    process.env.MORELOGIN_API_KEY      = s.moreloginApiKey;
  if (s.moreloginPort)      process.env.MORELOGIN_PORT         = s.moreloginPort;
  if (s.multiloginEmail)    process.env.MULTILOGIN_EMAIL       = s.multiloginEmail;
  if (s.multiloginPassword) process.env.MULTILOGIN_PASSWORD    = s.multiloginPassword;
  // Always set/clear token so empty string removes a previously-set fake token
  process.env.MULTILOGIN_TOKEN = s.multiloginToken || '';
  if (s.multiloginFolderId) process.env.MULTILOGIN_FOLDER_ID   = s.multiloginFolderId;
}

let appSettings = loadAppSettings();
applySettingsToEnv(appSettings);   // Apply on startup — overrides .env if settings.json exists


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MORELOGIN API HELPER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function moreloginRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    // Always read from appSettings so UI changes take effect immediately
    const apiKey = appSettings.moreloginApiKey || 'dbc21d41137f29238f4679e71b7986decb0581115e34a84e';
    const mlPort = parseInt(appSettings.moreloginPort, 10) || 40000;
    const options = {
      hostname: '127.0.0.1',
      port: mlPort,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
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
// HEALTH & STATUS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tool: 'MMB Agent Sites', agents: activeAgents.size, uptime: process.uptime() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', agents: activeAgents.size, schedules: runningSchedules.size });
});

app.get('/status', (req, res) => {
  const status = {};
  for (const [id, agent] of activeAgents) {
    status[id] = agent.getStatus();
  }
  res.json(status);
});

app.get('/logs', (req, res) => {
  res.json(orchestrator.getLogs());
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START/STOP WORKERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/start', (req, res) => {
  const { profileId, envId, articles, settings } = req.body;
  if (!profileId || !articles || articles.length === 0) {
    return res.status(400).json({ error: 'profileId and articles required' });
  }
  try {
    orchestrator.startWorker(profileId, envId, articles, settings);
    res.json({ success: true, message: `Worker started for profile ${profileId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/stop', (req, res) => {
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });
  orchestrator.stopWorker(profileId);
  res.json({ success: true, message: `Worker stopped for profile ${profileId}` });
});

app.post('/stop-all', (req, res) => {
  orchestrator.stopAll();
  for (const [id, agent] of activeAgents) {
    agent.disconnect().catch(() => {});
    activeAgents.delete(id);
  }
  res.json({ success: true, message: 'All workers stopped' });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ANALYTICS (Persistent)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/analytics', (req, res) => {
  res.json(analyticsData);
});

app.post('/api/analytics/track', (req, res) => {
  const { profileId, action, value } = req.body;
  if (!profileId || !action) return res.status(400).json({ error: 'profileId and action required' });

  if (!analyticsData.perProfile[profileId]) {
    analyticsData.perProfile[profileId] = { reads: 0, dwellTime: 0, comments: 0, sessions: 0 };
  }
  const p = analyticsData.perProfile[profileId];

  switch (action) {
    case 'read': analyticsData.totalReads++; p.reads++; break;
    case 'dwellTime': analyticsData.totalDwellTime += (value || 0); p.dwellTime += (value || 0); break;
    case 'session': analyticsData.totalSessions++; p.sessions++; break;
    case 'adImpression': analyticsData.adImpressions++; break;
    case 'comment': p.comments++; break;
    case 'traffic_google': analyticsData.trafficSources.google++; break;
    case 'traffic_bing': analyticsData.trafficSources.bing = (analyticsData.trafficSources.bing || 0) + 1; break;
    case 'traffic_duckduckgo': analyticsData.trafficSources.duckduckgo = (analyticsData.trafficSources.duckduckgo || 0) + 1; break;
    case 'traffic_yahoo': analyticsData.trafficSources.yahoo = (analyticsData.trafficSources.yahoo || 0) + 1; break;
    case 'traffic_direct': analyticsData.trafficSources.direct++; break;
    case 'traffic_internal': analyticsData.trafficSources.internal++; break;
    case 'traffic_backlink': analyticsData.trafficSources.backlink++; break;
    case 'traffic_social': analyticsData.trafficSources.social = (analyticsData.trafficSources.social || 0) + 1; break;
  }

  analyticsData.recentActivity.push({ profileId, action, value, time: Date.now() });
  if (analyticsData.recentActivity.length > 100) analyticsData.recentActivity = analyticsData.recentActivity.slice(-100);

  // Save to file every track
  saveAnalytics();
  res.json({ success: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// READ HISTORY (Prevents Repeat)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/read-history', (req, res) => {
  res.json(readHistoryData);
});

app.get('/api/read-history/:profileId', (req, res) => {
  const { profileId } = req.params;
  res.json(readHistoryData[profileId] || []);
});

app.post('/api/read-history/track', (req, res) => {
  const { profileId, articleUrl, articleTitle, dwellTime, trafficSource } = req.body;
  if (!profileId || !articleUrl) return res.status(400).json({ error: 'profileId and articleUrl required' });

  if (!readHistoryData[profileId]) readHistoryData[profileId] = [];

  readHistoryData[profileId].push({
    url: articleUrl,
    title: articleTitle || '',
    dwellTime: dwellTime || 0,
    trafficSource: trafficSource || 'direct',
    readAt: Date.now(),
  });

  // Keep only last 24h of history per profile
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  readHistoryData[profileId] = readHistoryData[profileId].filter(h => h.readAt > cutoff);

  saveReadHistory();
  res.json({ success: true });
});

// Check if article was already read by profile (within 24h)
app.post('/api/read-history/check', (req, res) => {
  const { profileId, articleUrl } = req.body;
  if (!profileId || !articleUrl) return res.status(400).json({ error: 'profileId and articleUrl required' });

  const history = readHistoryData[profileId] || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const alreadyRead = history.some(h => h.url === articleUrl && h.readAt > cutoff);
  res.json({ alreadyRead });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCHEDULER RUN (Staggered + Profile Close)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/scheduler/run', async (req, res) => {
  const schedule = req.body;
  if (!schedule) return res.status(400).json({ error: 'Schedule data required' });

  const scheduleId = schedule.id || Date.now().toString();
  const provider = schedule.provider || 'morelogin';
  cancelledSchedules.delete(scheduleId); // clear any stale cancel flag

  console.log(`\n━━━ Starting Schedule: ${schedule.name || 'Unnamed'} [${provider}] ━━━`);
  runningSchedules.set(scheduleId, { schedule, status: 'running', startedAt: Date.now(), progress: [] });

  const profiles = schedule.selectedProfiles || schedule.assignments?.map(a => a.profileId) || [];
  console.log(`Profiles: ${profiles.length}`);

  (async () => {
    for (let i = 0; i < profiles.length; i++) {
      // Check cancellation before each profile
      if (cancelledSchedules.has(scheduleId)) {
        console.log(`[Schedule ${scheduleId}] Cancelled — stopping after profile ${i}`);
        break;
      }

      const profileId = profiles[i];

      if (i > 0) {
        const staggerDelay = randomDelay(
          (schedule.profileDelayMin || 5) * 1000,
          (schedule.profileDelayMax || 30) * 1000
        );
        console.log(`[Schedule] Waiting ${Math.round(staggerDelay / 1000)}s before next profile...`);
        await sleep(staggerDelay);
      }

      const progressEntry = { profileId, status: 'starting', startedAt: Date.now(), articlesRead: 0 };
      const existing = runningSchedules.get(scheduleId);
      if (existing) existing.progress.push(progressEntry);

      try {
        const debugPort = await startProfileForSchedule(profileId, provider);

        if (debugPort) {
          progressEntry.status = 'connected';
          const agent = new ProfileAgent(profileId, `Sites-${profileId.slice(-4)}`, debugPort);
          activeAgents.set(profileId, agent);
          const connected = await agent.connect();

          if (connected) {
            const articles = getArticlesForProfile(profileId, schedule);

            // Deduplicate against 24h read history
            const history = readHistoryData[profileId] || [];
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            const recentUrls = new Set(history.filter(h => h.readAt > cutoff).map(h => h.url));
            let freshArticles = articles.filter(a => !recentUrls.has(a.url));

            // Apply per-session article limit
            const sessionLimit = schedule.articlesPerSession ? Number(schedule.articlesPerSession) : undefined;
            if (sessionLimit && sessionLimit > 0) freshArticles = freshArticles.slice(0, sessionLimit);

            if (freshArticles.length > 0) {
              console.log(`[Schedule] Profile ${profileId}: ${freshArticles.length} fresh articles`);
              progressEntry.status = 'reading';

              // Random article delay between min and max
              const articleDelay = randomDelay(
                (schedule.articleDelayMin || 20) * 1000,
                (schedule.articleDelayMax || 60) * 1000
              ) / 1000;

              const results = await agent.runSession(freshArticles, {
                trafficPreference: schedule.trafficSource || 'random',
                articleDelay,
                readTimeMin: schedule.readTimeMin || 30,
                readTimeMax: schedule.readTimeMax || 300,
                scrollSpeed: schedule.scrollSpeed || 'medium',
                adPauseDurationMin: 0.5,
                adPauseDurationMax: 2,
              });

              for (const r of results) {
                if (r.result) {
                  if (!readHistoryData[profileId]) readHistoryData[profileId] = [];
                  readHistoryData[profileId].push({
                    url: r.article.url,
                    title: r.article.title,
                    dwellTime: r.result.dwellTime || 0,
                    trafficSource: r.result.trafficSource || 'random',
                    readAt: Date.now(),
                  });
                  progressEntry.articlesRead++;
                  analyticsData.totalReads++;
                  analyticsData.totalDwellTime += r.result.dwellTime || 0;
                  const src = r.result.trafficSource || 'direct';
                  if (analyticsData.trafficSources[src] !== undefined) analyticsData.trafficSources[src]++;
                  if (!analyticsData.perProfile[profileId]) analyticsData.perProfile[profileId] = { reads: 0, dwellTime: 0 };
                  analyticsData.perProfile[profileId].reads++;
                  analyticsData.perProfile[profileId].dwellTime += r.result.dwellTime || 0;
                  const siteHost = new URL(r.article.url).hostname;
                  if (!analyticsData.perSite[siteHost]) analyticsData.perSite[siteHost] = { reads: 0, dwellTime: 0 };
                  analyticsData.perSite[siteHost].reads++;
                  analyticsData.perSite[siteHost].dwellTime += r.result.dwellTime || 0;
                  analyticsData.recentActivity.unshift({ profileId, url: r.article.url, title: r.article.title, dwellTime: r.result.dwellTime || 0, trafficSource: src, readAt: Date.now() });
                  if (analyticsData.recentActivity.length > 100) analyticsData.recentActivity.length = 100;
                }
              }
              saveReadHistory();
              analyticsData.totalSessions++;
              saveAnalytics();
            } else {
              console.log(`[Schedule] Profile ${profileId}: No fresh articles`);
              progressEntry.status = 'skipped';
            }
          }

          await agent.disconnect();
          activeAgents.delete(profileId);
          await closeProfileForSchedule(profileId, provider);
          progressEntry.status = 'done';
          console.log(`[Schedule] Profile ${profileId} done`);
        } else {
          progressEntry.status = 'error';
          console.error(`[Schedule] Profile ${profileId}: Could not get debug port`);
        }
      } catch (err) {
        progressEntry.status = 'error';
        console.error(`[Schedule] Profile ${profileId} error: ${err.message}`);
      }

      progressEntry.completedAt = Date.now();
    }

    const finalStatus = cancelledSchedules.has(scheduleId) ? 'idle' : 'completed';
    cancelledSchedules.delete(scheduleId);
    runningSchedules.set(scheduleId, { ...runningSchedules.get(scheduleId), status: finalStatus, completedAt: Date.now() });
    console.log(`\n━━━ Schedule ${finalStatus === 'completed' ? 'Complete' : 'Cancelled'} ━━━\n`);
  })();

  res.json({ success: true, scheduleId, message: `Schedule started with ${profiles.length} profiles` });
});

app.post('/api/schedule/run', async (req, res) => {
  const schedule = req.body?.schedule || req.body;
  req.body = schedule;
  // Forward to scheduler/run
  const fakeReq = { ...req, url: '/api/scheduler/run', body: schedule };
  const handler = app._router.stack.find(l => l.route && l.route.path === '/api/scheduler/run' && l.route.methods.post);
  if (handler) {
    handler.route.stack[0].handle(fakeReq, res, () => {});
  } else {
    res.status(500).json({ error: 'Scheduler endpoint not found' });
  }
});

// Stop a running schedule
app.post('/api/scheduler/stop', (req, res) => {
  const { scheduleId } = req.body || {};
  if (!scheduleId) return res.status(400).json({ error: 'scheduleId required' });
  cancelledSchedules.add(scheduleId);
  const existing = runningSchedules.get(scheduleId);
  if (existing) runningSchedules.set(scheduleId, { ...existing, status: 'idle' });
  res.json({ success: true, message: 'Stop signal sent' });
});

// Get schedule status (includes per-profile progress)
app.get('/api/scheduler/status', (req, res) => {
  const statuses = {};
  for (const [id, data] of runningSchedules) {
    statuses[id] = {
      status: data.status,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      progress: data.progress || [],
    };
  }
  res.json(statuses);
});

// Get articles for a profile from schedule
function getArticlesForProfile(profileId, schedule) {
  if (schedule.assignments) {
    const assignment = schedule.assignments.find(a => a.profileId === profileId);
    if (assignment) return assignment.articles || [];
  }
  if (schedule.perProfile) {
    const pp = schedule.perProfile.find(p => p.profileId === profileId);
    if (pp && pp.backlinks) {
      return pp.backlinks.map(b => ({ url: b.targetArticleUrl || b.sourceUrl, title: b.targetArticleUrl || 'Backlink' }));
    }
  }
  // Articles pre-resolved by the frontend from selected sites
  if (Array.isArray(schedule.resolvedArticles) && schedule.resolvedArticles.length > 0) {
    return schedule.resolvedArticles;
  }
  return [];
}

// Helper: start a profile via the correct provider, return debugPort/cdpPort
async function startProfileForSchedule(profileId, provider) {
  const prov = provider || 'morelogin';
  if (prov === 'morelogin') {
    const statusRes = await moreloginRequest('/api/env/status', { envId: profileId });
    if (statusRes.code === 0 && statusRes.data?.status === 'running' && statusRes.data?.debugPort) {
      return statusRes.data.debugPort;
    }
    const startRes = await moreloginRequest('/api/env/start', { envId: profileId });
    if (startRes.code === 0 && startRes.data?.debugPort) return startRes.data.debugPort;
    await sleep(10000);
    const retry = await moreloginRequest('/api/env/status', { envId: profileId });
    return (retry.code === 0 && retry.data?.debugPort) ? retry.data.debugPort : null;
  }
  // All other providers (multilogin, adspower) via providerFactory
  try {
    const { providerFactory } = require('../../server/providers/ProviderFactory.cjs');
    const provInst = providerFactory.getProvider(prov);
    const startRes = await provInst.startProfile(profileId);
    if (startRes.code === 0 && startRes.data?.cdpPort) {
      cdpPortCache.set(profileId, startRes.data.cdpPort); // cache for future "already running" retries
      return startRes.data.cdpPort;
    }
    // Profile already running — check CDP port cache first, then verify port is live
    const cached = cdpPortCache.get(profileId);
    if (cached) {
      const alive = await new Promise(resolve => {
        const req = http.get({ hostname: '127.0.0.1', port: cached, path: '/json', timeout: 2000 }, () => resolve(true));
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (alive) {
        console.log(`[scheduler] ${prov} profile ${profileId.slice(-4)} already running — using cached CDP port ${cached}`);
        return cached;
      }
    }
    console.error(`[scheduler] startProfile via ${prov} failed: ${startRes.message}`);
    return null;
  } catch (e) {
    console.error(`[scheduler] startProfile via ${prov} failed: ${e.message}`);
    return null;
  }
}

// Helper: close a profile via the correct provider
async function closeProfileForSchedule(profileId, provider) {
  const prov = provider || 'morelogin';
  try {
    if (prov === 'morelogin') {
      await moreloginRequest('/api/env/close', { envId: profileId });
    } else {
      const { providerFactory } = require('../../server/providers/ProviderFactory.cjs');
      await providerFactory.getProvider(prov).stopProfile(profileId);
    }
  } catch {}
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MANUAL CONTROL (With Traffic Routing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/manual/start', async (req, res) => {
  // Accept either flat profileIds[] or profiles[{profileId,browserType}] array
  const { profileIds, profiles: profileList } = req.body;
  if (!profileIds && !profileList) return res.status(400).json({ error: 'profileIds or profiles required' });

  // Build unified list: [{ profileId, browserType, cdpPort? }]
  let targets = [];
  if (profileList && Array.isArray(profileList)) {
    targets = profileList.map(p => ({
      profileId: p.profileId || p.envId,
      browserType: p.browserType || 'morelogin',
      cdpPort: p.cdpPort || null,
    }));
  } else {
    targets = (profileIds || []).map(id => ({ profileId: id, browserType: 'morelogin', cdpPort: null }));
  }

  const results = [];
  for (const { profileId, browserType, cdpPort: knownPort } of targets) {
    try {
      // If cdpPort provided directly — verify it's live and skip launcher call
      let debugPort = null;
      if (knownPort) {
        const alive = await new Promise(resolve => {
          const req = http.get({ hostname: '127.0.0.1', port: knownPort, path: '/json', timeout: 2000 }, () => resolve(true));
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
        });
        if (alive) {
          debugPort = knownPort;
          cdpPortCache.set(profileId, knownPort);
          console.log(`[manual/start] Using provided cdpPort ${knownPort} for ${profileId.slice(-4)}`);
        }
      }
      if (!debugPort) debugPort = await startProfileForSchedule(profileId, browserType || 'morelogin');

      if (debugPort) {
        const agent = new ProfileAgent(profileId, `Manual-${profileId.slice(-4)}`, debugPort);
        await agent.connect();
        activeAgents.set(profileId, agent);
        results.push({ profileId, status: 'connected', debugPort });
      } else {
        results.push({ profileId, status: 'failed', error: 'No debug port — check provider & profile status' });
      }
    } catch (err) {
      results.push({ profileId, status: 'failed', error: err.message });
    }
  }
  res.json({ success: true, results });
});

app.post('/api/manual/stop', async (req, res) => {
  const { profileIds, profiles: profileList } = req.body;
  if (!profileIds && !profileList) return res.status(400).json({ error: 'profileIds or profiles required' });

  const targets = profileList && Array.isArray(profileList)
    ? profileList.map(p => ({ profileId: p.profileId || p.envId, browserType: p.browserType || 'morelogin' }))
    : (profileIds || []).map(id => ({ profileId: id, browserType: 'morelogin' }));

  for (const { profileId, browserType } of targets) {
    const agent = activeAgents.get(profileId);
    if (agent) {
      await agent.disconnect().catch(() => {});
      activeAgents.delete(profileId);
    }
    await closeProfileForSchedule(profileId, browserType || 'morelogin');
  }
  res.json({ success: true, message: 'Profiles stopped and closed' });
});

app.post('/api/manual/batch', async (req, res) => {
  const { profileIds, command, params } = req.body;
  if (!profileIds || !command) return res.status(400).json({ error: 'profileIds and command required' });

  const results = [];
  for (const profileId of profileIds) {
    const agent = activeAgents.get(profileId);
    if (!agent || !agent.context) {
      results.push({ profileId, status: 'not_connected' });
      continue;
    }

    try {
      const pages = agent.context.pages();
      const page = pages[pages.length - 1];
      if (!page) { results.push({ profileId, status: 'no_page' }); continue; }

      // Unique stagger per profile (human-like)
      const stagger = Math.floor(Math.random() * 2000) + 500;
      await sleep(stagger);

      switch (command) {
        case 'scrollDown': {
          // Unique scroll curve per profile
          const amount = Math.floor(Math.random() * 300) + 200;
          const steps = Math.floor(Math.random() * 8) + 5;
          const curveType = Math.random(); // Different curve per profile
          for (let s = 0; s < steps; s++) {
            const progress = s / steps;
            // Sine wave variation (unique per profile based on curveType)
            const speedMult = 0.5 + Math.sin(progress * Math.PI * (1 + curveType)) * 0.5;
            const stepAmount = (amount / steps) * speedMult + (Math.random() * 10 - 5);
            await page.mouse.wheel(0, stepAmount);
            await sleep(randomDelay(30, 80));
          }
          results.push({ profileId, status: 'ok', action: `scrolled down ${amount}px (curve)` });
          break;
        }
        case 'scrollUp': {
          const amount = Math.floor(Math.random() * 300) + 200;
          const steps = Math.floor(Math.random() * 8) + 5;
          for (let s = 0; s < steps; s++) {
            await page.mouse.wheel(0, -(amount / steps + (Math.random() * 10 - 5)));
            await sleep(randomDelay(30, 80));
          }
          results.push({ profileId, status: 'ok', action: `scrolled up ${amount}px` });
          break;
        }
        case 'navigate': {
          const url = params?.url;
          if (url) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            results.push({ profileId, status: 'ok', action: `navigated to ${url}` });
          } else {
            results.push({ profileId, status: 'no_url' });
          }
          break;
        }
        case 'readArticle': {
          const url = params?.url;
          const title = params?.title || 'Manual Read';
          const traffic = params?.trafficPreference || 'random';
          if (url) {
            // Use full traffic routing (not just direct)
            await agent.readArticle(url, title, {
              trafficPreference: traffic,
              readTimeMin: 30,
              readTimeMax: 120,
              siteUrl: params?.siteUrl,
            });
            // Track in history
            if (!readHistoryData[profileId]) readHistoryData[profileId] = [];
            readHistoryData[profileId].push({ url, title, dwellTime: 0, trafficSource: traffic, readAt: Date.now() });
            saveReadHistory();
            // Track analytics
            analyticsData.totalReads++;
            if (!analyticsData.perProfile[profileId]) analyticsData.perProfile[profileId] = { reads: 0, dwellTime: 0, comments: 0, sessions: 0 };
            analyticsData.perProfile[profileId].reads++;
            saveAnalytics();
            results.push({ profileId, status: 'ok', action: `reading article (${traffic})` });
          } else {
            results.push({ profileId, status: 'no_url' });
          }
          break;
        }
        case 'googleSearch': {
          const query = params?.query || '';
          await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (query) {
            await sleep(randomDelay(1000, 2000));
            const input = await page.$('input[name="q"], textarea[name="q"]');
            if (input) {
              await input.click();
              await sleep(300);
              for (const char of query) {
                await page.keyboard.type(char, { delay: randomDelay(80, 200) });
              }
              await sleep(randomDelay(500, 1000));
              await page.keyboard.press('Enter');
            }
          }
          results.push({ profileId, status: 'ok', action: query ? `Google searched: ${query}` : 'Google opened' });
          break;
        }
        case 'goBack': {
          await page.goBack().catch(() => {});
          results.push({ profileId, status: 'ok', action: 'went back' });
          break;
        }
        case 'refresh': {
          await page.reload().catch(() => {});
          results.push({ profileId, status: 'ok', action: 'refreshed' });
          break;
        }
        case 'scrollToBottom': {
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          results.push({ profileId, status: 'ok', action: 'scrolled to bottom' });
          break;
        }
        case 'openHomepage': {
          const homepageUrl = params?.url || 'https://google.com';
          await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          results.push({ profileId, status: 'ok', action: 'homepage opened' });
          break;
        }
        case 'arrangeWindows': {
          try {
            const allAgents = [...activeAgents.values()];
            const total = allAgents.length;
            const cols = Math.ceil(Math.sqrt(total));
            const winW = Math.floor(1920 / cols);
            const winH = Math.floor(1080 / Math.ceil(total / cols));
            const idx = allAgents.findIndex(a => a.profileId === profileId);
            const x = (idx % cols) * winW;
            const y = Math.floor(idx / cols) * winH;
            const cdpSession = await page.context().newCDPSession(page);
            const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
            await cdpSession.send('Browser.setWindowBounds', { windowId, bounds: { left: x, top: y, width: winW, height: winH, windowState: 'normal' } });
            results.push({ profileId, status: 'ok', action: `arranged at ${x},${y}` });
          } catch (err) {
            results.push({ profileId, status: 'error', error: err.message });
          }
          break;
        }
        default:
          results.push({ profileId, status: 'unknown_command' });
      }
    } catch (err) {
      results.push({ profileId, status: 'error', error: err.message });
    }
  }
  res.json({ success: true, results });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RATE LIMITS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/rate-limit/check', (req, res) => {
  const { profileId, dailyCap } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  const history = readHistoryData[profileId] || [];
  const today = new Date().toDateString();
  const todayReads = history.filter(h => new Date(h.readAt).toDateString() === today).length;
  const cap = dailyCap || 20;
  const allowed = todayReads < cap;

  res.json({ allowed, todayReads, cap, remaining: Math.max(0, cap - todayReads) });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GIT UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/update/version', (req, res) => {
  try {
    const versionFile = fs.readFileSync(path.resolve(__dirname, '..', '..', 'version.json'), 'utf8');
    res.json(JSON.parse(versionFile));
  } catch {
    res.json({ version: '1.0.0', lastUpdate: '', changelog: [] });
  }
});

app.post('/api/update/push', async (req, res) => {
  const { execSync } = require('child_process');
  const projectDir = path.resolve(__dirname, '..', '..');
  const { version, changelog } = req.body;

  if (!version || !changelog) return res.status(400).json({ success: false, message: 'version and changelog required' });

  try {
    const versionData = { version, lastUpdate: new Date().toISOString().split('T')[0], changelog };
    fs.writeFileSync(path.join(projectDir, 'version.json'), JSON.stringify(versionData, null, 2));
    execSync('git add -A', { cwd: projectDir, encoding: 'utf8' });
    const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '');
    const safeChangelog = changelog.slice(0, 3).map(c => c.replace(/["`$\\]/g, '')).join(', ');
    const commitMsg = `v${safeVersion}: ${safeChangelog}`;
    execSync(`git commit -m "${commitMsg}"`, { cwd: projectDir, encoding: 'utf8' });
    execSync('git push', { cwd: projectDir, encoding: 'utf8', timeout: 30000 });
    res.json({ success: true, message: `v${version} pushed to GitHub!` });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/update/run', async (req, res) => {
  const { execSync } = require('child_process');
  const projectDir = path.resolve(__dirname, '..', '..');
  try {
    execSync('git pull', { cwd: projectDir, encoding: 'utf8', timeout: 30000 });
    execSync('npm install', { cwd: projectDir, encoding: 'utf8', timeout: 60000 });
    let newVersion = '1.0.0';
    try { newVersion = JSON.parse(fs.readFileSync(path.join(projectDir, 'version.json'), 'utf8')).version; } catch {}
    res.json({ success: true, message: 'Update complete!', newVersion });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /api/proxy/check — test one proxy, return real IP + speed via ip-api.com
app.post('/api/proxy/check', async (req, res) => {
  const { server, port, username, password } = req.body || {};
  if (!server || !port) return res.status(400).json({ success: false, error: 'server and port required' });

  const start = Date.now();
  try {
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: server,
        port: parseInt(port) || 3120,
        path: 'http://ip-api.com/json',
        method: 'GET',
        headers: {
          'Host': 'ip-api.com',
          'User-Agent': 'Mozilla/5.0',
          'Proxy-Authorization': 'Basic ' + Buffer.from(`${username || ''}:${password || ''}`).toString('base64'),
        },
      };
      const req2 = http.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', c => { data += c; });
        proxyRes.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.status === 'success') {
              resolve({ ip: json.query, city: json.city, region: json.regionName, country: json.country, isp: json.isp });
            } else {
              resolve({ ip: 'Unknown', city: '', region: '', country: '', isp: '' });
            }
          } catch {
            resolve({ ip: 'Unknown', city: '', region: '', country: '', isp: '' });
          }
        });
      });
      req2.setTimeout(9000, () => { req2.destroy(); reject(new Error('timeout')); });
      req2.on('error', reject);
      req2.end();
    });
    res.json({ success: true, ...result, speed: Date.now() - start });
  } catch (err) {
    res.json({ success: false, error: err.message || 'failed', speed: Date.now() - start });
  }
});

// POST /api/test-connection — ping a provider and return ok/error
app.post('/api/test-connection', async (req, res) => {
  const { provider } = req.body || {};
  try {
    if (provider === 'morelogin') {
      const port = process.env.MORELOGIN_PORT || appSettings.moreloginPort || '40000';
      const key  = process.env.MORELOGIN_API_KEY || appSettings.moreloginApiKey || '';
      const r = await fetch(`http://127.0.0.1:${port}/api/env/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ page: 1, pageSize: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await r.json().catch(() => ({}));
      if (data.code === 0) return res.json({ success: true, message: `MoreLogin OK — ${data.data?.total ?? '?'} profiles` });
      return res.json({ success: false, message: `MoreLogin error: ${data.msg || 'bad response'}` });
    }
    if (provider === 'multilogin') {
      const token = process.env.MULTILOGIN_TOKEN || appSettings.multiloginToken || '';
      const email = process.env.MULTILOGIN_EMAIL || appSettings.multiloginEmail || '';
      const pass  = process.env.MULTILOGIN_PASSWORD || appSettings.multiloginPassword || '';
      if (!token && (!email || !pass)) return res.json({ success: false, message: 'No credentials configured' });
      if (token) return res.json({ success: true, message: 'Automation token is set — will validate on first use' });
      return res.json({ success: true, message: 'Email + password configured — will authenticate on first use' });
    }
    if (provider === 'adspower') {
      const port   = appSettings.adspowerPort || '50325';
      const apiKey = appSettings.adspowerApiKey || '';
      const url    = `http://local.adspower.com:${port}/api/v1/browser/list?api_key=${encodeURIComponent(apiKey)}&page=1&page_size=1`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await r.json().catch(() => ({}));
      if (data.code === 0) return res.json({ success: true, message: `AdsPower OK` });
      return res.json({ success: false, message: `AdsPower error: ${data.msg || 'bad response'}` });
    }
    res.json({ success: false, message: 'Unknown provider' });
  } catch (err) {
    res.json({ success: false, message: `Connection failed: ${err.message}` });
  }
});

// GET /api/settings — return current settings
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: appSettings });
});

// POST /api/settings — save, hot-apply to process.env, clear provider cache
app.post('/api/settings', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ success: false, error: 'Invalid body' });

  appSettings = { ...appSettings, ...updates };

  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to write settings: ' + err.message });
  }

  // Apply new values to process.env immediately
  applySettingsToEnv(appSettings);

  // Clear provider cache — next request creates fresh providers with new credentials
  try {
    const { providerFactory } = require('../../server/providers/ProviderFactory.cjs');
    providerFactory.clearCache();
  } catch {}

  console.log('[Settings] Saved and applied:', Object.keys(updates).join(', '));
  res.json({ success: true, message: 'Settings saved and applied!' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.listen(PORT, () => {
  console.log(`\n🌐 MMB-AGENT Sites Backend running on http://localhost:${PORT}`);
  console.log(`   MoreLogin API: http://127.0.0.1:${appSettings.moreloginPort || 40000}`);
  console.log(`   API Key: ${(appSettings.moreloginApiKey || '').slice(0, 8)}...`);
  console.log(`   Playwright CDP: Ready`);
  console.log(`   Analytics: ${ANALYTICS_FILE}`);
  console.log(`   Read History: ${READ_HISTORY_FILE}`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health`);
  console.log(`     GET  /api/analytics`);
  console.log(`     GET  /api/read-history`);
  console.log(`     POST /api/scheduler/run`);
  console.log(`     POST /api/manual/start`);
  console.log(`     POST /api/manual/batch`);
  console.log(`     POST /api/rate-limit/check`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
