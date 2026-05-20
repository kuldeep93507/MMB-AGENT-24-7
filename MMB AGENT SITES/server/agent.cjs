/**
 * Profile Agent — One agent per MoreLogin profile
 * Playwright CDP — Human-like article reading behavior
 * 
 * FEATURES:
 * 1. Traffic Router: Google Search / Direct URL / Internal Link / Backlink
 * 2. Butter Smooth Scroll: sine wave speed, ad pause, unique per profile
 * 3. Ad Detection: pause on ad viewport (NEVER click)
 * 4. Auto-recovery: retry on fail, skip unavailable
 */

const { chromium } = require('playwright-core');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function humanType(page, text) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(80, 200) });
    if (Math.random() < 0.06) await sleep(randomDelay(200, 600));
  }
  await sleep(randomDelay(300, 700));
}

async function humanMouseMove(page) {
  const x = randomDelay(200, 900);
  const y = randomDelay(150, 500);
  await page.mouse.move(x, y, { steps: randomDelay(8, 20) });
  await sleep(randomDelay(100, 300));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUTTER SMOOTH SCROLL — Sine wave speed variation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function butterSmoothScroll(page, durationMs, config = {}, scrollProfile = null) {
  const profile = scrollProfile || { speedMult: 1.0, pauseChance: 0.03, sineFreq: 1.0, jitterRange: 0.3 };
  const speedMultiplier = config.scrollSpeed === 'slow' ? 0.7 : config.scrollSpeed === 'fast' ? 1.5 : 1.0;
  const adPauseMin = (config.adPauseDurationMin || 0.5) * 1000;
  const adPauseMax = (config.adPauseDurationMax || 2) * 1000;

  const startTime = Date.now();
  const stepInterval = 50;
  let totalScrolled = 0;

  while (Date.now() - startTime < durationMs) {
    const elapsed = Date.now() - startTime;
    const progress = elapsed / durationMs;

    // Per-profile sine wave (unique frequency)
    const sineSpeed = 0.5 + Math.sin(progress * Math.PI * profile.sineFreq) * 0.8;
    // Per-profile jitter range
    const jitter = 1 + (Math.random() - 0.5) * profile.jitterRange;
    // Combined scroll amount
    const scrollAmount = (3 + Math.random() * 4) * sineSpeed * jitter * speedMultiplier * profile.speedMult;

    await page.mouse.wheel(0, scrollAmount).catch(() => {});
    totalScrolled += scrollAmount;
    await sleep(stepInterval + randomDelay(0, 20));

    // Per-profile pause chance (reading a paragraph)
    if (Math.random() < profile.pauseChance) {
      await sleep(randomDelay(1000, 3500));
    }

    // Ad detection — check every ~2 seconds
    if (Math.random() < 0.02) {
      const hasAd = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe[src*="ad"], iframe[id*="ad"], ins.adsbygoogle, div[class*="ad-"], div[class*="advertisement"]');
        for (const el of iframes) {
          const rect = el.getBoundingClientRect();
          if (rect.top >= 0 && rect.top < window.innerHeight) return true;
        }
        return false;
      }).catch(() => false);

      if (hasAd) {
        const pauseTime = randomDelay(adPauseMin, adPauseMax);
        await sleep(pauseTime);
      }
    }

    // Occasional mouse move (natural behavior)
    if (Math.random() < 0.01) {
      await humanMouseMove(page);
    }
  }

  return totalScrolled;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRAFFIC ROUTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SEARCH_DOMAINS = ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'search.yahoo.com'];

// After search engine click, check if we're still on SERP → force goto with referer
async function _ensureLandedOnTarget(page, articleUrl) {
  try {
    const current = page.url();
    const onSearch = SEARCH_DOMAINS.some(d => current.includes(d));
    if (onSearch && articleUrl) {
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000, referer: current });
    }
  } catch (_) {}
}

