'use strict';

/**
 * watchdog.cjs — Backend crash detection + auto-restart
 *
 * Run this as a SEPARATE process: node watchdog.cjs
 * It monitors the main backend (index.cjs on port 3200)
 * If backend crashes → restart it within 5 seconds
 *
 * Usage: node watchdog.cjs
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const BACKEND_PORT = 3200;
const CHECK_INTERVAL = 10000;  // check every 10s
const RESTART_DELAY  = 5000;   // wait 5s before restart
const BACKEND_SCRIPT = path.join(__dirname, 'index.cjs');

let backendProcess = null;
let isRestarting = false;
let restartCount = 0;

function log(msg) {
  console.log(`[WATCHDOG ${new Date().toISOString()}] ${msg}`);
}

function startBackend() {
  log(`Starting backend (attempt #${++restartCount})...`);

  backendProcess = spawn('node', [BACKEND_SCRIPT], {
    stdio: 'inherit',
    detached: false,
    cwd: path.dirname(BACKEND_SCRIPT),
  });

  backendProcess.on('exit', (code, signal) => {
    log(`Backend exited (code=${code}, signal=${signal})`);
    if (!isRestarting) {
      isRestarting = true;
      log(`Restarting in ${RESTART_DELAY / 1000}s...`);
      setTimeout(() => {
        isRestarting = false;
        startBackend();
      }, RESTART_DELAY);
    }
  });

  backendProcess.on('error', (err) => {
    log(`Backend spawn error: ${err.message}`);
  });

  log(`Backend started (PID: ${backendProcess.pid})`);
}

function checkBackendAlive() {
  const req = http.get(
    { hostname: '127.0.0.1', port: BACKEND_PORT, path: '/health', timeout: 5000 },
    (res) => {
      if (res.statusCode === 200) {
        // Backend alive — nothing to do
      } else {
        log(`Backend returned status ${res.statusCode} — monitoring...`);
      }
    }
  );

  req.on('error', () => {
    if (!isRestarting && (!backendProcess || backendProcess.killed || backendProcess.exitCode !== null)) {
      log('Backend health check failed and process is not running — restarting...');
      isRestarting = true;
      setTimeout(() => {
        isRestarting = false;
        startBackend();
      }, RESTART_DELAY);
    }
  });

  req.on('timeout', () => {
    req.destroy();
    log('Backend health check timed out');
  });
}

// Start backend immediately
startBackend();

// Monitor health every 10 seconds
setInterval(checkBackendAlive, CHECK_INTERVAL);

// Handle watchdog exit gracefully
process.on('SIGINT', () => {
  log('Watchdog shutting down...');
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Watchdog terminated');
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
  }
  process.exit(0);
});

log('Watchdog running — monitoring backend on port 3200');
