'use strict';

/**
 * AgentManager — Manages MMB AGENT lifecycle using child_process.fork()
 *
 * Each agent = isolated child process (NOT worker_threads)
 * Benefits: own memory, Playwright safe, crash isolation
 *
 * Naming: MMB AGENT 01, MMB AGENT 02... (dynamic, based on slot)
 * Launch gap: 7-10 seconds between each agent start
 * Cooldown: 60 seconds after session complete before rebirth
 * Rebirth: auto create new profile + restart cycle (24/7)
 */

const { fork } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const { ProfileFactory } = require('./profileFactory.cjs');

const WORKER_PATH = path.join(__dirname, 'agentWorker.cjs');
const LAUNCH_GAP_MIN = 7000;   // ms
const LAUNCH_GAP_MAX = 10000;  // ms
const COOLDOWN_MS = 60000;     // 1 minute rest between cycles
const MAX_CREATE_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function padNum(n) { return String(n).padStart(2, '0'); }

class AgentManager extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map();     // agentId → AgentState
    this.factory = new ProfileFactory();
    this.logs = [];
    this.maxLogs = 1000;
    this.autoRebirth = true;     // 24/7 mode — restart after cooldown
    this._slotCounter = 0;
    this._launchQueue = Promise.resolve(); // Sequential launch queue
  }

  // ──────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────

  /**
   * Start N agents with given article sets
   * @param {Array<{articles: string[], settings: object}>} agentConfigs
   */
  async startAgents(agentConfigs) {
    for (let i = 0; i < agentConfigs.length; i++) {
      const cfg = agentConfigs[i];
      const agentId = `agent_${Date.now()}_${i}`;
      const slotNum = ++this._slotCounter;
      const agentName = `MMB AGENT ${padNum(slotNum)}`;

      // Chain launches sequentially with gap — no parallel launches
      this._launchQueue = this._launchQueue.then(async () => {
        if (i > 0) {
          const gap = randomDelay(LAUNCH_GAP_MIN, LAUNCH_GAP_MAX);
          this._log('info', `Waiting ${Math.round(gap / 1000)}s before launching ${agentName}...`);
          await sleep(gap);
        }
        await this._startAgent(agentId, agentName, cfg.articles, cfg.settings);
      });
    }
    return this._launchQueue;
  }

  /**
   * Start agent on an EXISTING Multilogin profile (no auto-create)
   * Used for legacy API compat — manual profile starts from UI
   * @param {string} profileId - existing Multilogin profile UUID
   * @param {Array} articles
   * @param {object} settings
   */
  async startExistingProfileAgent(profileId, articles, settings) {
    const agentId = `manual_${profileId}`;
    const slotNum = ++this._slotCounter;
    const agentName = `MMB AGENT ${padNum(slotNum)}`;

    const state = {
      agentId,
      agentName,
      status: 'starting',
      profileId,
      cdpPort: null,
      articlesRead: 0,
      totalArticles: articles.length,
      currentUrl: '',
      startedAt: Date.now(),
      cycle: 1,
      cooldownUntil: null,
      autoRebirth: false, // manual starts don't rebirth
      articles,
      settings,
      process: null,
    };
    this.agents.set(agentId, state);

    // Start the profile via provider to get CDP port
    this._log('info', `${agentName} — starting existing profile ${profileId}...`);

    try {
      const startResult = await this.factory.provider.startProfile(profileId);
      if (startResult.code !== 0 || !startResult.data?.cdpPort) {
        throw new Error(`Profile start failed: ${startResult.message}`);
      }

      state.cdpPort = startResult.data.cdpPort;
      state.status = 'running';

      await this._forkWorker(agentId, {
        profileId,
        cdpPort: startResult.data.cdpPort,
        cdpEndpoint: startResult.data.cdpEndpoint,
      });
    } catch (err) {
      state.status = 'error';
      this._log('error', `${agentName} — failed: ${err.message}`);
      this.emit('agentError', agentId, err.message);
    }
  }

  /**
   * Stop a single agent by agentId
   */
  async stopAgent(agentId) {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.autoRebirth = false;
    state.status = 'stopping';

    if (state.process && !state.process.killed) {
      state.process.kill('SIGTERM');
      await sleep(3000);
      if (!state.process.killed) state.process.kill('SIGKILL');
    }

    // Stop + delete the profile
    if (state.profileId) {
      this._log('info', `${state.agentName} — stopping browser + deleting profile...`);
      await this.factory.stopAndDelete(state.profileId).catch(() => {});
    }

    state.status = 'stopped';
    this._log('info', `${state.agentName} stopped`);
    this.emit('agentStopped', agentId);
  }

  /**
   * Stop all agents
   */
  async stopAll() {
    this.autoRebirth = false;
    const promises = [];
    for (const [agentId] of this.agents) {
      promises.push(this.stopAgent(agentId));
    }
    await Promise.allSettled(promises);
    this._log('info', 'All agents stopped');
  }

  /**
   * Get real-time status of all agents
   */
  getStatus() {
    const result = {};
    for (const [agentId, state] of this.agents) {
      result[agentId] = {
        agentId,
        agentName: state.agentName,
        status: state.status,
        profileId: state.profileId,
        cdpPort: state.cdpPort,
        articlesRead: state.articlesRead,
        totalArticles: state.totalArticles,
        currentUrl: state.currentUrl,
        startedAt: state.startedAt,
        cycle: state.cycle,
        cooldownUntil: state.cooldownUntil,
      };
    }
    return result;
  }

  getLogs() { return [...this.logs]; }

  // ──────────────────────────────────────────
  // INTERNAL — AGENT LIFECYCLE
  // ──────────────────────────────────────────

  async _startAgent(agentId, agentName, articles, settings) {
    // Init state
    const state = {
      agentId,
      agentName,
      status: 'creating',
      profileId: null,
      cdpPort: null,
      articlesRead: 0,
      totalArticles: articles.length,
      currentUrl: '',
      startedAt: Date.now(),
      cycle: (this.agents.get(agentId)?.cycle || 0) + 1,
      cooldownUntil: null,
      autoRebirth: this.autoRebirth,
      articles,
      settings,
      process: null,
    };
    this.agents.set(agentId, state);
    this.emit('agentStatus', agentId, state);

    // Create profile
    let profileData = null;
    for (let attempt = 1; attempt <= MAX_CREATE_RETRIES; attempt++) {
      try {
        this._log('info', `${agentName} — creating profile (attempt ${attempt}/${MAX_CREATE_RETRIES})...`);
        profileData = await this.factory.createAndStart(agentName);
        break;
      } catch (err) {
        this._log('error', `${agentName} — profile create failed: ${err.message}`);
        if (attempt < MAX_CREATE_RETRIES) await sleep(5000);
      }
    }

    if (!profileData) {
      state.status = 'error';
      this._log('error', `${agentName} — could not create profile after ${MAX_CREATE_RETRIES} attempts`);
      this.emit('agentError', agentId, 'Profile creation failed');
      return;
    }

    state.profileId = profileData.profileId;
    state.cdpPort = profileData.cdpPort;
    state.status = 'running';
    this._log('info', `${agentName} — profile ready (CDP:${profileData.cdpPort}), launching worker...`);

    // Fork child process
    await this._forkWorker(agentId, profileData);
  }

  async _forkWorker(agentId, profileData) {
    const state = this.agents.get(agentId);
    if (!state) return;

    const { agentName, articles, settings } = state;

    // Build env vars to pass to worker
    const envVars = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      MULTILOGIN_TOKEN: process.env.MULTILOGIN_TOKEN || '',
      MULTILOGIN_FOLDER_ID: process.env.MULTILOGIN_FOLDER_ID || '',
      PROXY_SERVER: process.env.PROXY_SERVER || '',
      PROXY_PORT: process.env.PROXY_PORT || '',
      PROXY_PREFIX: process.env.PROXY_PREFIX || '',
      PROXY_PASSWORD: process.env.PROXY_PASSWORD || '',
    };

    const child = fork(WORKER_PATH, [], {
      env: { ...process.env, ...envVars },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    state.process = child;

    child.on('message', (msg) => this._handleWorkerMessage(agentId, msg));

    child.stdout?.on('data', (d) => {
      const txt = d.toString().trim();
      if (txt) this._log('info', `[${agentName}] ${txt}`);
    });

    child.stderr?.on('data', (d) => {
      const txt = d.toString().trim();
      if (txt) this._log('error', `[${agentName}] STDERR: ${txt}`);
    });

    child.on('exit', (code) => {
      this._log('info', `${agentName} process exited (code ${code})`);
      const s = this.agents.get(agentId);
      if (s && s.status === 'running') {
        s.status = 'error';
        this._handleAgentComplete(agentId);
      }
    });

    child.on('error', (err) => {
      this._log('error', `${agentName} process error: ${err.message}`);
    });

    // Send start message to worker
    child.send({
      type: 'start',
      agentId,
      agentName,
      profileId: profileData.profileId,
      cdpPort: profileData.cdpPort,
      cdpEndpoint: profileData.cdpEndpoint,
      articles,
      settings,
      envVars,
    });
  }

  _handleWorkerMessage(agentId, msg) {
    const state = this.agents.get(agentId);
    if (!state) return;

    switch (msg.type) {
      case 'ready':
        this._log('info', `${state.agentName} worker ready`);
        break;

      case 'log':
        this._log(msg.level || 'info', `[${state.agentName}] ${msg.message}`);
        break;

      case 'progress':
        state.articlesRead = msg.articleIndex + 1;
        state.totalArticles = msg.totalArticles;
        state.currentUrl = msg.url || '';
        this.emit('agentProgress', agentId, state);
        break;

      case 'done':
        state.articlesRead = msg.articlesRead || state.articlesRead;
        state.status = 'completed';
        this._log('success', `${state.agentName} — session complete (${state.articlesRead} articles)`);
        this.emit('agentDone', agentId, msg);
        this._handleAgentComplete(agentId);
        break;

      case 'error':
        state.status = 'error';
        this._log('error', `${state.agentName} — error: ${msg.error}`);
        this.emit('agentError', agentId, msg.error);
        this._handleAgentComplete(agentId);
        break;
    }

    this.emit('agentStatus', agentId, state);
  }

  async _handleAgentComplete(agentId) {
    const state = this.agents.get(agentId);
    if (!state) return;

    // Stop + delete profile (browser already closed by agent)
    if (state.profileId) {
      this._log('info', `${state.agentName} — deleting profile ${state.profileId}...`);
      await this.factory.stopAndDelete(state.profileId).catch((err) => {
        this._log('warn', `${state.agentName} — profile delete warning: ${err.message}`);
      });
      state.profileId = null;
    }

    // Check if auto-rebirth is enabled
    if (!state.autoRebirth) {
      state.status = 'stopped';
      this._log('info', `${state.agentName} — auto-rebirth disabled, stopping`);
      return;
    }

    // Cooldown phase
    state.status = 'cooldown';
    state.cooldownUntil = Date.now() + COOLDOWN_MS;
    this._log('info', `${state.agentName} — cooldown started (${COOLDOWN_MS / 1000}s)`);
    this.emit('agentStatus', agentId, state);

    await sleep(COOLDOWN_MS);

    // Rebirth — fresh start
    state.cooldownUntil = null;
    this._log('info', `${state.agentName} — reborn! Starting fresh cycle ${state.cycle + 1}...`);
    this.emit('agentRebirth', agentId);

    await this._startAgent(agentId, state.agentName, state.articles, state.settings);
  }

  _log(level, message) {
    const entry = { level, message, ts: Date.now() };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) this.logs.pop();
    console.log(`[AgentMgr:${level.toUpperCase()}] ${message}`);
    this.emit('log', entry);
  }
}

// Singleton export
const agentManager = new AgentManager();
module.exports = { AgentManager, agentManager };