async function _searchAndNavigate(page, searchUrl, inputSel, articleUrl, articleTitle) {
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(randomDelay(1500, 3500));
  // Broader selector to handle mobile/Android Google variants
  const allSels = [inputSel, 'input[type="search"]', 'input[type="text"]', '[role="combobox"]', 'textarea'].join(', ');
  let input = await page.$(allSels).catch(() => null);
  if (!input) {
    await sleep(3000);
    input = await page.$(allSels).catch(() => null);
  }
  if (!input) {
    // Fallback: direct navigation with search referer
    await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000, referer: searchUrl }).catch(() => {});
    return true;
  }
  await input.click();
  await sleep(randomDelay(300, 700));
  const query = `${articleTitle} site:${new URL(articleUrl).hostname}`;
  await humanType(page, query);
  await sleep(randomDelay(500, 1200));
  await page.keyboard.press('Enter');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(randomDelay(2000, 5000));
  // Scroll results page a bit (human behavior)
  try { await page.mouse.wheel(0, randomDelay(80, 250)); } catch (_) {}
  await sleep(randomDelay(1000, 3000));
  // Try to find and click article link
  const result = await page.$(`a[href*="${new URL(articleUrl).pathname}"], a[href*="${new URL(articleUrl).hostname}"]`).catch(() => null);
  if (result) {
    await humanMouseMove(page);
    await sleep(randomDelay(800, 2000));
    const refererUrl = page.url();
    await result.click().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Safety net — if click didn't land on target, force goto with referer
    await _ensureLandedOnTarget(page, articleUrl);
    return true;
  }
  // Not found in results — goto directly BUT keep search engine as referer
  const refererUrl = page.url();
  await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000, referer: refererUrl });
  return true;
}

