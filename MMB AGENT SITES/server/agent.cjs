/**
 * Profile Agent — One agent per MoreLogin profile
 * Playwright CDP — Human-like article reading behavior
 *
 * FEATURES:
 * 1. Traffic Router: Google Search / Direct URL / Internal Link / Backlink
 * 2. Butter Smooth Scroll: sine wave speed, ad pause, unique per profile
 * 3. Ad Detection: pause on ad viewport — MMB zone-aware (NEVER click)
 * 4. Auto-recovery: retry on fail, skip unavailable
 * 5. Site-specific search queries (Mesothelioma/Law niche)
 * 6. Category-based read time calibration
 * 7. Multi-page related post sessions
 */

const { chromium } = require('playwright-core');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function humanType(page, text, speed = { min: 80, max: 200 }) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(speed.min, speed.max) });
    if (Math.random() < 0.06) await sleep(randomDelay(200, 600));
    // Longer pause after space (thinking between words)
    if (char === ' ' && Math.random() < 0.12) await sleep(randomDelay(150, 500));
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
// SITE-SPECIFIC CONFIG (MMB Publisher sites)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MMB_SITE_CONFIGS = {
  'hamstercombocard.com': {
    // Niche-specific search queries for natural-looking referrer traffic
    searchQueries: [
      'best mesothelioma lawyer 2025',
      'mesothelioma settlement amounts how much',
      'veterans mesothelioma attorney free case review',
      'mesothelioma compensation trust fund claims',
      'mesothelioma lawsuit how to file 2025',
      'asbestos exposure mesothelioma symptoms',
      'mesothelioma diagnosis what to do next',
      'mesothelioma treatment options survival rate',
      'top rated mesothelioma law firms',
      'mesothelioma average payout settlement',
      'how long mesothelioma lawsuit takes',
      'mesothelioma wrongful death claim attorney',
    ],
    // MMB Publisher theme ad zone CSS selectors
    adZoneSelectors: [
      '.ad-zone-in-content',
      '.ad-zone-before-content',
      '.ad-zone-after-content',
      '.ad-zone-sidebar',
      '.ad-zone-header',
      '.ad-zone-footer',
      'ins.adsbygoogle',
      '.adsense-wrap',
      'div[id*="adsense"]',
      'div[class*="ad-zone"]',
    ],
    // Read time ranges in MINUTES per article category
    categoryReadTimes: {
      mesothelioma: { min: 8,  max: 12 },
      law:          { min: 8,  max: 12 },
      insurance:    { min: 5,  max: 7  },
      finance:      { min: 4,  max: 6  },
      default:      { min: 5,  max: 10 },
    },
    // WP post IDs for the Mesothelioma articles — used for priority sorting
    priorityPostIds: [1209, 1210, 1211, 1212, 1213, 1214, 1215, 1216, 1217, 1218],
    siteUrl: 'https://hamstercombocard.com',
  }
};

function getSiteConfig(siteUrl) {
  if (!siteUrl) return null;
  try {
    const hostname = new URL(siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl).hostname.replace('www.', '');
    return MMB_SITE_CONFIGS[hostname] || null;
  } catch { return null; }
}

// Returns { min, max } in SECONDS for the article, based on URL keywords
function getReadTimeByCategory(articleUrl, siteUrl) {
  const siteConfig = getSiteConfig(siteUrl);
  if (!siteConfig) return null;
  const url = (articleUrl || '').toLowerCase();
  const cats = siteConfig.categoryReadTimes;
  if (url.includes('mesothelioma')) return { min: cats.mesothelioma.min * 60, max: cats.mesothelioma.max * 60 };
  if (url.includes('law') || url.includes('attorney') || url.includes('lawyer') || url.includes('legal'))
    return { min: cats.law.min * 60, max: cats.law.max * 60 };
  if (url.includes('insurance')) return { min: cats.insurance.min * 60, max: cats.insurance.max * 60 };
  if (url.includes('finance') || url.includes('financial') || url.includes('money'))
    return { min: cats.finance.min * 60, max: cats.finance.max * 60 };
  return { min: cats.default.min * 60, max: cats.default.max * 60 };
}

