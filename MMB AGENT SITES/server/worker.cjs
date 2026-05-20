const { parentPort, workerData } = require('worker_threads');
const { ProfileAgent } = require('./agent.cjs');
const http = require('http');

/**
 * Sites Worker — REAL browser automation via Playwright CDP
 * 
 * Flow:
 * 1. Get debugPort from MoreLogin (start profile if needed)
 * 2. Connect to browser via CDP (ProfileAgent)
 * 3. For each article: traffic route → navigate → butter scroll → dwell
 * 4. Track analytics
 * 5. Close profile when done
 */

const { profileId, envId, articles, settings } = workerData;

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
// MORELOGIN API — Start/Stop/Status
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
        catch { resolve({ code: -1, msg: 'Invalid JSON' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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
// MAIN RUN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function run() {
  log('info', `Worker starting: ${articles.length} articles for profile ${profileId}`);

  // Step 1: Get debug port (start profile if needed)
  let debugPort = null;

  try {
    // Check if already running
    const statusRes = await moreloginRequest('/api/env/status', { envId: profileId });
    if (statusRes.code === 0 && statusRes.data?.status === 'running' && statusRes.data?.debugPort) {
      debugPort = statusRes.data.debugPort;
      log('info', `Profile already running. Debug port: ${debugPort}`);
    } else {
      // Start profile
      log('info', 'Starting MoreLogin profile...');
      const startRes = await moreloginRequest('/api/env/start', { envId: profileId });
      if (startRes.code === 0 && startRes.data?.debugPort) {
        debugPort = startRes.data.debugPort;
        log('success', `Profile started. Debug port: ${debugPort}`);
      } else {
        // Wait and retry status
        log('info', 'Waiting for profile to start...');
        await sleep(10000);
        const retry = await moreloginRequest('/api/env/status', { envId: profileId });
        if (retry.code === 0 && retry.data?.debugPort) {
          debugPort = retry.data.debugPort;
          log('success', `Profile ready. Debug port: ${debugPort}`);
        }
      }
    }
  } catch (err) {
    log('error', `MoreLogin connection failed: ${err.message}`);
  }

  if (!debugPort) {
    log('error', 'Could not get debug port — aborting session');
    parentPort.postMessage({ type: 'done', articlesRead: 0 });
    return;
  }

  // Step 2: Connect via CDP using ProfileAgent
  const agent = new ProfileAgent(profileId, `Worker-${profileId.slice(-4)}`, debugPort, settings);
  const connected = await agent.connect();

  if (!connected) {
    log('error', 'CDP connection failed — aborting session');
    parentPort.postMessage({ type: 'done', articlesRead: 0 });
    return;
  }

  log('success', `CDP connected! Starting ${articles.length} articles...`);

  // Step 3: Read articles one by one
  let articlesRead = 0;
  const articleDelay = settings?.articleDelay || 30;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    log('info', `[${i + 1}/${articles.length}] "${article.title}"`);
    progress(i, articles.length, article.url);

    try {
      const result = await agent.readArticle(article.url, article.title, {
        trafficPreference: settings?.trafficPreference || 'random',
        readTimeMin: settings?.readTimeMin || 30,
        readTimeMax: settings?.readTimeMax || 300,
        scrollSpeed: settings?.scrollSpeed || 'medium',
        adPauseDurationMin: settings?.adPauseDurationMin || 0.5,
        adPauseDurationMax: settings?.adPauseDurationMax || 2,
        startDelayMin: settings?.startDelayMin || 5,
        startDelayMax: settings?.startDelayMax || 30,
        siteUrl: article.siteUrl || undefined,
      });

      if (result) {
        articlesRead++;
        // Track analytics
        await trackAnalytics('read', 1);
        await trackAnalytics('dwellTime', result.dwellTime || 0);
        log('success', `Completed: "${article.title}" (${result.dwellTime || 0}s dwell, ${result.trafficSource})`);
      } else {
        log('warn', `Failed: "${article.title}" — skipping`);
      }

      // Delay between articles (staggered)
      if (i < articles.length - 1) {
        const delay = rand(Math.floor(articleDelay * 0.7), Math.floor(articleDelay * 1.3));
        log('info', `Waiting ${delay}s before next article...`);
        await sleep(delay * 1000);
      }
    } catch (err) {
      log('error', `Error on article ${i + 1}: ${err.message}`);
      // Continue to next article
    }
  }

  // Step 4: Track session complete
  await trackAnalytics('session', 1);

  // Step 5: Disconnect agent
  await agent.disconnect();

  // Step 6: Close MoreLogin profile (free resources)
  try {
    await moreloginRequest('/api/env/close', { envId: profileId });
    log('info', 'MoreLogin profile closed');
  } catch {
    log('warn', 'Could not close MoreLogin profile');
  }

  log('success', `Session complete: ${articlesRead}/${articles.length} articles read`);
  parentPort.postMessage({ type: 'done', articlesRead });
}

run().catch(err => {
  log('error', `Worker fatal error: ${err.message}`);
  process.exit(1);
});
