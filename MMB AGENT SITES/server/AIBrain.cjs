'use strict';

/**
 * AIBrain — Per-profile AI decision engine using Claude API
 *
 * Each ProfileAgent gets its own AIBrain instance.
 * AI makes high-level decisions (search query, read depth, next action).
 * All low-level scrolling/clicking is handled by the persona system.
 *
 * Falls back gracefully if ANTHROPIC_API_KEY is not set or API is unreachable.
 */

const https = require('https');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 150;
const TIMEOUT_MS = 12000;
const MAX_CALLS_PER_SESSION = 40; // cost guard

class AIBrain {
  constructor(profileId, personaName) {
    this.profileId   = profileId;
    this.personaName = personaName;
    this.apiKey      = process.env.ANTHROPIC_API_KEY || '';
    this.enabled     = !!this.apiKey;
    this.callCount   = 0;
    this.sessionHistory = []; // [{action, title}] — last 8 actions
  }

  // ── Low-level Claude API call ──
  async _call(systemPrompt, userMessage) {
    if (!this.enabled || this.callCount >= MAX_CALLS_PER_SESSION) return null;

    const body = JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':       'application/json',
          'x-api-key':          this.apiKey,
          'anthropic-version':  '2023-06-01',
          'Content-Length':     Buffer.byteLength(body),
        },
        timeout: TIMEOUT_MS,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            resolve(j.content?.[0]?.text?.trim() || null);
          } catch { resolve(null); }
        });
      });

      req.on('error',   () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(body);
      req.end();
      this.callCount++;
    });
  }

  /**
   * Decide what to search on Google/Bing for this article.
   * Returns a natural search query string, or null (fallback to site config queries).
   */
  async decideSearchQuery(articleTitle, topicHint = '') {
    const system = `You are a ${this.personaName} searching for information online. Generate a natural Google search query a real person would type. Reply with ONLY the search query. Max 7 words. No quotes around it.`;
    const user   = `I want to find this article: "${articleTitle}"${topicHint ? `. Topic context: ${topicHint}` : ''}. What would I search?`;
    return await this._call(system, user);
  }

  /**
   * Decide reading depth (0.2 = quick skim, 1.0 = read every word).
   * Returns float 0.2–1.0, or null (use persona default).
   */
  async decideReadDepth(articleTitle, excerpt) {
    const system = `You are a ${this.personaName}. Decide how deeply to read an article. Reply with ONLY a decimal number between 0.2 and 1.0. (0.2=quick skim, 0.5=normal, 1.0=read every word). Nothing else.`;
    const user   = `Article: "${articleTitle}"\nFirst lines: "${(excerpt || '').slice(0, 200)}"`;
    const result = await this._call(system, user);
    const num = parseFloat(result);
    return (isNaN(num) || num < 0.2 || num > 1.0) ? null : num;
  }

  /**
   * Decide what to do after reading an article.
   * Returns 'continue' | 'bounce' | 'related' | null (use persona logic).
   */
  async decideNextAction(articlesRead, lastTitle, sessionDurationMin) {
    const system = `You are a ${this.personaName} browsing the web. Decide your next move. Reply with ONLY one word: "continue" (read another article), "related" (click a related/next article), or "bounce" (leave the site). Nothing else.`;
    const user   = `Articles read this session: ${articlesRead}. Session time: ${sessionDurationMin} min. Last article: "${lastTitle}".`;
    const result = await this._call(system, user);
    const action = result?.toLowerCase();
    return ['continue', 'related', 'bounce'].includes(action) ? action : null;
  }

  /**
   * Generate a realistic-sounding search query based purely on the topic.
   * Used when articleTitle is not available.
   */
  async generateTopicQuery(topic) {
    const system = `You are a ${this.personaName} who just heard about this topic and wants to learn more. Generate a natural search query. Reply with ONLY the query. Max 8 words.`;
    const user   = `Topic: ${topic}`;
    return await this._call(system, user);
  }

  /**
   * Decide unique per-article behavior pattern.
   * Returns object with scrollSpeed, pauseFrequency, tabOut, mouseActivity
   * or null (use persona defaults).
   * articleIndex = 0-based position in session (0=first article, 1=second...)
   */
  async decideArticleBehavior(articleTitle, articleIndex, sessionArticleCount) {
    const system = `You are a ${this.personaName} browsing the web. For each article in a session, decide a UNIQUE reading behavior. Reply with ONLY a JSON object, no explanation.
Format: {"scrollSpeed":"slow|medium|fast","pauseFrequency":"rare|normal|frequent","tabOut":true|false,"mouseActivity":"low|normal|high","rereadChance":0.0-1.0}`;
    const user = `Article ${articleIndex + 1} of ${sessionArticleCount}: "${articleTitle}". Previous articles: ${articleIndex}. Make this article's behavior DIFFERENT from typical patterns.`;
    const result = await this._call(system, user);
    try {
      const parsed = JSON.parse(result);
      const valid = ['slow','medium','fast'].includes(parsed.scrollSpeed) &&
                    ['rare','normal','frequent'].includes(parsed.pauseFrequency) &&
                    ['low','normal','high'].includes(parsed.mouseActivity);
      return valid ? parsed : null;
    } catch { return null; }
  }

  addHistory(action, title) {
    this.sessionHistory.push({ action, title });
    if (this.sessionHistory.length > 8) this.sessionHistory.shift();
  }

  isEnabled() { return this.enabled; }
  resetSession() { this.callCount = 0; this.sessionHistory = []; }
}

module.exports = { AIBrain };