// Pick a random niche-specific query or fall back to generic
function pickSearchQuery(articleTitle, articleUrl, siteUrl) {
  const cfg = getSiteConfig(siteUrl);
  if (cfg && cfg.searchQueries && cfg.searchQueries.length > 0) {
    // 70% chance to use niche query; 30% use article title (mix for naturalness)
    if (Math.random() < 0.7) {
      return cfg.searchQueries[Math.floor(Math.random() * cfg.searchQueries.length)];
    }
  }
  // Generic fallback: articleTitle site:hostname
  try {
    return `${articleTitle} site:${new URL(articleUrl).hostname}`;
  } catch {
    return articleTitle;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUTTER SMOOTH SCROLL — Sine wave speed variation + MMB ad zone awareness
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function butterSmoothScroll(page, durationMs, config = {}, scrollProfile = null, siteConfig = null) {
  const profile = scrollProfile || { speedMult: 1.0, pauseChance: 0.03, sineFreq: 1.0, jitterRange: 0.3 };

  // Fixed pixels per step — based on speed setting, NOT dwell time
  // slow: 40px/step, medium: 90px/step, fast: 160px/step (at 60ms interval = px/s)
  const baseChunkPx = config.scrollSpeed === 'slow' ? 40
    : config.scrollSpeed === 'fast' ? 160 : 90;

  const adPauseMin = (config.adPauseDurationMin || 0.5) * 1000;
  const adPauseMax = (config.adPauseDurationMax || 2) * 1000;
  const stepInterval = 60;

  const baseAdSel = 'iframe[src*="ad"], iframe[id*="ad"], ins.adsbygoogle, div[class*="ad-"], div[class*="advertisement"]';
  const siteAdSel = siteConfig?.adZoneSelectors ? siteConfig.adZoneSelectors.join(', ') : '';
  const fullAdSel = siteAdSel ? `${baseAdSel}, ${siteAdSel}` : baseAdSel;

  let totalScrolled = 0;
  let adHitCount = 0;
  let stepCount = 0;
  const startTime = Date.now();

  while (true) {
    stepCount++;

    // Check position every step
    const pos = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight || document.body.scrollHeight,
      viewportH: window.innerHeight,
    })).catch(() => null);

    const atBottom = pos ? (pos.scrollY + pos.viewportH + 80) >= pos.scrollHeight : false;
    const elapsed = Date.now() - startTime;

    // Reached bottom — wait remaining dwell time then stop
    if (atBottom) {
      const remaining = durationMs - elapsed;
      if (remaining > 1000) {
        // Sit at bottom — human reads last section, occasionally scrolls tiny bit
        await sleep(Math.min(remaining, 5000));
        if (Math.random() < 0.3) {
          await page.mouse.wheel(0, -randomDelay(50, 150)).catch(() => {});
          await sleep(randomDelay(500, 1200));
          await page.mouse.wheel(0, randomDelay(30, 100)).catch(() => {});
        }
        // If still more time left, keep waiting in chunks
        const remaining2 = durationMs - (Date.now() - startTime);
        if (remaining2 > 1000) await sleep(remaining2);
      }
      break;
    }

    // Time cap — if dwell exceeded but not at bottom, nudge faster to reach bottom
    if (elapsed >= durationMs) {
      // Fast scroll to bottom
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })).catch(() => {});
      await sleep(1500);
      break;
    }

    // Sine wave variation on chunk size — natural feel
    const progress = Math.min(elapsed / durationMs, 1);
    const sine = 0.5 + Math.sin(progress * Math.PI * profile.sineFreq) * 0.5;
    const jitter = 1 + (Math.random() - 0.5) * profile.jitterRange;
    const chunk = Math.max(baseChunkPx * sine * jitter * profile.speedMult, 5);

    await page.mouse.wheel(0, chunk).catch(() => {});
    totalScrolled += chunk;
    await sleep(stepInterval + randomDelay(0, 20));

    // Random reading pause
    if (Math.random() < profile.pauseChance) {
      await sleep(randomDelay(600, 2500));
    }

    // Ad zone detection
    if (Math.random() < 0.02) {
      const adInfo = await page.evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.top >= 0 && rect.top < window.innerHeight && rect.height > 20) {
            const isHighValue = el.classList.contains('ad-zone-in-content') ||
                                el.classList.contains('ad-zone-before-content') ||
                                el.classList.contains('ad-zone-after-content');
            return { found: true, highValue: isHighValue };
          }
        }
        return { found: false, highValue: false };
      }, fullAdSel).catch(() => ({ found: false, highValue: false }));

      if (adInfo.found) {
        adHitCount++;
        const pauseMin = adInfo.highValue ? Math.max(adPauseMin, 2000) : adPauseMin;
        const pauseMax = adInfo.highValue ? Math.max(adPauseMax, 5000) : adPauseMax;
        await sleep(randomDelay(pauseMin, pauseMax));
        if (adInfo.highValue && Math.random() < 0.4) {
          await sleep(randomDelay(500, 1500));
        }
      }
    }

    if (Math.random() < 0.01) await humanMouseMove(page);
  }

  // Small pause at bottom before next action
  await sleep(randomDelay(1000, 2500));
  return { totalScrolled, adHitCount };
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