async function openArticleByTraffic(page, articleUrl, articleTitle, trafficType, siteUrl, backlinkData) {
  switch (trafficType) {
    case 'google':
      await _searchAndNavigate(page, 'https://www.google.com', 'input[name="q"], textarea[name="q"]', articleUrl, articleTitle);
      return true;

    case 'bing':
      await _searchAndNavigate(page, 'https://www.bing.com', 'input[name="q"]', articleUrl, articleTitle);
      return true;

    case 'duckduckgo':
      await _searchAndNavigate(page, 'https://duckduckgo.com', 'input[name="q"]', articleUrl, articleTitle);
      return true;

    case 'yahoo':
      await _searchAndNavigate(page, 'https://search.yahoo.com', 'input[name="p"]', articleUrl, articleTitle);
      return true;

    case 'internal':
      // Go to site homepage → find article → click
      await page.goto(siteUrl || new URL(articleUrl).origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomDelay(3000, 6000));
      // Scroll homepage (browsing)
      await page.mouse.wheel(0, randomDelay(200, 500)).catch(() => {});
      await sleep(randomDelay(2000, 5000));
      await page.mouse.wheel(0, randomDelay(100, 300)).catch(() => {});
      await sleep(randomDelay(1500, 3000));
      // Try to find article link
      const articleLink = await page.$(`a[href*="${new URL(articleUrl).pathname}"]`);
      if (articleLink) {
        await humanMouseMove(page);
        await sleep(randomDelay(1000, 2000));
        await articleLink.click();
        await sleep(randomDelay(2000, 4000));
        return true;
      }
      // Fallback: direct
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return true;

    case 'backlink':
      // Open external page → find blog link → click
      if (backlinkData?.sourceUrl) {
        await page.goto(backlinkData.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(randomDelay(5000, 12000));
        await humanMouseMove(page);
        await page.mouse.wheel(0, randomDelay(200, 400)).catch(() => {});
        await sleep(randomDelay(3000, 6000));
        // Find blog link
        const blogLink = await page.$(`a[href*="${new URL(articleUrl).hostname}"]`);
        if (blogLink) {
          await humanMouseMove(page);
          await sleep(randomDelay(1000, 2500));
          await blogLink.click();
          await sleep(randomDelay(2000, 4000));
          return true;
        }
      }
      // Fallback: direct
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return true;

    case 'random': {
      // Realistic traffic mix — weighted like real site analytics
      const mix = [
        { src: 'google',     w: 38 },
        { src: 'direct',     w: 20 },
        { src: 'internal',   w: 18 },
        { src: 'bing',       w: 10 },
        { src: 'duckduckgo', w:  5 },
        { src: 'yahoo',      w:  5 },
        ...(backlinkData?.sourceUrl ? [{ src: 'backlink', w: 4 }] : []),
      ];
      const total = mix.reduce((s, m) => s + m.w, 0);
      let rand = Math.random() * total;
      let picked = 'direct';
      for (const m of mix) { rand -= m.w; if (rand <= 0) { picked = m.src; break; } }
      return await openArticleByTraffic(page, articleUrl, articleTitle, picked, siteUrl, backlinkData);
    }

    case 'direct':
    default:
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomDelay(1000, 3000));
      return true;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROFILE AGENT CLASS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class ProfileAgent {
  constructor(profileId, profileName, debugPort, options = {}) {
    this.profileId = profileId;
    this.profileName = profileName;
    this.debugPort = debugPort;
    this.browser = null;
    this.context = null;
    this.status = 'idle';
    this.currentArticle = null;
    this.options = options;
    this.logs = [];
    this.retryCount = 0;
    this.maxRetries = 3;
    this.articlesRead = 0;
    this.totalDwellTime = 0;

    // UNIQUE scroll behavior per profile (generated once, stays consistent)
    const scrollType = Math.random();
    if (scrollType < 0.3) {
      // Slow reader (30% of profiles)
      this.scrollProfile = { speedMult: 0.7, pauseChance: 0.05, sineFreq: 0.8, jitterRange: 0.4 };
    } else if (scrollType < 0.7) {
      // Medium reader (40% of profiles)
      this.scrollProfile = { speedMult: 1.0, pauseChance: 0.03, sineFreq: 1.0, jitterRange: 0.3 };
    } else {
      // Fast reader (30% of profiles)
      this.scrollProfile = { speedMult: 1.4, pauseChance: 0.02, sineFreq: 1.3, jitterRange: 0.2 };
    }

    // Unique ad pause behavior
    this.adPauseStyle = Math.random() < 0.5 ? 'short' : 'long'; // short: 0.5-1.5s, long: 1-3s
  }

  log(level, message) {
    const entry = { time: new Date().toISOString(), level, message, profileId: this.profileId };
    this.logs.push(entry);
    if (this.logs.length > 50) this.logs = this.logs.slice(-50);
    console.log(`[${this.profileName}] [${level}] ${message}`);
    return entry;
  }

  async connect() {
    this.status = 'connecting';
    this.log('info', `Connecting to CDP at http://127.0.0.1:${this.debugPort}...`);
    try {
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
      this.context = this.browser.contexts()[0];
      if (!this.context) this.context = await this.browser.newContext();
      this.status = 'connected';
      this.log('success', `Connected! CDP port: ${this.debugPort}`);
      return true;
    } catch (err) {
      this.status = 'error';
      this.log('error', `CDP connection failed: ${err.message}`);
      return false;
    }
  }

  async readArticle(articleUrl, articleTitle, config = {}) {
    if (!this.context) { this.log('error', 'No browser context'); return false; }

    this.currentArticle = articleTitle;
    this.status = 'navigating';
    const trafficType = config.trafficPreference || 'random';
    this.log('info', `[${trafficType}] Opening: "${articleTitle}"`);

    let page;
    try {
      page = await this.context.newPage();

      // Start delay (unique per profile)
      const startDelay = randomDelay((config.startDelayMin || 5) * 1000, (config.startDelayMax || 30) * 1000);
      await sleep(startDelay);

      // Navigate using traffic router
      const opened = await openArticleByTraffic(page, articleUrl, articleTitle, trafficType, config.siteUrl);
      if (!opened) {
        this.log('error', `Could not open: "${articleTitle}"`);
        await page.close().catch(() => {});
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.log('warn', `Retrying (${this.retryCount}/${this.maxRetries})...`);
          await sleep(randomDelay(3000, 8000));
          return await this.readArticle(articleUrl, articleTitle, { ...config, trafficPreference: 'direct' });
        }
        return false;
      }

      this.retryCount = 0;
      this.status = 'reading';
      this.log('info', `Reading: "${articleTitle}"`);

      // Calculate read time (random between min-max)
      const readTimeMin = (config.readTimeMin || 30) * 1000;
      const readTimeMax = (config.readTimeMax || 300) * 1000;
      const readTime = randomDelay(readTimeMin, readTimeMax);

      // Wait for page to render
      await sleep(randomDelay(1000, 2000));

      // BUTTER SMOOTH SCROLL — the main reading behavior (with per-profile curve)
      await butterSmoothScroll(page, readTime, config, this.scrollProfile);

      // Maybe scroll up slightly at end (re-reading something)
      if (Math.random() < 0.3) {
        await page.mouse.wheel(0, -randomDelay(100, 300)).catch(() => {});
        await sleep(randomDelay(1000, 3000));
      }

      const dwellSeconds = Math.round(readTime / 1000);
      this.articlesRead++;
      this.totalDwellTime += dwellSeconds;

      this.log('success', `Finished: "${articleTitle}" (${dwellSeconds}s dwell, ${trafficType})`);
      // Keep page open if caller wants to use it for next-post navigation
      if (!config.keepPageOpen) await page.close();
      return { dwellTime: dwellSeconds, trafficSource: trafficType, page: config.keepPageOpen ? page : null };
    } catch (err) {
      const fs = require('fs');
      fs.appendFileSync('/tmp/agent_errors.log', `[${new Date().toISOString()}] ${this.profileName} | "${articleTitle}" | ERR: ${err.message}\n  Stack: ${err.stack}\n`);
      this.log('error', `Error reading "${articleTitle}": ${err.message}`);
      if (page) await page.close().catch(() => {});
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.log('warn', `Auto-recovery (${this.retryCount}/${this.maxRetries})...`);
        await sleep(randomDelay(5000, 10000));
        return await this.readArticle(articleUrl, articleTitle, config);
      }
      return false;
    }
  }

  // Try to click a "next post" link on the current page and return the landed URL
  async _clickNextPost(page) {
    try {
      // Common "next post" selectors across WordPress, Ghost, custom themes
      const nextSelectors = [
        'a[rel="next"]',
        '.nav-next a', '.next-post a', '.post-nav-next a',
        'a.next', 'a.next-post', 'a.nextpostslink',
        '[class*="next"] a[href*="/"]',
        'a[href][class*="next"]',
        '.navigation .next a', '#nav-below .nav-next a',
        'a:has-text("Next")', 'a:has-text("Next Post")', 'a:has-text("→")',
      ];
      for (const sel of nextSelectors) {
        const el = await page.$(sel).catch(() => null);
        if (el) {
          const href = await el.getAttribute('href').catch(() => null);
          if (href && href.startsWith('http')) {
            await humanMouseMove(page);
            await sleep(randomDelay(800, 1800));
            await el.click().catch(() => {});
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await sleep(randomDelay(1000, 2000));
            return page.url();
          }
        }
      }
    } catch (_) {}
    return null;
  }

  async runSession(articles, config = {}) {
    this.status = 'running';
    this.log('info', `Session starting: ${articles.length} articles`);
    const articleDelay = config.articleDelay || 30;
    const useNextPost = config.useNextPost === true;
    const results = [];

    // Keep last active page for "next post" navigation
    let activePage = null;

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      this.log('info', `[${i + 1}/${articles.length}] ${article.title}`);

      let result;
      // From 2nd article onwards, try "next post" click on the existing page first
      if (useNextPost && i > 0 && activePage) {
        try {
          this.log('info', `Trying "next post" navigation for article ${i + 1}...`);
          const nextUrl = await this._clickNextPost(activePage);
          if (nextUrl && nextUrl !== 'about:blank') {
            this.log('info', `Navigated via next post → ${nextUrl}`);
            // Read the page we're already on (no new tab needed)
            this.currentArticle = article.title;
            this.status = 'reading';
            const readTimeMin = (config.readTimeMin || 30) * 1000;
            const readTimeMax = (config.readTimeMax || 300) * 1000;
            const readTime = randomDelay(readTimeMin, readTimeMax);
            await sleep(randomDelay(1000, 2000));
            await butterSmoothScroll(activePage, readTime, config, this.scrollProfile);
            if (Math.random() < 0.3) {
              await activePage.mouse.wheel(0, -randomDelay(100, 300)).catch(() => {});
              await sleep(randomDelay(1000, 2000));
            }
            const dwellSeconds = Math.round(readTime / 1000);
            this.articlesRead++;
            this.totalDwellTime += dwellSeconds;
            this.log('success', `Read via next-post: "${article.title}" (${dwellSeconds}s, internal)`);
            result = { dwellTime: dwellSeconds, trafficSource: 'internal' };
          } else {
            // Next post not found — fallback to direct
            this.log('warn', `No next post link found, falling back to direct for: ${article.title}`);
            result = await this.readArticle(article.url, article.title, { ...config, trafficPreference: 'direct' });
          }
        } catch (err) {
          this.log('warn', `Next post nav error: ${err.message} — falling back to direct`);
          result = await this.readArticle(article.url, article.title, { ...config, trafficPreference: 'direct' });
        }
      } else {
        const readConfig = useNextPost ? { ...config, keepPageOpen: true } : config;
        result = await this.readArticle(article.url, article.title, readConfig);
        // Keep the page open for next-post navigation on subsequent articles
        if (useNextPost && result && result.page) {
          activePage = result.page;
        }
      }

      results.push({ article, result });

      // Delay between articles
      if (i < articles.length - 1) {
        const delay = randomDelay(articleDelay * 700, articleDelay * 1300);
        this.log('info', `Waiting ${Math.round(delay / 1000)}s before next...`);
        await sleep(delay);
      }
    }

    this.status = 'completed';
    this.log('success', `Session done: ${this.articlesRead} articles, ${this.totalDwellTime}s total dwell`);
    return results;
  }

  async disconnect() {
    if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; this.context = null; }
    this.status = 'disconnected';
    this.log('info', 'Agent disconnected');
  }

  getStatus() {
    return {
      profileId: this.profileId,
      profileName: this.profileName,
      status: this.status,
      currentArticle: this.currentArticle,
      articlesRead: this.articlesRead,
      totalDwellTime: this.totalDwellTime,
      logs: this.logs.slice(-20),
    };
  }
}

module.exports = { ProfileAgent };
