const { parentPort, workerData } = require('worker_threads');
const { ProfileAgent, getSiteConfig, getReadTimeByCategory } = require('./agent.cjs');
const http = require('http');
const https = require('https');

/**
 * Sites Worker — REAL browser automation via Playwright CDP
 *
 * Flow:
 * 1. Auto-sync articles from sitemap (hamstercombocard.com/sitemap_index.xml)
 * 2. Prioritize Mesothelioma/Law articles (post IDs 1209-1218)
 * 3. Enforce US geography on MoreLogin profile before start
 * 4. Get debugPort from MoreLogin (start profile if needed)
 * 5. Connect to browser via CDP (ProfileAgent)
 * 6. For each article: traffic route → navigate → butter scroll → dwell
 * 7. Multi-page related post sessions (automatic)
 * 8. Track analytics
 * 9. Close profile when done
 */

const { profileId, envId, articles: workerArticles, settings } = workerData;

function log(level, message) {
  parentPort.postMessage({ type: 'log', level, message });
}

function progress(articleIndex, totalArticles, url) {
  parentPort.postMessage({ type: 'progress', articleIndex, totalArticles, url });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BROWSER PROVIDER DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Auto-detect: UUID format = Multilogin, numeric = MoreLogin
const BROWSER_PROVIDER = process.env.BROWSER_PROVIDER ||
  (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(profileId)) ? 'multilogin' : 'morelogin');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MORELOGIN API — Start/Stop/Status/Update
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MORELOGIN_API_KEY = process.env.MORELOGIN_API_KEY || 'dbc21d41137f29238f4679e71b7986decb0581115e34a84e';

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
        'Authorization': `Bearer ${MORELOGIN_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ code: -1, msg: 'Invalid JSON' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MULTILOGIN LAUNCHER API — Start/Stop via local launcher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MULTILOGIN_TOKEN = process.env.MULTILOGIN_TOKEN || '';
const MULTILOGIN_FOLDER_ID = process.env.MULTILOGIN_FOLDER_ID || '';
const MULTILOGIN_EMAIL = process.env.MULTILOGIN_EMAIL || '';
const MULTILOGIN_PASSWORD = process.env.MULTILOGIN_PASSWORD || '';

// Cache session token (valid 30 min)
let _mlxSessionToken = '';
let _mlxSessionExpiry = 0;

async function getMultiloginSessionToken() {
  if (_mlxSessionToken && Date.now() < _mlxSessionExpiry) return _mlxSessionToken;
  if (!MULTILOGIN_EMAIL || !MULTILOGIN_PASSWORD) {
    // Fall back to automation token
    return MULTILOGIN_TOKEN;
  }
  try {
    const { createHash } = require('crypto');
    const pwdHash = createHash('md5').update(MULTILOGIN_PASSWORD, 'utf8').digest('hex');
    const payload = JSON.stringify({ email: MULTILOGIN_EMAIL, password: pwdHash });
    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.multilogin.com', port: 443, path: '/user/signin', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 15000,
      }, (r) => {
        let d = ''; r.on('data', c => { d += c; }); r.on('end', () => resolve({ statusCode: r.statusCode, body: d }));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Signin timeout')); });
      req.on('error', reject);
      req.write(payload); req.end();
    });
    const parsed = JSON.parse(res.body);
    if (parsed?.data?.token) {
      _mlxSessionToken = parsed.data.token;
      _mlxSessionExpiry = Date.now() + 25 * 60 * 1000; // 25 min cache
      log('info', 'Multilogin session token obtained');
      return _mlxSessionToken;
    }
    log('warn', `Multilogin signin failed: ${parsed?.status?.message || res.body.slice(0, 100)}`);
    return MULTILOGIN_TOKEN; // fallback
  } catch (err) {
    log('warn', `Multilogin signin error: ${err.message} — using automation token`);
    return MULTILOGIN_TOKEN;
  }
}

function multiloginLauncherRequest(path, method = 'GET', timeoutMs = 30000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'launcher.mlx.yt',
      port: 45001,
      path,
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      rejectUnauthorized: false, // self-signed cert on launcher
      timeout: timeoutMs,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ httpCode: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ httpCode: res.statusCode, data: { raw: data } }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Multilogin launcher timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function extractCdpPort(data) {
  if (!data || typeof data !== 'object') return 0;
  const tryPort = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  let port = tryPort(data.port) || tryPort(data.cdp_port) || tryPort(data.cdpPort)
    || tryPort(data.debug_port) || tryPort(data.debugPort);
  if (data.automation && typeof data.automation === 'object') {
    port = port || tryPort(data.automation.port) || tryPort(data.automation.cdp_port);
  }
  const wsRaw = data.web_socket_url || data.webSocketDebuggerUrl || data.ws_endpoint || data.browser_wse;
  if (!port && typeof wsRaw === 'string') {
    const m = wsRaw.match(/:(\d+)/); if (m) port = parseInt(m[1], 10);
  }
  return port;
}

async function multiloginStartProfile(mlxProfileId) {
  if (!MULTILOGIN_FOLDER_ID) {
    log('error', 'MULTILOGIN_FOLDER_ID not set in .env');
    return null;
  }
  const startPath = `/api/v2/profile/f/${MULTILOGIN_FOLDER_ID}/p/${mlxProfileId}/start?automation_type=playwright`;
  log('info', 'Starting Multilogin profile via launcher...');
  try {
    const token = await getMultiloginSessionToken();
    const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};

    let res = await multiloginLauncherRequest(startPath, 'GET', 35000, authHeader);
    const port = extractCdpPort(res.data);
    if (port) {
      log('success', `Multilogin profile started. CDP port: ${port}`);
      return port;
    }

    // Already running — try status endpoint to get existing CDP port
    const errCode = res.data?.status?.error_code || '';
    const msg = (res.data?.status?.message || res.data?.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('running') || errCode === 'PROFILE_ALREADY_RUNNING' || errCode === 'PROFILE_ALREADY_STARTED') {
      log('info', 'Profile already running — checking status endpoint for CDP port...');
      try {
        const statusPath = `/api/v2/profile/f/${MULTILOGIN_FOLDER_ID}/p/${mlxProfileId}`;
        const statusRes = await multiloginLauncherRequest(statusPath, 'GET', 20000, authHeader);
        const statusPort = extractCdpPort(statusRes.data);
        if (statusPort) { log('success', `CDP port from status: ${statusPort}`); return statusPort; }
      } catch {}

      // Stop then restart
      log('info', 'Status endpoint gave no port — stopping and restarting profile...');
      await multiloginStopProfile(mlxProfileId);
      await sleep(4000);
      const retry = await multiloginLauncherRequest(startPath, 'GET', 35000, authHeader);
      const retryPort = extractCdpPort(retry.data);
      if (retryPort) { log('success', `CDP port after stop+restart: ${retryPort}`); return retryPort; }
    }

    log('error', `Multilogin launcher response [${res.httpCode}]: ${JSON.stringify(res.data).slice(0, 300)}`);
    return null;
  } catch (err) {
    log('error', `Multilogin launcher error: ${err.message}`);
    return null;
  }
}

async function multiloginStopProfile(mlxProfileId) {
  try {
    const token = await getMultiloginSessionToken();
    const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};
    await multiloginLauncherRequest(`/api/v1/profile/stop?profile_id=${mlxProfileId}`, 'GET', 15000, authHeader);
    log('info', 'Multilogin profile closed');
  } catch {
    log('warn', 'Could not close Multilogin profile');
  }
}

// Track analytics to backend
function trackAnalytics(action, value) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ profileId, action, value: value || 1 });
    const req = http.request({
      hostname: '127.0.0.1', port: 3200, path: '/api/analytics/track',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 3000,
    }, () => resolve());
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SITEMAP SYNC — Auto-fetch articles from XML sitemap
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      // Follow 1 redirect
      if (res.statusCode >= 301 && res.statusCode <= 302 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
  });
}

function parseXmlLocs(xml) {
  const locs = [];
  const regex = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    locs.push(m[1].trim());
  }
  return locs;
}

async function fetchSitemapArticles(siteUrl) {
  try {
    const base = siteUrl.replace(/\/$/, '');

    // Try WordPress built-in sitemap first (wp-sitemap.xml), then Yoast/RankMath style
    const indexUrls = [
      `${base}/wp-sitemap.xml`,
      `${base}/sitemap_index.xml`,
      `${base}/sitemap.xml`,
    ];

    let childSitemaps = [];
    for (const indexUrl of indexUrls) {
      log('info', `Trying sitemap: ${indexUrl}`);
      const xml = await httpGet(indexUrl).catch(() => null);
      if (!xml || xml.includes('<!DOCTYPE html')) continue; // skip HTML 404 responses
      childSitemaps = parseXmlLocs(xml).filter(u => u.endsWith('.xml'));
      if (childSitemaps.length > 0) { log('info', `Found ${childSitemaps.length} child sitemaps`); break; }
      // Maybe it's a flat sitemap (no children, has <loc> article URLs directly)
      const directUrls = parseXmlLocs(xml).filter(u => !u.endsWith('.xml'));
      if (directUrls.length > 0) {
        log('info', `Flat sitemap: ${directUrls.length} articles`);
        return directUrls;
      }
    }

    if (childSitemaps.length === 0) {
      log('warn', 'No sitemap found — using provided articles');
      return null;
    }

    // Prefer post sitemap (wp-sitemap-posts-post-1.xml or post-sitemap.xml)
    const postSitemap = childSitemaps.find(u => u.includes('posts-post') || u.includes('post-sitemap')) ||
                        childSitemaps.find(u => u.includes('post')) ||
                        childSitemaps.find(u => !u.includes('category') && !u.includes('tag') && !u.includes('page') && !u.includes('user')) ||
                        childSitemaps[0];

    if (!postSitemap) return null;
    log('info', `Fetching post sitemap: ${postSitemap}`);

    const postXml = await httpGet(postSitemap).catch(() => null);
    if (!postXml || postXml.includes('<!DOCTYPE html')) return null;

    const articleUrls = parseXmlLocs(postXml).filter(u => !u.endsWith('.xml'));
    log('info', `Sitemap sync: found ${articleUrls.length} articles`);
    return articleUrls;
  } catch (err) {
    log('warn', `Sitemap sync error: ${err.message}`);
    return null;
  }
}

// Convert raw article URLs into article objects (title derived from slug)
function urlToArticleObj(url, siteUrl) {
  try {
    const slug = new URL(url).pathname.replace(/\//g, '').replace(/-/g, ' ');
    const title = slug.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return { url, title, siteUrl };
  } catch {
    return { url, title: url, siteUrl };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ARTICLE PRIORITIZATION — Mesothelioma first
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function prioritizeArticles(articles, siteUrl) {
  const cfg = getSiteConfig(siteUrl);
  if (!cfg) return articles;

  const highPriorityKeywords = ['mesothelioma', 'asbestos', 'attorney', 'lawyer', 'settlement', 'lawsuit', 'compensation'];

  const scored = articles.map(a => {
    const urlLower = (a.url || '').toLowerCase();
    const titleLower = (a.title || '').toLowerCase();
    let score = 0;
    for (const kw of highPriorityKeywords) {
      if (urlLower.includes(kw) || titleLower.includes(kw)) score += 10;
    }
    // Extra score for known priority post IDs (extracted from URL if ?p=ID format)
    const idMatch = (a.url || '').match(/[?&]p=(\d+)/);
    if (idMatch && cfg.priorityPostIds.includes(parseInt(idMatch[1]))) score += 20;
    return { ...a, _score: score };
  });

  // Sort: high score first, then shuffle within same score tier for naturalness
  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return Math.random() - 0.5;
  });

  return scored.map(({ _score, ...a }) => a);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// US GEOGRAPHY ENFORCEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function enforceUSGeography(profileEnvId) {
  try {
    log('info', 'Checking MoreLogin profile geography...');
    // Try to update profile proxy country to US via MoreLogin API
    // MoreLogin API endpoint for updating environment settings
    const res = await moreloginRequest('/api/env/update', {
      envId: profileEnvId,
      proxy: {
        proxyType: 'http',
        country: 'US',
      }
    });
    if (res.code === 0) {
      log('success', 'US geography enforced on profile');
      return true;
    } else {
      log('warn', `Geo enforcement response: ${res.msg || JSON.stringify(res)} — proceeding anyway`);
      return false;
    }
  } catch (err) {
    log('warn', `Geo enforcement skipped: ${err.message}`);
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN RUN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function run() {
  const siteUrl = settings?.siteUrl || workerArticles?.[0]?.siteUrl || '';
  log('info', `Worker starting: profile ${profileId}, site: ${siteUrl || 'unknown'}`);

  // Step 0: Auto-sync articles from sitemap (if enabled and siteUrl set)
  let articles = [...(workerArticles || [])];
  if (settings?.autoSyncSitemap !== false && siteUrl) {
    const sitemapUrls = await fetchSitemapArticles(siteUrl);
    if (sitemapUrls && sitemapUrls.length > 0) {
      // Merge: sitemap URLs take priority, preserve any extra metadata from workerArticles
      const urlMap = new Map((workerArticles || []).map(a => [a.url, a]));
      const merged = sitemapUrls.map(url => urlMap.get(url) || urlToArticleObj(url, siteUrl));
      articles = merged;
      log('info', `Articles after sitemap sync: ${articles.length}`);
    }
  }

  // Step 0b: Prioritize Mesothelioma/high-value articles
  if (siteUrl) {
    articles = prioritizeArticles(articles, siteUrl);
    log('info', `Articles after prioritization: top 3 → ${articles.slice(0, 3).map(a => a.title || a.url).join(', ')}`);
  }

  if (articles.length === 0) {
    log('error', 'No articles to read — aborting');
    parentPort.postMessage({ type: 'done', articlesRead: 0 });
    return;
  }

  // Step 1: US geography enforcement (MoreLogin only — Multilogin proxy is pre-configured)
  const profileEnvId = envId || profileId;
  if (BROWSER_PROVIDER === 'morelogin') {
    await enforceUSGeography(profileEnvId);
  } else {
    log('info', `Using ${BROWSER_PROVIDER} — skipping MoreLogin geo enforcement`);
  }

  // Step 2: Get debug port (start profile if needed)
  let debugPort = settings?.multiloginPort || null;

  if (debugPort) {
    log('info', `Using pre-provided CDP port: ${debugPort}`);
  } else if (BROWSER_PROVIDER === 'multilogin') {
    debugPort = await multiloginStartProfile(String(profileId));
  } else {
    // MoreLogin flow
    try {
      const statusRes = await moreloginRequest('/api/env/status', { envId: profileEnvId });
      if (statusRes.code === 0 && statusRes.data?.status === 'running' && statusRes.data?.debugPort) {
        debugPort = statusRes.data.debugPort;
        log('info', `Profile already running. Debug port: ${debugPort}`);
      } else {
        log('info', 'Starting MoreLogin profile...');
        const startRes = await moreloginRequest('/api/env/start', { envId: profileEnvId });
        if (startRes.code === 0 && startRes.data?.debugPort) {
          debugPort = startRes.data.debugPort;
          log('success', `Profile started. Debug port: ${debugPort}`);
        } else {
          log('info', 'Waiting for profile to start...');
          await sleep(10000);
          const retry = await moreloginRequest('/api/env/status', { envId: profileEnvId });
          if (retry.code === 0 && retry.data?.debugPort) {
            debugPort = retry.data.debugPort;
            log('success', `Profile ready. Debug port: ${debugPort}`);
          }
        }
      }
    } catch (err) {
      log('error', `MoreLogin connection failed: ${err.message}`);
    }
  }

  if (!debugPort) {
    log('error', 'Could not get debug port — aborting session');
    parentPort.postMessage({ type: 'done', articlesRead: 0 });
    return;
  }

  // Step 3: Connect via CDP using ProfileAgent
  const agent = new ProfileAgent(profileId, `Worker-${profileId.toString().slice(-4)}`, debugPort, settings);
  const connected = await agent.connect();

  if (!connected) {
    log('error', 'CDP connection failed — aborting session');
    parentPort.postMessage({ type: 'done', articlesRead: 0 });
    return;
  }

  log('success', `CDP connected! Starting ${articles.length} articles...`);

  // Step 4: Read articles one by one
  let articlesRead = 0;
  const articleDelay = settings?.articleDelay || 30;
  const siteConfig = getSiteConfig(siteUrl);

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    log('info', `[${i + 1}/${articles.length}] "${article.title || article.url}"`);
    progress(i, articles.length, article.url);

    try {
      // Resolve category-based read times
      const catTimes = siteConfig ? getReadTimeByCategory(article.url, siteUrl) : null;
      const readTimeMin = catTimes ? catTimes.min : (settings?.readTimeMin || 30);
      const readTimeMax = catTimes ? catTimes.max : (settings?.readTimeMax || 300);

      if (catTimes) {
        log('info', `  Read time range: ${Math.round(readTimeMin/60)}-${Math.round(readTimeMax/60)} min (category-based)`);
      }

      const result = await agent.readArticle(article.url, article.title || article.url, {
        trafficPreference: settings?.trafficPreference || 'random',
        readTimeMin,
        readTimeMax,
        skipCategoryReadTime: false,  // agent.cjs will also do category detection — that's fine (redundant but harmless)
        scrollSpeed: settings?.scrollSpeed || 'medium',
        adPauseDurationMin: settings?.adPauseDurationMin || 0.5,
        adPauseDurationMax: settings?.adPauseDurationMax || 2,
        startDelayMin: settings?.startDelayMin || 5,
        startDelayMax: settings?.startDelayMax || 30,
        siteUrl: siteUrl || article.siteUrl || undefined,
        useNextPost: settings?.useNextPost !== false,
        multiPageSession: settings?.multiPageSession !== false,
        maxRelatedPages: settings?.maxRelatedPages || 3,
      });

      if (result) {
        articlesRead++;
        await trackAnalytics('read', 1);
        await trackAnalytics('dwellTime', result.dwellTime || 0);
        if (result.adHitCount > 0) await trackAnalytics('adViews', result.adHitCount);
        // Track traffic source — maps to trafficSources in analytics
        const src = result.trafficSource || 'direct';
        await trackAnalytics('traffic_' + src, 1);
        log('success', `Completed: "${article.title || article.url}" (${result.dwellTime || 0}s, ${src}, ${result.adHitCount || 0} ad pauses)`);
      } else {
        log('warn', `Failed: "${article.title || article.url}" — skipping`);
      }

      // Delay between articles
      if (i < articles.length - 1) {
        const delay = rand(Math.floor(articleDelay * 0.7), Math.floor(articleDelay * 1.3));
        log('info', `Waiting ${delay}s before next article...`);
        await sleep(delay * 1000);
      }
    } catch (err) {
      log('error', `Error on article ${i + 1}: ${err.message}`);
    }
  }

  // Step 5: Track session complete
  await trackAnalytics('session', 1);

  // Step 6: Disconnect agent
  await agent.disconnect();

  // Step 7: Close profile (free resources)
  if (BROWSER_PROVIDER === 'multilogin') {
    await multiloginStopProfile(String(profileId));
  } else {
    try {
      await moreloginRequest('/api/env/close', { envId: profileEnvId });
      log('info', 'MoreLogin profile closed');
    } catch {
      log('warn', 'Could not close MoreLogin profile');
    }
  }

  log('success', `Session complete: ${articlesRead}/${articles.length} articles read`);
  parentPort.postMessage({ type: 'done', articlesRead });
}

process.on('uncaughtException', (err) => {
  process.stderr.write(`[UNCAUGHT] ${err.stack || err.message}\n`);
  try { log('error', `Worker uncaught: ${err.message}\n${err.stack}`); } catch {}
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  process.stderr.write(`[UNHANDLED] ${msg}\n`);
  try { log('error', `Worker unhandled rejection: ${msg}`); } catch {}
  setTimeout(() => process.exit(1), 500);
});

run().catch(err => {
  process.stderr.write(`[RUN ERROR] ${err.stack || err.message}\n`);
  try { log('error', `Worker fatal error: ${err.stack || err.message}`); } catch {}
  process.exit(1);
});
