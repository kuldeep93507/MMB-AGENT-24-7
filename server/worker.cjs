/**
 * Worker Thread — Isolated process per profile
 *
 * Each worker:
 * - Receives profile data + video queue via parentPort
 * - Starts browser profile via provider (Multilogin / MoreLogin) from schedule config.browserType
 * - Connects Playwright CDP
 * - Watches assigned videos one by one
 * - Reports status back to main thread
 * - Crash isolation: if this worker dies, others continue
 */

const { parentPort, workerData } = require('worker_threads');
const { ProfileAgent } = require('./agent.cjs');
const { recoverProfile } = require('./profileRecovery.cjs');

// Load .env so worker thread picks up env vars (each thread has isolated module scope)
require('./providers/loadEnv.cjs')();

const { providerFactory } = require('./providers/ProviderFactory.cjs');

/** Must match orchestrator.normalizeScheduleBrowserProvider */
function normalizeScheduleBrowserProvider(raw) {
  const n = raw != null ? String(raw).trim().toLowerCase() : '';
  const mapped = n === 'adspower' ? 'multilogin' : n;
  const envRaw = process.env.BROWSER_PROVIDER ? String(process.env.BROWSER_PROVIDER).trim().toLowerCase() : '';
  const envBt = envRaw === 'adspower' ? 'multilogin' : envRaw;
  let bt = mapped || envBt || 'morelogin';
  if (bt !== 'morelogin' && bt !== 'multilogin') bt = 'morelogin';
  return bt;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEND STATUS TO MAIN THREAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function sendStatus(profileId, status, extra = {}) {
  if (parentPort) {
    parentPort.postMessage({ type: 'status', profileId, status, ...extra });
  }
}

function sendLog(profileId, level, message) {
  if (parentPort) {
    parentPort.postMessage({ type: 'log', profileId, level, message, time: new Date().toISOString() });
  }
  console.log(`[Worker:${profileId.slice(-4)}] [${level}] ${message}`);
}

function sendDone(profileId, results) {
  if (parentPort) {
    parentPort.postMessage({ type: 'done', profileId, results });
  }
}

function sendError(profileId, error) {
  if (parentPort) {
    parentPort.postMessage({ type: 'error', profileId, error });
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WORKER LOGIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let activeWorkerAgent = null;

async function runWorker(data) {
  let { profileId, profileName, videos, config, startDelay } = data;
  const browserType = normalizeScheduleBrowserProvider(config?.browserType);
  const providerLabel = browserType.toUpperCase();
  const results = { watched: 0, failed: 0, skipped: 0, videos: [] };

  sendLog(profileId, 'info', `Worker started for "${profileName}" — ${videos.length} videos queued`);
  sendLog(
    profileId,
    'info',
    `Profile settings: traffic=${config.trafficPreference || 'custom'}, watch=${config.watchTimeMin}-${config.watchTimeMax}%, quality=${config.videoQuality || 'auto'}, scroll=${config.scrollDuringWatch !== false}, adSkip=${config.adSkipEnabled !== false}${config.adSkipEnabled !== false ? `@${config.adSkipAfterSec}s` : ''}, like=${!!config.likeEnabled}, dislike=${!!config.dislikeEnabled}, comment=${!!config.commentEnabled}, subscribe=${!!config.subscribeEnabled}`,
  );
  sendStatus(profileId, 'waiting');

  // Wait for staggered start delay
  if (startDelay > 0) {
    sendLog(profileId, 'info', `Waiting ${Math.round(startDelay / 1000)}s before starting...`);
    await sleep(startDelay);
  }

  // Step 1: Start profile via provider (Multilogin / MoreLogin)
  sendStatus(profileId, 'starting');
  sendLog(profileId, 'info', `Starting profile via ${providerLabel}...`);

  let cdpPort = null;
  let cdpEndpoint = null;
  try {
    const provider = providerFactory.getProvider(browserType);
    let startRes = await provider.startProfile(profileId);

    if (startRes.code === 0 && startRes.data?.cdpPort) {
      cdpPort = startRes.data.cdpPort;
      cdpEndpoint = startRes.data.cdpEndpoint || null;
      sendLog(profileId, 'info', `Profile started! CDP port: ${cdpPort}`);
    } else {
      // Start may take time — wait and retry once
      sendLog(profileId, 'warn', `Start response: ${startRes.message || 'pending'} — waiting 10s...`);
      await sleep(10000);
      startRes = await provider.startProfile(profileId);
      if (startRes.code === 0 && startRes.data?.cdpPort) {
        cdpPort = startRes.data.cdpPort;
        cdpEndpoint = startRes.data.cdpEndpoint || null;
        sendLog(profileId, 'info', `Profile started (retry)! CDP port: ${cdpPort}`);
      } else {
        sendError(profileId, `Profile start failed: ${startRes.message || 'No CDP port returned'}`);
        return;
      }
    }
  } catch (err) {
    sendError(profileId, `Profile start failed: ${err.message}`);
    return;
  }

  if (!cdpPort) {
    sendError(profileId, 'No CDP port — cannot connect');
    return;
  }

  if (!videos || videos.length === 0) {
    sendError(profileId, 'No videos assigned to this profile — shuffle again or check channel config');
    try {
      const provider = providerFactory.getProvider(browserType);
      await provider.stopProfile(profileId).catch(() => {});
    } catch {}
    return;
  }

  // Step 2: Connect Playwright CDP (Multilogin needs warm-up time after window opens)
  sendStatus(profileId, 'connecting');
  if (browserType === 'multilogin') {
    sendLog(profileId, 'info', 'Waiting 6s for Multilogin browser CDP to become ready...');
    await sleep(6000);
  }
  const agent = new ProfileAgent(profileId, profileName, cdpPort, {
    cdpEndpoint,
    // Forward agent internal logs → main thread → frontend UI
    onLog: (level, message) => sendLog(profileId, level, message),
    onRecoverProfile: async ({ profileId: pid, strategy, profileName: pname }) => {
      sendLog(pid, 'warn', `YouTube block detected — running recovery: ${strategy}`);
      const res = await recoverProfile({
        browserType,
        profileId: pid,
        profileName: pname || profileName,
        strategy,
        log: (level, message) => sendLog(pid, level, message),
      });
      if (res.profileId && res.profileId !== pid) {
        sendLog(pid, 'info', `Use new profile ID in app: ${res.profileId}`);
        if (parentPort) {
          parentPort.postMessage({
            type: 'profile_rebinding',
            oldProfileId: pid,
            profileId: res.profileId,
          });
        }
        profileId = res.profileId;
      }
      if (res.cdpPort) {
        cdpPort = res.cdpPort;
      }
      return res;
    },
  });
  activeWorkerAgent = agent;
  const connected = browserType === 'multilogin'
    ? await agent.connectWithRetry(12, 4000)
    : await agent.connect();

  if (!connected) {
    sendError(profileId, 'CDP connection failed — browser may be open but automation did not attach. Close profile in Multilogin and retry.');
    try {
      const provider = providerFactory.getProvider(browserType);
      await provider.stopProfile(profileId).catch(() => {});
    } catch {}
    return;
  }

  sendStatus(profileId, 'running');

  if (parentPort) {
    try {
      const { loadAutoArrangeSetting } = require('./services/windowArranger.cjs');
      if (loadAutoArrangeSetting()) {
        parentPort.postMessage({ type: 'window_connected', profileId, cdpPort });
      }
    } catch { /* ignore */ }
  }

  // Step 3: Watch videos one by one
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    sendStatus(profileId, 'watching', { currentVideo: video.title || video.value, progress: `${i + 1}/${videos.length}` });
    sendLog(profileId, 'info', `Video ${i + 1}/${videos.length}: "${video.title || video.value}"`);

    const videoUrl = video.url || (video.mode === 'url' ? video.value : '');
    const videoTitle = video.title || (video.mode === 'title' ? video.value : '') || video.value;
    const videoId = video.videoId || (() => {
      const u = videoUrl || (video.mode === 'url' ? video.value : '');
      const m = String(u).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      return m ? m[1] : '';
    })();

    let success = false;
    try {
      const targetYoutubeUrl = video.targetYoutubeUrl || video.youtubeUrl || videoUrl || '';
      const watchConfig = {
        ...config,
        videoUrl: targetYoutubeUrl || config.videoUrl || '',
        channelName: video.channelName || config.channelName || '',
        expectedTitle: videoTitle,
        videoId,
      };

      const isBacklinkVideo = video.mode === 'backlink' || !!video.backlink?.sourceUrl;
      if (isBacklinkVideo) {
        watchConfig.backlinkData = video.backlink || {};
        watchConfig.trafficPreference = 'backlink';
        sendLog(profileId, 'info', `Backlink traffic: ${watchConfig.backlinkData.sourceUrl || '—'}`);
        success = await agent.searchAndWatch(videoTitle, video.channelName || '', watchConfig);
        if (success && video.backlink?.id && parentPort) {
          parentPort.postMessage({ type: 'backlink_used', backlinkId: video.backlink.id });
        }
      } else {
        // Traffic routing:
        // - 'direct' preference → watchByUrl (no search)
        // - else → searchAndWatch (smart search / custom mix)
        const trafficPref = (config.trafficPreference || 'custom').toLowerCase();
        if (trafficPref === 'direct' && watchConfig.videoUrl) {
          success = await agent.watchByUrl(watchConfig.videoUrl, watchConfig);
        } else {
          success = await agent.searchAndWatch(videoTitle, video.channelName || '', watchConfig);
        }
      }
    } catch (err) {
      sendLog(profileId, 'error', `Video failed: ${err.message}`);
      
      // If context is dead, restart the browser first then reconnect CDP
      if (err.message && (err.message.includes('Target closed') || err.message.includes('Session closed') || err.message.includes('Connection closed'))) {
        sendLog(profileId, 'warn', 'Browser connection lost — restarting browser and reconnecting...');
        try {
          // 1. Disconnect Playwright cleanly
          await agent.disconnect().catch(() => {});

          // 2. Stop the dead browser via provider (ignore error if already gone)
          const restartProvider = providerFactory.getProvider(browserType);
          await restartProvider.stopProfile(profileId).catch(() => {});
          await sleep(3000);

          // 3. Start a fresh browser instance via provider
          sendLog(profileId, 'info', 'Restarting browser profile...');
          const restartRes = await restartProvider.startProfile(profileId);
          if (restartRes.code === 0 && restartRes.data?.cdpPort) {
            // 4. Update the agent's CDP port and reconnect
            agent.debugPort = restartRes.data.cdpPort;
            agent.cdpEndpoint = restartRes.data.cdpEndpoint || `http://127.0.0.1:${restartRes.data.cdpPort}`;
            await sleep(browserType === 'multilogin' ? 6000 : 2000);
            const reconnected = browserType === 'multilogin'
              ? await agent.connectWithRetry(8, 4000)
              : await agent.connect();
            if (reconnected) {
              sendLog(profileId, 'success', `Browser restarted & reconnected on port ${agent.debugPort}! Continuing with next video...`);
            } else {
              sendLog(profileId, 'error', 'Reconnect failed after browser restart — stopping worker');
              break;
            }
          } else {
            sendLog(profileId, 'error', `Browser restart failed: ${restartRes.message || 'No CDP port'} — stopping worker`);
            break;
          }
        } catch (reconnectErr) {
          sendLog(profileId, 'error', `Reconnect error: ${reconnectErr.message}`);
          break;
        }
      }
    }

    if (success) {
      results.watched++;
      results.videos.push({
        title: video.title || video.value,
        videoId,
        status: 'watched',
      });
      if (parentPort) {
        parentPort.postMessage({ type: 'video_done', profileId, videoIndex: i });
      }
      sendLog(profileId, 'success', `✓ Watched: "${video.title || video.value}"`);
    } else {
      results.failed++;
      results.videos.push({ title: video.title || video.value, status: 'failed' });
      sendLog(profileId, 'error', `✗ Failed: "${video.title || video.value}"`);
    }

    // Delay between videos — real human takes 30s-2min break
    if (i < videos.length - 1) {
      const tabDelay = randomDelay((config.tabDelayMin || 30) * 1000, (config.tabDelayMax || 120) * 1000);
      sendLog(profileId, 'info', `Waiting ${Math.round(tabDelay / 1000)}s before next video...`);
      await sleep(tabDelay);
    }
  }

  // Step 4: Done — wait 10s, stop Multilogin profile, then disconnect Playwright
  const closePort = agent?.debugPort || cdpPort;
  sendLog(profileId, 'info', 'All videos done — closing browser in 10 seconds...');
  await sleep(10000);

  activeWorkerAgent = null;
  let closed = false;
  try {
    const provider = providerFactory.getProvider(browserType);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const stopRes = await provider.stopProfile(profileId, { cdpPort: closePort });
      if (stopRes && stopRes.code === 0) {
        sendLog(profileId, 'success', `${providerLabel} browser closed ✓`);
        closed = true;
        break;
      }
      if (attempt < 5) {
        sendLog(profileId, 'warn', `Close attempt ${attempt}/5 failed (${stopRes?.message || 'unknown'}) — retrying...`);
        await sleep(3000);
      }
    }
    if (!closed) {
      sendLog(profileId, 'error', 'Could not close browser — please close profile manually in Multilogin');
    }
  } catch (err) {
    sendLog(profileId, 'warn', `Could not close browser: ${err.message}`);
  }

  try {
    await agent.disconnect();
  } catch (err) {
    sendLog(profileId, 'warn', `Disconnect error (non-critical): ${err.message}`);
  }
  
  sendStatus(profileId, 'done');
  sendLog(profileId, 'success', `✅ Worker done! Watched: ${results.watched}, Failed: ${results.failed}`);
  sendDone(profileId, results);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LISTEN FOR MESSAGES FROM MAIN THREAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if (parentPort) {
  parentPort.on('message', async (msg) => {
    if (msg.type === 'start') {
      try {
        await runWorker(msg);
      } catch (err) {
        sendError(msg.profileId, `Worker crash: ${err.message}`);
      }
    }
    if (msg.type === 'stop') {
      const stopProfileId = msg.profileId || 'unknown';
      const bt = normalizeScheduleBrowserProvider(msg.browserType);
      sendLog(stopProfileId, 'info', 'Worker received stop signal — cleaning up...');
      try {
        if (activeWorkerAgent) {
          await activeWorkerAgent.disconnect().catch((err) => {
            sendLog(stopProfileId, 'warn', `Disconnect on stop: ${err.message}`);
          });
          activeWorkerAgent = null;
        }
        const stopProvider = providerFactory.getProvider(bt);
        await stopProvider.stopProfile(stopProfileId, { cdpPort: msg.cdpPort }).catch((err) => {
          sendLog(stopProfileId, 'warn', `Stop profile on stop signal: ${err.message}`);
        });
      } catch (err) {
        sendLog(stopProfileId, 'warn', `Stop cleanup error: ${err.message}`);
      }
      process.exit(0);
    }
  });
} else {
  // Running directly (for testing)
  if (workerData) {
    runWorker(workerData).catch(err => {
      console.error('Worker error:', err);
      process.exit(1);
    });
  }
}
