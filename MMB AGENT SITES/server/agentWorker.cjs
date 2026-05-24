'use strict';

/**
 * agentWorker.cjs — Isolated child process per MMB Agent
 *
 * Spawned via child_process.fork() from agentManager.cjs
 * Each worker has own memory, own Playwright, own AIBrain
 * 1 crash here = only this process dies, backend stays alive
 *
 * IPC Receive: { type: 'start', agentId, agentName, profileId, cdpPort, articles, settings, envVars }
 * IPC Send:    { type: 'ready' | 'log' | 'progress' | 'done' | 'error', ... }
 */

// Load .env
require('../../server/providers/loadEnv.cjs')();

function ipc(msg) {
  if (process.send) process.send(msg);
}

function log(level, message) {
  ipc({ type: 'log', level, message, ts: Date.now() });
  console.log(`[${level.toUpperCase()}] ${message}`);
}

process.on('message', async (msg) => {
  if (msg.type !== 'start') return;

  const { agentId, agentName, profileId, cdpPort, articles, settings, envVars } = msg;

  // Apply env vars sent from parent
  if (envVars) {
    for (const [k, v] of Object.entries(envVars)) {
      if (v) process.env[k] = v;
    }
  }

  log('info', `${agentName} worker started — ${articles.length} articles on CDP:${cdpPort}`);

  let agent = null;

  try {
    const { ProfileAgent } = require('./agent.cjs');

    // Create agent instance (profileId, profileName, debugPort, options)
    agent = new ProfileAgent(profileId, agentName, cdpPort, settings || {});

    // Inject progress callback
    agent._onProgressCallback = (articleIndex, totalArticles, url) => {
      ipc({ type: 'progress', agentId, agentName, articleIndex, totalArticles, url, ts: Date.now() });
    };

    // Step 1: Connect via CDP
    log('info', `${agentName} — connecting CDP port ${cdpPort}...`);
    const connected = await agent.connect();

    if (!connected) {
      throw new Error(`CDP connection failed on port ${cdpPort}`);
    }

    log('info', `${agentName} — connected! Running session...`);

    // Step 2: Run session
    const config = {
      siteUrl: settings?.siteUrl || 'https://hamstercombocard.com',
      trafficPreference: settings?.trafficPreference || 'random',
      useNextPost: true,
      multiPageSession: true,
      readTimeMin: settings?.readTimeMin || 60,
      readTimeMax: settings?.readTimeMax || 180,
      scrollSpeed: settings?.scrollSpeed || 'normal',
      adPauseDurationMin: 0.5,
      adPauseDurationMax: 2.5,
      adClickEnabled: settings?.adClickEnabled || false,
      articleDelay: settings?.articleDelay || 30,
    };

    await agent.runSession(articles, config);

    log('info', `${agentName} — session complete (${agent.articlesRead} articles, ${agent.totalDwellTime}s dwell)`);

    // Step 3: Disconnect browser before profile deletion
    await agent.disconnect();

    ipc({
      type: 'done',
      agentId,
      agentName,
      profileId,
      articlesRead: agent.articlesRead,
      dwellTime: agent.totalDwellTime,
      ts: Date.now(),
    });

  } catch (err) {
    log('error', `${agentName} fatal error: ${err.message}`);

    // Try to disconnect cleanly
    if (agent) await agent.disconnect().catch(() => {});

    ipc({
      type: 'error',
      agentId,
      agentName,
      profileId,
      error: err.message,
      ts: Date.now(),
    });
  } finally {
    process.exit(0);
  }
});

process.on('uncaughtException', (err) => {
  ipc({ type: 'error', error: `Uncaught: ${err.message}`, ts: Date.now() });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  ipc({ type: 'error', error: `Unhandled: ${String(reason)}`, ts: Date.now() });
  process.exit(1);
});

// Worker ready
ipc({ type: 'ready' });
