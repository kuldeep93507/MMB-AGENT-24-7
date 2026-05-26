'use strict';

/**
 * HighCPCCookieWarmer — Interest/cookie warmup for QA browsing behavior.
 *
 * 1. MLX cookie metadata (mix = Google + Amazon + Facebook high-CPC pool)
 * 2. Optional live bake: start profile → visit high-RPM sites → seed PREF/CONSENT → stop
 *
 * Toggle: highRpmCookieWarmupEnabled in user-settings.json (default: OFF).
 *
 * @module HighCPCCookieWarmer
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { MultiloginCookiesService } = require('./MultiloginCookiesService.cjs');

/** MLX cookies API official targets (live from cookies.multilogin.com) */
const MLX_COOKIE_TARGETS = ['mix', 'google', 'amazon', 'facebook', 'ebay', 'etsy', 'bing'];

/**
 * USA/UK high RPM/CPM finance, loan, insurance, mortgage, banking interest sites.
 * Grouped into categories; per-profile random selection prevents identical visit order.
 */
const FINANCE_WARMUP_POOL = {
  loans: [
    'https://www.bankrate.com/loans/personal-loans/best-personal-loans/',
    'https://www.nerdwallet.com/personal-loans',
    'https://www.creditkarma.com/personal-loans',
    'https://www.lendingtree.com/personal/',
  ],
  mortgage: [
    'https://www.bankrate.com/mortgages/',
    'https://www.zillow.com/mortgage-rates/',
    'https://www.nerdwallet.com/mortgages',
    'https://www.realtor.com/mortgage/',
  ],
  insurance: [
    'https://www.policygenius.com/',
    'https://www.insurify.com/',
    'https://www.comparethemarket.com/car-insurance/',
    'https://www.confused.com/car-insurance',
  ],
  creditCards: [
    'https://www.nerdwallet.com/best/credit-cards',
    'https://www.bankrate.com/credit-cards/',
    'https://www.creditkarma.com/credit-cards',
  ],
  investment: [
    'https://www.investopedia.com/best-online-brokers-4587872',
    'https://www.nerdwallet.com/best/investing/online-brokers-for-stock-trading',
    'https://www.fool.com/best-stock-brokers/',
  ],
  tax: [
    'https://www.turbotax.com/',
    'https://www.hrblock.com/',
    'https://www.irs.gov/filing',
  ],
  banking: [
    'https://www.bankrate.com/banking/savings/best-high-yield-interests-savings-accounts/',
    'https://www.nerdwallet.com/best/banking/savings-accounts',
    'https://www.moneysavingexpert.com/savings/savings-accounts-best-interest/',
  ],
  finance_search: [
    'https://www.google.com/search?q=best+personal+loan+rates+2026&hl=en&gl=us',
    'https://www.google.com/search?q=compare+life+insurance+quotes+usa&hl=en&gl=us',
    'https://www.google.com/search?q=mortgage+rates+today+uk&hl=en&gl=gb',
    'https://www.google.com/search?q=best+credit+cards+cashback+2026&hl=en&gl=us',
    'https://www.google.com/search?q=investment+account+uk+best&hl=en&gl=gb',
  ],
};

/** Flatten all sites into a single pool for random selection */
const ALL_FINANCE_SITES = Object.values(FINANCE_WARMUP_POOL).flat();

/**
 * Fisher-Yates shuffle with optional seed derived from profileId+date.
 * Not cryptographic — just per-profile variation.
 */