async function _searchAndNavigate(page, searchUrl, inputSel, articleUrl, articleTitle, siteUrl, typingSpeed) {
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

  // Use site-specific niche query or fallback to generic
  const query = pickSearchQuery(articleTitle, articleUrl, siteUrl);
  await humanType(page, query, typingSpeed || { min: 80, max: 200 });
  await sleep(randomDelay(500, 1200));
  await page.keyboard.press('Enter');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(randomDelay(2000, 5000));
  // Scroll results page a bit (human behavior)
  try { await page.mouse.wheel(0, randomDelay(80, 250)); } catch (_) {}
  await sleep(randomDelay(1000, 3000));
  // Try to find and click article link
  let result = null;
  try {
    result = await page.$(`a[href*="${new URL(articleUrl).pathname}"], a[href*="${new URL(articleUrl).hostname}"]`);
  } catch (_) {}
  if (result) {
    await humanMouseMove(page);
    await sleep(randomDelay(800, 2000));
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

async function openArticleByTraffic(page, articleUrl, articleTitle, trafficType, siteUrl, backlinkData, typingSpeed) {
  switch (trafficType) {
    case 'google':
      await _searchAndNavigate(page, 'https://www.google.com', 'input[name="q"], textarea[name="q"]', articleUrl, articleTitle, siteUrl, typingSpeed);
      return true;

    case 'bing':
      await _searchAndNavigate(page, 'https://www.bing.com', 'input[name="q"]', articleUrl, articleTitle, siteUrl, typingSpeed);
      return true;

    case 'duckduckgo':
      await _searchAndNavigate(page, 'https://duckduckgo.com', 'input[name="q"]', articleUrl, articleTitle, siteUrl, typingSpeed);
      return true;

    case 'yahoo':
      await _searchAndNavigate(page, 'https://search.yahoo.com', 'input[name="p"]', articleUrl, articleTitle, siteUrl, typingSpeed);
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
      let articleLink = null;
      try {
        articleLink = await page.$(`a[href*="${new URL(articleUrl).pathname}"]`);
      } catch (_) {}
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
        let blogLink = null;
        try {
          blogLink = await page.$(`a[href*="${new URL(articleUrl).hostname}"]`);
        } catch (_) {}
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
      return await openArticleByTraffic(page, articleUrl, articleTitle, picked, siteUrl, backlinkData, typingSpeed);
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

    // Deterministic personality seeded from profileId — same profile = same behavior every run
    const seed = String(profileId).split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0x811c9dc5);
    const seededRand = (n) => { let s = (seed ^ n) >>> 0; s = Math.imul(s ^ (s >>> 16), 0x45d9f3b); s = Math.imul(s ^ (s >>> 16), 0x45d9f3b); return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff; };

    const scrollType = seededRand(1);
    if (scrollType < 0.3) {
      // Slow / careful reader (30%)
      this.scrollProfile = { speedMult: 0.65, pauseChance: 0.06, sineFreq: 0.75, jitterRange: 0.45 };
      this.typingSpeed  = { min: 120, max: 280 };
    } else if (scrollType < 0.7) {
      // Normal reader (40%)
      this.scrollProfile = { speedMult: 1.0, pauseChance: 0.03, sineFreq: 1.0, jitterRange: 0.3 };
      this.typingSpeed  = { min: 70, max: 170 };
    } else {
      // Fast / skimming reader (30%)
      this.scrollProfile = { speedMult: 1.35, pauseChance: 0.015, sineFreq: 1.3, jitterRange: 0.2 };
      this.typingSpeed  = { min: 40, max: 110 };
    }

    // Unique re-read chance and bounce chance — seeded
    this.reReadChance  = 0.2 + seededRand(2) * 0.3;  // 20–50% chance to scroll up mid-article
    this.bounceChance  = 0.05 + seededRand(3) * 0.1; // 5–15% chance to leave early
    this.adPauseStyle  = seededRand(4) < 0.5 ? 'short' : 'long';
  }

  log(level, message) {
    const entry = { time: new Date().toISOString(), level, message, profileId: this.profileId };
    this.logs.push(entry);
    if (this.logs.length > 50) this.logs = this.logs.slice(-50);
    console.log(`[${this.profileName}] [${level}] ${message}`);
    return entry;
  }

  // Warmup: browse homepage briefly before first article (like a real user arriving on the site)
  async warmup(siteUrl) {
    if (this._warmedUp || !siteUrl || !this.context) return;
    this._warmedUp = true;
    try {
      const page = await this.context.newPage();
      const base = siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl;
      this.log('info', `Warmup: browsing homepage ${base}`);
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await sleep(randomDelay(2000, 5000));
      // Scroll homepage a bit (browsing)
      await page.mouse.wheel(0, randomDelay(200, 500)).catch(() => {});
      await sleep(randomDelay(1500, 3500));
      // 40% chance: scroll back up (checking header/menu)
      if (Math.random() < 0.4) {
        await page.mouse.wheel(0, -randomDelay(100, 200)).catch(() => {});
        await sleep(randomDelay(800, 2000));
      }
      await humanMouseMove(page);
      await sleep(randomDelay(1000, 2500));
      await page.close().catch(() => {});
      this.log('info', 'Warmup complete');
    } catch (err) {
      this.log('warn', `Warmup skipped: ${err.message}`);
    }
  }

  async connect() {
    this.status = 'connecting';
    this.log('info', `Connecting to CDP at http://127.0.0.1:${this.debugPort}...`);
    try {
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`, { timeout: 60000 });
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

    // Resolve site config for this article
    const siteConfig = getSiteConfig(config.siteUrl);

    // Read time: user settings take priority, category times are fallback only
    let readTimeMin = (config.readTimeMin || 0) * 1000;
    let readTimeMax = (config.readTimeMax || 0) * 1000;
    if (!readTimeMin || !readTimeMax) {
      // No user setting — use category defaults
      const catTimes = siteConfig ? getReadTimeByCategory(articleUrl, config.siteUrl) : null;
      readTimeMin = catTimes ? catTimes.min * 1000 : 60 * 1000;
      readTimeMax = catTimes ? catTimes.max * 1000 : 180 * 1000;
      this.log('info', `Category read time: ${Math.round(readTimeMin/60000)}-${Math.round(readTimeMax/60000)} min`);
    } else {
      this.log('info', `Profile read time: ${Math.round(readTimeMin/60000)}-${Math.round(readTimeMax/60000)} min`);
    }

    let page;
    try {
      // Warmup homepage on first article of session (only once)
      if (!this._warmedUp && config.siteUrl) {
        await this.warmup(config.siteUrl);
      }

      page = await this.context.newPage();

      // Start delay (unique per profile)
      const startDelay = randomDelay((config.startDelayMin || 5) * 1000, (config.startDelayMax || 30) * 1000);
      await sleep(startDelay);

      // Navigate using traffic router — pass per-profile typing speed
      const opened = await openArticleByTraffic(page, articleUrl, articleTitle, trafficType, config.siteUrl, null, this.typingSpeed);
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

      // Random read time within category bounds
      const readTime = randomDelay(readTimeMin, readTimeMax);

      // Wait for page to render
      await sleep(randomDelay(1000, 2000));

      // Early bounce — some profiles leave before finishing (realistic human behavior)
      let actualReadTime = readTime;
      if (Math.random() < this.bounceChance) {
        actualReadTime = Math.floor(readTime * (0.2 + Math.random() * 0.35));
        this.log('info', `Early bounce: reading only ${Math.round(actualReadTime/1000)}s of ${Math.round(readTime/1000)}s`);
      }

      // BUTTER SMOOTH SCROLL — with per-profile curve + site-specific ad zone awareness
      const scrollResult = await butterSmoothScroll(page, actualReadTime, config, this.scrollProfile, siteConfig);

      // Per-profile re-read: scroll back up mid-article (like re-checking something)
      if (Math.random() < this.reReadChance && actualReadTime === readTime) {
        const scrollUpPx = randomDelay(150, 500);
        await page.mouse.wheel(0, -scrollUpPx).catch(() => {});
        await sleep(randomDelay(1500, 4000)); // pause — as if re-reading
        await page.mouse.wheel(0, scrollUpPx * 0.6).catch(() => {}); // scroll back down partially
        await sleep(randomDelay(500, 1500));
      }

      // End-of-article scroll up (finishing, checking something again)
      if (Math.random() < 0.28) {
        await page.mouse.wheel(0, -randomDelay(80, 250)).catch(() => {});
        await sleep(randomDelay(800, 2500));
      }

      const dwellSeconds = Math.round(readTime / 1000);
      this.articlesRead++;
      this.totalDwellTime += dwellSeconds;

      const adHits = scrollResult?.adHitCount || 0;
      this.log('success', `Finished: "${articleTitle}" (${dwellSeconds}s dwell, ${trafficType}, ${adHits} ad pauses)`);

      // Keep page open if caller wants to use it for next-post or related-post navigation
      if (!config.keepPageOpen) await page.close();
      return { dwellTime: dwellSeconds, trafficSource: trafficType, adHitCount: adHits, page: config.keepPageOpen ? page : null };
    } catch (err) {
      const fs = require('fs');
      const logPath = require('path').join(require('os').tmpdir(), 'agent_errors.log');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${this.profileName} | "${articleTitle}" | ERR: ${err.message}\n  Stack: ${err.stack}\n`);
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
      const nextSelectors = [
        'a[rel="next"]',
        '.nav-next a', '.next-post a', '.post-nav-next a',
        'a.next', 'a.next-post', 'a.nextpostslink',
        '[class*="next"] a[href*="/"]',
        'a[href][class*="next"]',
        '.navigation .next a', '#nav-below .nav-next a',
        '.post-navigation .nav-next a',
        '.posts-navigation .nav-next a',
        'a:has-text("Next Post")', 'a:has-text("Next Article")',
        'a:has-text("→")', 'a:has-text("»")',
        'a:has-text("Next")',
      ];
      const currentUrl = page.url();
      for (const sel of nextSelectors) {
        const el = await page.$(sel).catch(() => null);
        if (!el) continue;
        const href = await el.getAttribute('href').catch(() => null);
        if (!href) continue;
        // Accept both absolute URLs and relative paths (WordPress often uses relative)
        const isValid = href.startsWith('http') || href.startsWith('/');
        if (!isValid) continue;
        // Skip if it's the same page (pagination links sometimes point to current)
        const resolvedUrl = href.startsWith('http') ? href : new URL(href, currentUrl).href;
        if (resolvedUrl === currentUrl) continue;

        await el.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(randomDelay(600, 1200));
        await humanMouseMove(page);
        await sleep(randomDelay(400, 900));
        await el.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await sleep(randomDelay(1000, 2000));
        return page.url();
      }
    } catch (_) {}
    return null;
  }

  // Click a related/recommended post (for multi-page sessions)
  async _clickRelatedPost(page, siteHostname) {
    try {
      const relatedSelectors = [
        '.related-posts a[href]',
        '.related-articles a[href]',
        '.yarpp-related a[href]',
        '[class*="related"] a[href]',
        '[class*="recommended"] a[href]',
        '.post-tags ~ * a[href]',
        '.entry-footer a[href]',
        '.more-from-category a[href]',
      ];

      for (const sel of relatedSelectors) {
        const els = await page.$$(sel).catch(() => []);
        const valid = [];
        for (const el of els) {
          const href = await el.getAttribute('href').catch(() => null);
          if (href && siteHostname && href.includes(siteHostname) && !href.includes('#')) {
            valid.push({ el, href });
          }
        }
        if (valid.length > 0) {
          // Pick a random one
          const pick = valid[Math.floor(Math.random() * valid.length)];
          await humanMouseMove(page);
          await sleep(randomDelay(1200, 2500));
          await pick.el.scrollIntoViewIfNeeded().catch(() => {});
          await sleep(randomDelay(500, 1000));
          await pick.el.click().catch(() => {});
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await sleep(randomDelay(1000, 2000));
          return page.url();
        }
      }
    } catch (_) {}
    return null;
  }

  // Run one site's articles in a single tab — used by runSession for multi-tab support
  async _runSiteTab(siteArticles, config, siteUrl) {
    const useNextPost = config.useNextPost === true;
    const multiPageSession = config.multiPageSession !== false;
    const maxRelatedPages = config.maxRelatedPages || 3;
    const siteConfig = getSiteConfig(siteUrl);
    const siteHostname = siteUrl ? (() => { try { return new URL(siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl).hostname; } catch { return ''; } })() : '';
    const results = [];
    let activePage = null;

    for (let i = 0; i < siteArticles.length; i++) {
      const article = siteArticles[i];
      this.log('info', `[Tab:${siteHostname || 'site'}] [${i + 1}/${siteArticles.length}] ${article.title}`);

      const readConfig = { ...config, siteUrl, keepPageOpen: true };
      const result = await this.readArticle(article.url, article.title, readConfig);
      if (result && result.page) activePage = result.page;

      // Next post navigation
      if (useNextPost && activePage) {
        const nextPostPages = Math.random() < 0.6 ? 1 : 2;
        for (let np = 0; np < nextPostPages; np++) {
          try {
            const nextUrl = await this._clickNextPost(activePage);
            if (nextUrl && nextUrl !== 'about:blank' && nextUrl !== article.url) {
              this.log('info', `[Tab:${siteHostname}] Next post → ${nextUrl}`);
              this.currentArticle = nextUrl;
              this.status = 'reading';
              const npMin = (config.readTimeMin || 60) * 1000;
              const npMax = (config.readTimeMax || 180) * 1000;
              const npReadTime = randomDelay(npMin, npMax);
              await sleep(randomDelay(800, 1600));
              await butterSmoothScroll(activePage, npReadTime, config, this.scrollProfile, siteConfig);
              if (Math.random() < 0.3) {
                await activePage.mouse.wheel(0, -randomDelay(100, 300)).catch(() => {});
                await sleep(randomDelay(800, 1800));
              }
              const npDwell = Math.round(npReadTime / 1000);
              this.articlesRead++;
              this.totalDwellTime += npDwell;
              this.log('success', `[Tab:${siteHostname}] Next post read: ${npDwell}s`);
            } else {
              break;
            }
          } catch { break; }
        }
      }

      // Related posts
      if (multiPageSession && activePage && result) {
        const extraPages = randomDelay(1, maxRelatedPages);
        for (let r = 0; r < extraPages; r++) {
          try {
            const relatedUrl = await this._clickRelatedPost(activePage, siteHostname);
            if (relatedUrl && relatedUrl !== 'about:blank') {
              this.log('info', `[Tab:${siteHostname}] Related ${r + 1}: ${relatedUrl}`);
              const baseMin = (config.readTimeMin || 60) * 1000;
              const baseMax = (config.readTimeMax || 180) * 1000;
              const relReadTime = randomDelay(Math.floor(baseMin * 0.3), Math.floor(baseMax * 0.6));
              await sleep(randomDelay(800, 1500));
              await butterSmoothScroll(activePage, relReadTime, config, this.scrollProfile, siteConfig);
              this.totalDwellTime += Math.round(relReadTime / 1000);
              await sleep(randomDelay(1000, 3000));
            } else { break; }
          } catch { break; }
        }
      }

      results.push({ article, result });

      if (i < siteArticles.length - 1) {
        const delay = randomDelay((config.articleDelay || 30) * 700, (config.articleDelay || 30) * 1300);
        await sleep(delay);
      }
    }

    if (activePage) await activePage.close().catch(() => {});
    return results;
  }

  async runSession(articles, config = {}) {
    this.status = 'running';
    this.log('info', `Session starting: ${articles.length} articles`);

    // Group articles by site — each site gets its own tab
    const siteGroups = new Map();
    for (const article of articles) {
      let siteKey = '';
      try {
        siteKey = article.siteUrl
          ? new URL(article.siteUrl.startsWith('http') ? article.siteUrl : 'https://' + article.siteUrl).hostname
          : new URL(article.url).hostname;
      } catch { siteKey = article.siteUrl || 'default'; }
      if (!siteGroups.has(siteKey)) siteGroups.set(siteKey, { siteUrl: article.siteUrl || '', articles: [] });
      siteGroups.get(siteKey).articles.push(article);
    }

    const sites = Array.from(siteGroups.values());
    this.log('info', `Sites: ${sites.length} — opening ${sites.length} tab(s) in parallel`);

    // Warmup once before all tabs start (on first site)
    if (!this._warmedUp && sites[0]?.siteUrl) {
      await this.warmup(sites[0].siteUrl);
    }

    // Run all site tabs in parallel — one tab per site
    const allResults = await Promise.all(
      sites.map(({ siteUrl, articles: siteArticles }) =>
        this._runSiteTab(siteArticles, config, siteUrl)
      )
    );

    const results = allResults.flat();
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

module.exports = { ProfileAgent, MMB_SITE_CONFIGS, getSiteConfig, getReadTimeByCategory };
