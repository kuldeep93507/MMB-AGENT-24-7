'use strict';

/**
 * Orchestrator v2 — Master AI Controller
 *
 * Replaces v1 Worker-thread based orchestrator.
 * Now uses AgentManager (child_process.fork) for true isolation.
 *
 * Responsibilities:
 *  - Receive start commands from index.cjs API
 *  - Assign agent names + articles (overlap minimize)
 *  - Delegate to AgentManager for lifecycle
 *  - Collect + expose logs for dashboard
 *  - Health + status aggregation
 */

const EventEmitter = require('events');
const { agentManager } = require('./agentManager.cjs');

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.maxLogs = 1000;
    this._articlesInUse = new Map(); // articleUrl → Set of agentIds currently using it

    // Forward all agent events to orchestrator logs
    agentManager.on('log', (entry) => this._addLog(entry.level, entry.message));
    agentManager.on('agentStatus', (agentId, state) => this.emit('agentStatus', agentId, state));
    agentManager.on('agentDone', (agentId, data) => this.emit('agentDone', agentId, data));
    agentManager.on('agentError', (agentId, err) => {
      this._addLog('error', `Agent ${agentId} error: ${err}`);
      this.emit('agentError', agentId, err);
    });
    agentManager.on('agentRebirth', (agentId) => {
      this._addLog('info', `Agent ${agentId} reborn — fresh cycle starting`);
      this.emit('agentRebirth', agentId);
    });
  }

  // ──────────────────────────────────────────
  // START — used by /start API
  // ──────────────────────────────────────────

  /**
   * Start a single agent (legacy API compat + new v2)
   * @param {string} profileId - existing Multilogin profile UUID
   * @param {string} envId - same as profileId for Multilogin
   * @param {Array} articles - list of {url, title, siteUrl}
   * @param {object} settings - user settings
   */
  startWorker(profileId, envId, articles, settings) {
    this._addLog('info', `Starting worker for profile ${profileId} (${articles.length} articles)`);

    // Use agentManager with existing profile (no auto-create for manual starts)
    agentManager.startExistingProfileAgent(profileId, articles, settings);
  }

  /**
   * Start N auto-managed agents (v2 — auto create/delete profiles)
   * @param {number} count - number of agents to launch
   * @param {Array} articlePool - available articles
   * @param {object} settings - user settings
   * @param {object} options - { minArticles, maxArticles, autoRebirth }
   */
  async startAutoAgents(count, articlePool, settings, options = {}) {
    const { minArticles = 4, maxArticles = 9, autoRebirth = true } = options;

    agentManager.autoRebirth = autoRebirth;

    this._addLog('info', `Starting ${count} auto agents (${minArticles}-${maxArticles} articles each)`);

    // Distribute articles — minimize overlap
    const agentConfigs = this._distributeArticles(count, articlePool, minArticles, maxArticles, settings);

    await agentManager.startAgents(agentConfigs);

    this._addLog('info', `${count} agents queued with staggered 7-10s launch gaps`);
  }

  /**
   * Distribute articles across agents — minimize overlap, unique order per agent
   */
  _distributeArticles(count, articlePool, minArticles, maxArticles, settings) {
    const configs = [];
    const pool = [...articlePool];

    for (let i = 0; i < count; i++) {
      // Random count in range
      const articleCount = minArticles + Math.floor(Math.random() * (maxArticles - minArticles + 1));

      // Try to give unique articles
      let agentArticles = [];

      if (pool.length >= articleCount) {
        // Shuffle and take from pool
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        agentArticles = shuffled.slice(0, articleCount);
      } else {
        // Not enough unique articles — repeat but shuffle order
        const full = [];
        while (full.length < articleCount) {
          full.push(...[...pool].sort(() => Math.random() - 0.5));
        }
        agentArticles = full.slice(0, articleCount);
      }

      configs.push({
        articles: agentArticles,
        settings: {
          ...settings,
          siteUrl: agentArticles[0]?.siteUrl || settings?.siteUrl || 'https://hamstercombocard.com',
        },
      });
    }

    return configs;
  }

  // ──────────────────────────────────────────
  // STOP
  // ──────────────────────────────────────────

  stopWorker(profileId) {
    // Find agent by profileId
    const status = agentManager.getStatus();
    for (const [agentId, state] of Object.entries(status)) {
      if (state.profileId === profileId) {
        agentManager.stopAgent(agentId).catch(() => {});
        this._addLog('info', `Stopped agent for profile ${profileId}`);
        return;
      }
    }
    this._addLog('warn', `No running agent found for profile ${profileId}`);
  }

  stopAll() {
    agentManager.stopAll().catch(() => {});
    this._addLog('info', 'All agents stop requested');
  }

  // ──────────────────────────────────────────
  // STATUS + LOGS
  // ──────────────────────────────────────────

  getStatus() {
    return agentManager.getStatus();
  }

  getLogs() {
    // Merge orchestrator logs + agentManager logs, sorted by time
    const mgLogs = agentManager.getLogs();
    const allLogs = [...this.logs, ...mgLogs];
    allLogs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return allLogs.slice(0, this.maxLogs);
  }

  getAgentCount() {
    const status = agentManager.getStatus();
    const states = Object.values(status);
    return {
      total: states.length,
      running: states.filter(s => s.status === 'running').length,
      cooldown: states.filter(s => s.status === 'cooldown').length,
      creating: states.filter(s => s.status === 'creating').length,
      error: states.filter(s => s.status === 'error').length,
      stopped: states.filter(s => s.status === 'stopped').length,
    };
  }

  _addLog(level, message, profileId) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      level,
      message,
      profileId,
      ts: Date.now(),
      timestamp: Date.now(),
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) this.logs.pop();
    console.log(`[Orchestrator:${level.toUpperCase()}] ${profileId ? `[${profileId.slice(-6)}]` : ''} ${message}`);
    this.emit('log', entry);
  }

  addLog(level, message, profileId) {
    this._addLog(level, message, profileId);
  }
}

module.exports = { Orchestrator };
