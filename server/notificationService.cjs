'use strict';

/**
 * notificationService — Telegram + Email alerts + Bot command poller
 */

const https = require('https');
const http = require('http');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function postJson(url, body, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function getJson(url, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Command builder helpers ─────────────────────────────────────────────────

function buildHelpText() {
  return (
    `🤖 <b>MMB AGENT 24/7 — Bot Commands</b>\n\n` +
    `/status   — Active agents &amp; system health\n` +
    `/profiles — Profile states (active / idle / error)\n` +
    `/schedule — Running schedules\n` +
    `/errors   — Last 5 errors &amp; warnings\n` +
    `/stats    — Today's watch stats\n` +
    `/stop     — 🛑 Emergency stop ALL agents\n` +
    `/help     — This message`
  );
}

function buildStatusText(dp) {
  const ytStatus = dp.getAgentManagerStatus();
  const orchStats = dp.getOrchestratorStats();
  const manualCount = dp.getManualAgentCount();
  const schedCount = dp.getRunningScheduleCount();
  const activeYT = dp.getActiveYTCount();
  const health = ytStatus.health || {};
  const circuitOpen = health.circuitOpen || false;
  const uptime = fmtUptime(process.uptime() * 1000);

  const lines = [
    `📊 <b>System Status</b>`,
    ``,
    `🟢 YT Agents active: <b>${activeYT}</b>`,
    `⏳ Queued: <b>${(ytStatus.queue || []).length}</b>`,
    `🔧 Worker threads: <b>${orchStats.running || 0}</b> running / <b>${orchStats.pending || 0}</b> pending`,
    `📋 Manual agents: <b>${manualCount}</b>`,
    `📅 Active schedules: <b>${schedCount}</b>`,
    `❤️ Health: ${circuitOpen ? '🔴 Circuit OPEN (paused)' : '✅ OK'}`,
    `⏱ Server uptime: <b>${uptime}</b>`,
  ];
  return lines.join('\n');
}

function buildProfilesText(dp) {
  const ytStatus = dp.getAgentManagerStatus();
  const agents = ytStatus.agents || {};
  const agentList = Object.values(agents);

  if (!agentList.length) {
    return `👤 <b>Profiles</b>\n\nNo YT agents running right now.`;
  }

  const active  = agentList.filter(a => a.status === 'watching' || a.status === 'running');
  const idle    = agentList.filter(a => a.status === 'idle' || a.status === 'cooldown' || a.status === 'done');
  const errored = agentList.filter(a => a.status === 'error' || a.status === 'failed');
  const other   = agentList.filter(a => !['watching','running','idle','cooldown','done','error','failed'].includes(a.status));

  const lines = [
    `👤 <b>Profiles</b>`,
    ``,
    `Total tracked: <b>${agentList.length}</b>`,
    `✅ Active: <b>${active.length}</b>`,
    `💤 Idle/Cooldown: <b>${idle.length}</b>`,
    `❌ Error: <b>${errored.length}</b>`,
  ];

  if (other.length) lines.push(`🔄 Other: <b>${other.length}</b>`);

  if (active.length > 0) {
    lines.push(``, `<b>Active agents:</b>`);
    for (const a of active.slice(0, 8)) {
      const pct = a.watchPercent != null ? ` (${a.watchPercent}%)` : '';
      const vid = a.currentVideo ? ` — ${String(a.currentVideo).slice(0, 30)}` : '';
      lines.push(`  • ${a.agentName || a.agentId}${pct}${vid}`);
    }
    if (active.length > 8) lines.push(`  … and ${active.length - 8} more`);
  }

  if (errored.length > 0) {
    lines.push(``, `<b>Errored:</b>`);
    for (const a of errored.slice(0, 5)) {
      lines.push(`  ⚠️ ${a.agentName || a.agentId}`);
    }
  }

  return lines.join('\n');
}

function buildScheduleText(dp) {
  const schedCount = dp.getRunningScheduleCount();
  const scheds = dp.getRunningSchedules();
  const orchStats = dp.getOrchestratorStats();

  const lines = [`📅 <b>Schedules</b>`, ``];

  if (!schedCount && !(orchStats.running || orchStats.pending)) {
    lines.push(`No schedules currently running.`);
    return lines.join('\n');
  }

  lines.push(`Worker threads: <b>${orchStats.running || 0}</b> running, <b>${orchStats.pending || 0}</b> pending, <b>${orchStats.done || 0}</b> done`);

  if (scheds && scheds.length > 0) {
    lines.push(``, `<b>Active schedule runs:</b>`);
    for (const s of scheds.slice(0, 5)) {
      const name = s.schedule?.name || s.scheduleId || 'Unnamed';
      const start = fmtTime(s.startedAt);
      const profiles = s.profileIds?.length || '?';
      lines.push(`  📋 <b>${name}</b> — ${profiles} profiles, started ${start}`);
    }
    if (scheds.length > 5) lines.push(`  … and ${scheds.length - 5} more`);
  }

  return lines.join('\n');
}

function buildErrorsText(dp) {
  const { errors, warnings } = dp.getRecentErrorsAndWarnings(5);
  const lines = [`⚠️ <b>Recent Errors &amp; Warnings</b>`, ``];

  const combined = [
    ...errors.map(e => ({ ...e, _type: 'error' })),
    ...warnings.map(e => ({ ...e, _type: 'warn' })),
  ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 5);

  if (!combined.length) {
    lines.push(`✅ No recent errors or warnings!`);
    return lines.join('\n');
  }

  for (const e of combined) {
    const icon = e._type === 'error' ? '🔴' : '⚠️';
    const time = fmtTime(e.timestamp);
    const prof = e.profileName ? ` [${e.profileName}]` : '';
    const msg  = String(e.message || '').slice(0, 120);
    lines.push(`${icon} <b>${time}</b>${prof}\n   ${msg}`);
  }

  return lines.join('\n');
}

function buildStatsText(dp) {
  const stats = dp.getTodayStats();
  const lines = [
    `📈 <b>Today's Stats</b>`,
    ``,
    `🎬 Videos watched: <b>${stats.videosWatched}</b>`,
    `⏱ Total watch time: <b>${Math.round(stats.totalWatchSec / 60)} min</b>`,
    `👍 Likes given: <b>${stats.likes}</b>`,
    `👤 Profiles used: <b>${stats.profilesUsed}</b>`,
    `🗓 Date: <b>${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b>`,
  ];
  return lines.join('\n');
}

// ─── Main class ──────────────────────────────────────────────────────────────

class NotificationService {
  constructor() {
    this.settings = {};
    this.lastDailyReport = 0;
    // Bot command poller state
    this._pollerActive = false;
    this._pollerOffset = 0;
    this._dataProvider = null;
    this._stopConfirmPending = new Set(); // chatIds awaiting /stop confirm
  }

  updateSettings(s) {
    this.settings = { ...this.settings, ...s };
  }

  // ── Outgoing ──────────────────────────────────────────────────────────────

  async sendTelegram(text) {
    const token = this.settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = this.settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
    if (!token || !chatId) return false;
    return this._sendToChat(token, chatId, text);
  }

  async _sendToChat(token, chatId, text) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await postJson(url, { chat_id: chatId, text, parse_mode: 'HTML' });
      return res.status === 200;
    } catch (err) {
      console.warn('[Notify] Telegram failed:', err.message);
      return false;
    }
  }

  async sendEmail(subject, body) {
    const host = this.settings.smtpHost || process.env.SMTP_HOST || '';
    const user = this.settings.smtpUser || process.env.SMTP_USER || '';
    const pass = this.settings.smtpPass || process.env.SMTP_PASS || '';
    const to = this.settings.notifyEmail || process.env.NOTIFY_EMAIL || '';
    if (!host || !user || !to) return false;

    const mailApi = this.settings.mailApiUrl || process.env.MAIL_API_URL || '';
    if (mailApi) {
      try {
        await postJson(mailApi, { to, subject, body, user, pass });
        return true;
      } catch (err) {
        console.warn('[Notify] Email API failed:', err.message);
      }
    }

    console.log(`[Notify:Email] ${subject}\n${body.slice(0, 500)}`);
    return false;
  }

  async alert(level, title, message) {
    const icon = level === 'critical' ? '🔴' : level === 'warning' ? '⚠️' : 'ℹ️';
    const text = `${icon} <b>${title}</b>\n${message}`;
    const tasks = [this.sendTelegram(text)];
    if (level === 'critical' || level === 'daily') {
      tasks.push(this.sendEmail(`${icon} ${title}`, message));
    }
    await Promise.allSettled(tasks);
  }

  async critical(title, message) { return this.alert('critical', title, message); }
  async warning(title, message)  { return this.alert('warning', title, message); }
  async info(title, message)     { return this.alert('info', title, message); }

  async dailyReport(stats) {
    const now = Date.now();
    if (now - this.lastDailyReport < 20 * 60 * 60 * 1000) return;
    this.lastDailyReport = now;
    const msg = [
      `Views: ${stats.totalViews || 0}`,
      `Watch time: ${Math.round((stats.totalWatchTime || 0) / 60)} min`,
      `Likes: ${stats.totalLikes || 0}`,
      `YT Agents active: ${stats.activeAgents || 0}`,
      `Uptime: OK`,
    ].join('\n');
    await this.alert('daily', 'MMB YT Agent — Daily Report', msg);
  }

  async milestone(label, value) {
    await this.info('Milestone', `${label}: ${value}`);
  }

  // ── Bot command poller ────────────────────────────────────────────────────

  /**
   * Start polling Telegram for incoming commands.
   * @param {object} dataProvider  — live data callbacks (set by index.cjs)
   */
  startCommandPoller(dataProvider) {
    if (this._pollerActive) return;
    this._pollerActive = true;
    this._pollerOffset = 0;
    this._dataProvider = dataProvider;
    console.log('[TelegramBot] Command poller started');
    // _initOffsetThenPoll skips any backlog of old messages on startup
    this._initOffsetThenPoll().catch(err =>
      console.error('[TelegramBot] Poll loop crashed:', err.message)
    );
  }

  stopCommandPoller() {
    this._pollerActive = false;
    console.log('[TelegramBot] Command poller stopped');
  }

  /** Fetch the latest update_id on startup so we skip old/pending messages */
  async _initOffsetThenPoll() {
    const token = this.settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
    if (token) {
      try {
        // limit=1 + timeout=0 → instant response, just gets the most recent update_id
        const url = `https://api.telegram.org/bot${token}/getUpdates`;
        const res = await postJson(url, { limit: 1, timeout: 0 }, {}, 10000);
        if (res.status === 200) {
          const body = JSON.parse(res.data);
          if (body.ok && Array.isArray(body.result) && body.result.length > 0) {
            // skip everything up to and including the latest pending update
            this._pollerOffset = body.result[body.result.length - 1].update_id + 1;
            console.log(`[TelegramBot] Skipped old updates, starting from offset ${this._pollerOffset}`);
          }
        }
      } catch (e) {
        console.warn('[TelegramBot] Offset init warning (non-fatal):', e.message);
      }
    }
    return this._pollLoop();
  }

  async _pollLoop() {
    while (this._pollerActive) {
      const token  = this.settings.telegramBotToken  || process.env.TELEGRAM_BOT_TOKEN  || '';
      const chatId = String(this.settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || '');

      if (!token || !chatId) {
        await sleep(15000); // wait until credentials are configured
        continue;
      }

      try {
        // Use POST for getUpdates — properly handles all params, no URL-encoding issues
        // socket timeout = poll timeout + 10s buffer
        const POLL_TIMEOUT_SEC = 25;
        const url = `https://api.telegram.org/bot${token}/getUpdates`;
        const res = await postJson(
          url,
          { timeout: POLL_TIMEOUT_SEC, offset: this._pollerOffset, allowed_updates: ['message'] },
          {},
          (POLL_TIMEOUT_SEC + 10) * 1000,
        );

        if (res.status !== 200) {
          console.warn(`[TelegramBot] getUpdates HTTP ${res.status} — retrying in 5s`);
          await sleep(5000);
          continue;
        }

        const body = JSON.parse(res.data);
        if (!body.ok || !Array.isArray(body.result)) {
          console.warn('[TelegramBot] getUpdates not ok:', res.data.slice(0, 200));
          await sleep(5000);
          continue;
        }

        for (const update of body.result) {
          // advance offset so we never re-process this update
          this._pollerOffset = Math.max(this._pollerOffset, update.update_id + 1);

          const msg = update.message;
          if (!msg || !msg.text) continue;

          // Security: only accept messages from our authorised chatId
          const fromId = String(msg.chat?.id || msg.from?.id || '');
          if (fromId !== chatId) {
            console.log(`[TelegramBot] Ignored message from unknown chat ${fromId}`);
            continue;
          }

          const text = msg.text.trim();
          // Extract command — strip /cmd@BotName suffix if present
          const rawCmd = text.split(/\s+/)[0].toLowerCase().replace(/@\S+$/, '');
          console.log(`[TelegramBot] Command received: ${rawCmd}`);

          await this._handleCommand(rawCmd, token, chatId, text).catch(err =>
            console.warn('[TelegramBot] Command handler error:', err.message)
          );
        }
      } catch (err) {
        if (this._pollerActive) {
          console.warn('[TelegramBot] Poll error (will retry in 5s):', err.message);
          await sleep(5000);
        }
      }
    }
  }

  async _handleCommand(cmd, token, chatId, fullText) {
    const dp = this._dataProvider;
    let reply = '';

    // /stop needs a second confirmation
    if (cmd === '/stop') {
      if (this._stopConfirmPending.has(chatId)) {
        // Second /stop — execute emergency stop
        this._stopConfirmPending.delete(chatId);
        try {
          await dp.stopAllAgents();
          reply = `🛑 <b>Emergency Stop Executed</b>\n\nAll agents and schedules have been stopped.`;
        } catch (err) {
          reply = `❌ Stop failed: ${err.message}`;
        }
      } else {
        // First /stop — ask for confirmation
        this._stopConfirmPending.add(chatId);
        // Auto-clear confirm window after 30s
        setTimeout(() => this._stopConfirmPending.delete(chatId), 30000);
        reply = `⚠️ <b>Emergency Stop — Confirm?</b>\n\nSend /stop again within 30 seconds to stop ALL running agents and schedules.\n\nSend any other command to cancel.`;
      }
    } else {
      // Any other command cancels a pending /stop confirmation
      if (this._stopConfirmPending.has(chatId)) {
        this._stopConfirmPending.delete(chatId);
      }

      if (!dp) {
        reply = `⚠️ Data provider not ready yet. Try again in a moment.`;
      } else {
        switch (cmd) {
          case '/help':
          case '/start':
            reply = buildHelpText();
            break;

          case '/status':
            try { reply = buildStatusText(dp); }
            catch (e) { reply = `❌ Status error: ${e.message}`; }
            break;

          case '/profiles':
            try { reply = buildProfilesText(dp); }
            catch (e) { reply = `❌ Profiles error: ${e.message}`; }
            break;

          case '/schedule':
          case '/schedules':
            try { reply = buildScheduleText(dp); }
            catch (e) { reply = `❌ Schedule error: ${e.message}`; }
            break;

          case '/errors':
          case '/error':
            try { reply = buildErrorsText(dp); }
            catch (e) { reply = `❌ Errors fetch error: ${e.message}`; }
            break;

          case '/stats':
            try { reply = buildStatsText(dp); }
            catch (e) { reply = `❌ Stats error: ${e.message}`; }
            break;

          default:
            reply = `❓ Unknown command: <code>${cmd}</code>\n\nSend /help to see available commands.`;
        }
      }
    }

    if (reply) {
      const branded = `🤖 <b>MMB AGENT 24/7</b>\n${'─'.repeat(22)}\n${reply}`;
      await this._sendToChat(token, chatId, branded);
    }
  }
}

const notificationService = new NotificationService();
module.exports = { NotificationService, notificationService };
