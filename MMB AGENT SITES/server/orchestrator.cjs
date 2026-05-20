const { Worker } = require('worker_threads');
const path = require('path');

class Orchestrator {
  constructor() {
    this.workers = new Map(); // profileId -> { worker, status, articles, startedAt }
    this.logs = [];
    this.maxLogs = 500;
  }

  addLog(level, message, profileId) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      level,
      message,
      profileId,
      timestamp: Date.now(),
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) this.logs.pop();
    console.log(`[${level.toUpperCase()}] ${profileId ? `[${profileId}]` : ''} ${message}`);
  }

  startWorker(profileId, envId, articles, settings) {
    // Stop existing worker if any
    if (this.workers.has(profileId)) {
      this.stopWorker(profileId);
    }

    const workerPath = path.join(__dirname, 'worker.cjs');
    const worker = new Worker(workerPath, {
      workerData: { profileId, envId, articles, settings },
    });

    worker.on('message', (msg) => {
      if (msg.type === 'log') {
        this.addLog(msg.level, msg.message, profileId);
      } else if (msg.type === 'progress') {
        const entry = this.workers.get(profileId);
        if (entry) {
          entry.currentArticle = msg.articleIndex;
          entry.totalArticles = msg.totalArticles;
          entry.currentUrl = msg.url;
        }
      } else if (msg.type === 'done') {
        this.addLog('success', `Session completed: ${msg.articlesRead} articles read`, profileId);
        const entry = this.workers.get(profileId);
        if (entry) entry.status = 'completed';
      }
    });

    worker.on('error', (err) => {
      this.addLog('error', `Worker error: ${err.message}`, profileId);
      const entry = this.workers.get(profileId);
      if (entry) entry.status = 'error';
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.addLog('warn', `Worker exited with code ${code}`, profileId);
      }
      const entry = this.workers.get(profileId);
      if (entry && entry.status === 'running') {
        entry.status = 'stopped';
      }
    });

    this.workers.set(profileId, {
      worker,
      status: 'running',
      articles,
      startedAt: Date.now(),
      currentArticle: 0,
      totalArticles: articles.length,
      currentUrl: '',
    });

    this.addLog('info', `Worker started with ${articles.length} articles`, profileId);
  }

  stopWorker(profileId) {
    const entry = this.workers.get(profileId);
    if (entry) {
      entry.worker.terminate();
      entry.status = 'stopped';
      this.addLog('info', 'Worker stopped', profileId);
    }
  }

  stopAll() {
    for (const [profileId] of this.workers) {
      this.stopWorker(profileId);
    }
    this.addLog('info', 'All workers stopped');
  }

  getStatus() {
    const status = {};
    for (const [profileId, entry] of this.workers) {
      status[profileId] = {
        status: entry.status,
        startedAt: entry.startedAt,
        currentArticle: entry.currentArticle,
        totalArticles: entry.totalArticles,
        currentUrl: entry.currentUrl,
      };
    }
    return status;
  }

  getLogs() {
    return this.logs;
  }
}

module.exports = { Orchestrator };