function shuffledPool(pool, profileId) {
  const arr = [...pool];
  // Simple deterministic seed from profileId chars + today's date (day granularity)
  const dateTag = new Date().toISOString().slice(0, 10);
  const seedStr = (profileId || '') + dateTag;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 17), 0x45d9f3b) | 0;
    const j = ((h >>> 0) % (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * High CPC / RPM / CPM — original visit URLs (used for live bake when enabled).
 * Now includes finance pool; random subset is selected per profile.
 */
const HIGH_CPC_VISIT_URLS = [
  'https://www.google.com/search?q=best+tech+deals+2026&hl=en&gl=us',
  'https://www.youtube.com/?hl=en&gl=US',
  'https://www.amazon.com/',
  'https://www.facebook.com/',
  'https://www.ebay.com/',
  'https://www.bing.com/',
  'https://www.youtube.com/results?search_query=personal+loan+interest+rates+2026',
  'https://www.youtube.com/results?search_query=car+insurance+quotes+comparison',
  'https://www.youtube.com/results?search_query=home+loan+mortgage+rates+usa',
  'https://www.youtube.com/results?search_query=credit+score+improve+tips',
  'https://www.google.com/search?q=compare+life+insurance+rates&hl=en&gl=us',
  'https://www.creditkarma.com/',
  'https://www.bankrate.com/',
  'https://www.nerdwallet.com/',
];

const SETTINGS_FILE = path.resolve(__dirname, '..', '..', 'user-settings.json');

function loadWarmupSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { enabled: false, visitMin: 3, visitMax: 5 };
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const enabled = s.highRpmCookieWarmupEnabled === true || s.highRpmCookieWarmupEnabled === 'true';
    const visitMin = Math.max(1, parseInt(s.warmupVisitCountMin, 10) || 3);
    const visitMax = Math.max(visitMin, parseInt(s.warmupVisitCountMax, 10) || 5);
    return { enabled, visitMin, visitMax };
  } catch {
    return { enabled: false, visitMin: 3, visitMax: 5 };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isEnabled() {
  // Primary: check user-settings.json toggle
  const settings = loadWarmupSettings();
  if (!settings.enabled) return false;
  // Secondary: env var can still forcibly disable
  const v = process.env.COOKIE_WARM_ON_CREATE;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

class HighCPCCookieWarmer {
  constructor(provider) {
    this.provider = provider;
    this.cookiesSvc = new MultiloginCookiesService();
  }

  /**
   * Register ALL MLX cookie metadata targets at profile create time.
   * mix = finance/shopping/misc high-CPC pool (not just Google/Amazon/FB).
   */
  async applyMetadata(profileId) {
    let ok = false;
    let message = '';

    const mix = await this.cookiesSvc.createCookieMetadata(profileId, 'mix');
    if (mix.code === 0) {
      ok = true;
      // Primary: google + amazon (YouTube RPM + shopping ads)
      await this.cookiesSvc.updateCookieMetadata(profileId, 'google', 'amazon').catch(() => {});
      // Secondary: facebook via another update (MLX allows one additional_website per call)
      await this.cookiesSvc.updateCookieMetadata(profileId, 'google', 'facebook').catch(() => {});
      message = 'mix + google/amazon/facebook + finance pool (mix)';
    } else {
      const google = await this.cookiesSvc.createCookieMetadata(profileId, 'google');
      ok = google.code === 0;
      if (ok) {
        await this.cookiesSvc.updateCookieMetadata(profileId, 'google', 'amazon').catch(() => {});
        message = 'google + amazon fallback';
      } else {
        message = mix.message || google.message || 'metadata failed';
      }
    }

    return { ok, targets: MLX_COOKIE_TARGETS, message };
  }

  /**
   * Seed US high-RPM preference cookies + browse interest sites once.
   * Cloud profiles only — cookies persist after stop.
   *
   * Uses per-profile randomized selection from FINANCE_WARMUP_POOL.
   *
   * @param {string} profileId
   * @param {object} [opts]
   * @param {boolean} [opts.cloudOnly=true]
   * @returns {Promise<{baked: boolean, sitesVisited: string[], cookieCount: number, error?: string}>}
   */
  async bakeLiveSession(profileId, opts = {}) {
    const warmupSettings = loadWarmupSettings();
    if (!warmupSettings.enabled) {
      console.log(`[CookieWarmup] skipped: disabled (highRpmCookieWarmupEnabled=false)`);
      return { baked: false, sitesVisited: [], cookieCount: 0, error: 'highRpmCookieWarmupEnabled disabled' };
    }

    const cloudOnly = opts.cloudOnly !== false;
    if (cloudOnly && opts.profileMode === 'quick') {
      console.log(`[CookieWarmup] skipped: quick profile mode`);
      return { baked: false, sitesVisited: [], cookieCount: 0, error: 'quick profile — skip live bake' };
    }

    // Per-profile randomized site selection
    const shuffled = shuffledPool(ALL_FINANCE_SITES, profileId);
    const visitCount = warmupSettings.visitMin + Math.floor(Math.random() * (warmupSettings.visitMax - warmupSettings.visitMin + 1));
    const urlsToVisit = shuffled.slice(0, visitCount);

    const country = (opts.country || 'US').toUpperCase();
    console.log(`[CookieWarmup] profile ${profileId.slice(0, 8)}… selected country ${country}`);
    console.log(`[CookieWarmup] will visit ${urlsToVisit.length} sites: ${urlsToVisit.map((u, i) => `${i + 1}/${urlsToVisit.length}: ${u.replace(/^https?:\/\//, '').split('/')[0]}`).join(', ')}`);

    let browser;
    const sitesVisited = [];

    try {
      const start = await this.provider.startProfile(profileId);
      if (start.code !== 0 || !start.data?.cdpPort) {
        return {
          baked: false,
          sitesVisited,
          cookieCount: 0,
          error: start.message || 'Could not start profile for cookie bake',
        };
      }

      const port = start.data.cdpPort;
      await sleep(5000);

      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 45000 });
      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      await this._seedHighRPMCookies(context);

      for (let idx = 0; idx < urlsToVisit.length; idx++) {
        const url = urlsToVisit[idx];
        console.log(`[CookieWarmup] visiting site/query ${idx + 1}/${urlsToVisit.length}: ${url.replace(/^https?:\/\//, '').split('/')[0]}`);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
          await sleep(randomDelay(5000, 12000));
          if (url.includes('youtube.com')) {
            await page.evaluate(() => {
              window.scrollBy(0, 300 + Math.random() * 400);
              document.cookie = 'PREF=f6=400&f7=100&hl=en&gl=US; path=/; domain=.youtube.com; max-age=31536000; Secure';
            }).catch(() => {});
            await sleep(randomDelay(2000, 4000));
          } else {
            await page.evaluate(() => { window.scrollBy(0, 200 + Math.random() * 400); }).catch(() => {});
            await sleep(randomDelay(3000, 7000));
          }
          sitesVisited.push(url);
        } catch (err) {
          console.warn(`[CookieWarmup] Skip ${url.replace(/^https?:\/\//, '').split('/')[0]}: ${err.message}`);
        }
      }

      const cookies = await context.cookies();
      const cookieCount = cookies.length;

      await this.provider.stopProfile(profileId);
      await sleep(3000);

      console.log(
        `[CookieWarmup] complete — ${profileId.slice(0, 8)}… — ${sitesVisited.length} sites visited, ${cookieCount} cookies stored`
      );

      return { baked: true, sitesVisited, cookieCount };
    } catch (err) {
      await this.provider.stopProfile(profileId).catch(() => {});
      return { baked: false, sitesVisited, cookieCount: 0, error: err.message };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  /**
   * Full pipeline: metadata + live bake.
   * @param {string} profileId
   * @param {object} [opts]
   */
  async warmOnCreate(profileId, opts = {}) {
    const meta = await this.applyMetadata(profileId);
    let bake = { baked: false, sitesVisited: [], cookieCount: 0 };

    if (meta.ok && opts.profileMode !== 'quick') {
      bake = await this.bakeLiveSession(profileId, opts);
    }

    return {
      metadataSet: meta.ok,
      metadataTargets: meta.targets,
      metadataMessage: meta.message,
      liveBake: bake.baked,
      sitesVisited: bake.sitesVisited,
      cookieCount: bake.cookieCount,
      bakeError: bake.error,
    };
  }

  /** US English ad-preference + consent seeds (safe, no fake auth tokens). */
  async _seedHighRPMCookies(context) {
    const now = Math.floor(Date.now() / 1000);
    const expires = now + 365 * 24 * 3600;
    const consentVal = `YES+cb.${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-00-p0.en+FX+${randomDelay(100, 999)}`;

    const seeds = [
      { name: 'PREF', value: 'f6=400&f7=100&hl=en&gl=US', domain: '.youtube.com', path: '/', expires, secure: true, sameSite: 'Lax' },
      { name: 'PREF', value: 'f6=400&hl=en&gl=US', domain: '.google.com', path: '/', expires, secure: true, sameSite: 'Lax' },
      { name: 'CONSENT', value: consentVal, domain: '.google.com', path: '/', expires, secure: true, sameSite: 'Lax' },
      { name: 'CONSENT', value: consentVal, domain: '.youtube.com', path: '/', expires, secure: true, sameSite: 'Lax' },
      { name: 'SOCS', value: 'CAISNQgAEhJndGlyX2Jrc19kZXNrcF9yb29tEiwKCC9KAw', domain: '.google.com', path: '/', expires, secure: true, sameSite: 'Lax' },
    ];

    try {
      await context.addCookies(seeds);
    } catch (err) {
      console.warn(`[HighCPCCookieWarmer] Seed cookies partial: ${err.message}`);
    }
  }
}

module.exports = { HighCPCCookieWarmer, HIGH_CPC_VISIT_URLS, MLX_COOKIE_TARGETS, FINANCE_WARMUP_POOL, ALL_FINANCE_SITES, isEnabled, loadWarmupSettings };
