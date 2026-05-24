/**
 * Profile Agent — One agent per browser profile
 * Playwright CDP — Human-like article reading
 *
 * PERSONA SYSTEM (5 types, seeded from profileId):
 *  1. Researcher    — very slow, re-reads paragraphs, text-selects key points, 1-2 deep articles
 *  2. Casual        — medium speed, distracted, tabs out, reads 2-4 articles
 *  3. Skimmer       — fast scroll, reads headlines, quick bounce, 3-5 articles shallow
 *  4. Deep Diver    — slowest, reads comments, follows every related link, 1-2 articles
 *  5. Mobile User   — burst scrolling, long pauses, jumps around
 *
 * READING RHYTHM (3 phases per article):
 *  INTRO  (0–20% scroll) → FAST   (skim to decide if worth reading)
 *  BODY   (20–80% scroll) → SLOW  (actually reading — this is where ads show)
 *  OUTRO  (80–100% scroll) → MED  (skim conclusion/comments)
 *
 * SESSION INTENT (chosen at session start):
 *  research   → reads 1-2 articles deeply, searches Google first
 *  casual     → reads 2-4 articles normally
 *  discovery  → follows related links, 4-6 articles fast
 */

'use strict';
const { chromium } = require('playwright-core');
const { AIBrain }  = require('./AIBrain.cjs');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clamp(val, lo, hi) { return Math.max(lo, Math.min(hi, val)); }

async function humanType(page, text, speed = { min: 80, max: 200 }) {
  const words = text.split(' ');
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      // Ease in/out within each word — slower at start and end
      const wordProgress = word.length > 1 ? i / (word.length - 1) : 0.5;
      const speedMult = 1.0 - 0.3 * Math.sin(wordProgress * Math.PI);
      const delay = Math.round(randomDelay(speed.min, speed.max) * speedMult);

      // Rare typo + backspace correction (~1.5% per char)
      if (Math.random() < 0.015 && char !== ' ') {
        const adjacent = 'qwertyuiopasdfghjklzxcvbnm';
        await page.keyboard.type(adjacent[Math.floor(Math.random() * adjacent.length)], { delay });
        await sleep(randomDelay(90, 280));
        await page.keyboard.press('Backspace');
        await sleep(randomDelay(40, 120));
      }

      await page.keyboard.type(char, { delay });
      if (Math.random() < 0.04) await sleep(randomDelay(250, 700)); // thinking pause
    }
    // Space between words with short pause rhythm
    if (wi < words.length - 1) {
      await page.keyboard.type(' ', { delay: randomDelay(Math.round(speed.min * 0.6), Math.round(speed.max * 0.6)) });
      if (Math.random() < 0.18) await sleep(randomDelay(120, 500)); // natural word-boundary pause
    }
  }
  await sleep(randomDelay(200, 500));
}

// Cubic bezier point for t in [0,1]
function bezierPt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return Math.round(u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3);
}

// Human-like mouse movement via bezier curve — no straight lines
async function humanMouseMove(page) {
  // Start from approximate center (we don't track exact cursor position)
  const vpSize = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })).catch(() => ({ w: 1280, h: 720 }));
  const sx = randomDelay(200, Math.max(300, vpSize.w - 200));
  const sy = randomDelay(100, Math.max(200, vpSize.h - 150));
  const tx = randomDelay(100, Math.max(300, vpSize.w - 100));
  const ty = randomDelay(80, Math.max(150, vpSize.h - 100));

  // Random bezier control points for natural curve shape
  const cp1x = sx + (tx - sx) * (0.2 + Math.random() * 0.3) + randomDelay(-80, 80);
  const cp1y = sy + randomDelay(-120, 120);
  const cp2x = sx + (tx - sx) * (0.6 + Math.random() * 0.3) + randomDelay(-60, 60);
  const cp2y = ty + randomDelay(-100, 100);

  const steps = randomDelay(16, 28);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = bezierPt(sx, cp1x, cp2x, tx, t);
    const y = bezierPt(sy, cp1y, cp2y, ty, t);
    await page.mouse.move(x, y).catch(() => {});
    // Ease in/out timing — faster mid-move, slower at start/end
    const ease = 0.4 + Math.sin(t * Math.PI) * 0.6;
    await sleep(Math.round(randomDelay(6, 14) / ease));
  }
  await sleep(randomDelay(60, 220));
}

// Dismiss cookie banners, newsletter popups, overlays — human-like delay first
async function dismissOverlays(page) {
  const selectors = [
    'button[id*="accept-cookie"], button[class*="accept-cookie"], .cc-accept, .cc-dismiss',
    '[aria-label*="Accept cookies"], [aria-label*="accept cookies"]',
    '#cookieConsentButton, #cookie-accept, .cookie-accept-btn',
    '.popup-close, .modal-close, [class*="close-popup"], [class*="popup-close"]',
    'button[aria-label="Close"], button[title="Close"]',
    'button:has-text("No thanks"), button:has-text("No, thanks")',
    'button:has-text("Decline"), button:has-text("Reject")',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel).catch(() => null);
      if (!el) continue;
      const visible = await el.isVisible().catch(() => false);
      if (visible) {
        await sleep(randomDelay(600, 1800)); // human notices it, then dismisses
        await el.click().catch(() => {});
        await sleep(randomDelay(300, 800));
        break; // usually only one overlay at a time
      }
    } catch {}
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SITE CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MMB_SITE_CONFIGS = {
  'hamstercombocard.com': {
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
    adZoneSelectors: [
      '.ad-zone-in-content', '.ad-zone-before-content', '.ad-zone-after-content',
      '.ad-zone-sidebar', '.ad-zone-header', '.ad-zone-footer',
      'ins.adsbygoogle', '.adsense-wrap', 'div[id*="adsense"]', 'div[class*="ad-zone"]',
    ],
    categoryReadTimes: {
      mesothelioma: { min: 8,  max: 12 },
      law:          { min: 8,  max: 12 },
      insurance:    { min: 5,  max: 7  },
      finance:      { min: 4,  max: 6  },
      default:      { min: 5,  max: 10 },
    },
    priorityPostIds: [1209,1210,1211,1212,1213,1214,1215,1216,1217,1218],
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

function getReadTimeByCategory(articleUrl, siteUrl) {
  const cfg = getSiteConfig(siteUrl);
  if (!cfg) return null;
  const url = (articleUrl || '').toLowerCase();
  const cats = cfg.categoryReadTimes;
  if (url.includes('mesothelioma')) return { min: cats.mesothelioma.min * 60, max: cats.mesothelioma.max * 60 };
  if (url.includes('law') || url.includes('attorney') || url.includes('lawyer') || url.includes('legal'))
    return { min: cats.law.min * 60, max: cats.law.max * 60 };
  if (url.includes('insurance')) return { min: cats.insurance.min * 60, max: cats.insurance.max * 60 };
  if (url.includes('finance') || url.includes('financial') || url.includes('money'))
    return { min: cats.finance.min * 60, max: cats.finance.max * 60 };
  return { min: cats.default.min * 60, max: cats.default.max * 60 };
}

function pickSearchQuery(articleTitle, articleUrl, siteUrl) {
  const cfg = getSiteConfig(siteUrl);
  if (cfg?.searchQueries?.length > 0 && Math.random() < 0.7) {
    return cfg.searchQueries[Math.floor(Math.random() * cfg.searchQueries.length)];
  }
  try { return `${articleTitle} site:${new URL(articleUrl).hostname}`; }
  catch { return articleTitle; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERSONA DEFINITIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PERSONAS = [
  {
    name: 'Researcher',
    // Slow, methodical — highlights text, scrolls back to re-read
    scrollSpeed:   { slow: 30, body: 55, fast: 100 },  // px per step per phase
    stepInterval:  80,
    pauseChance:   0.08,  // 8% chance to pause mid-scroll
    pauseDuration: { min: 1500, max: 5000 },
    bounceChance:  0.03,
    reReadChance:  0.6,   // often scrolls back up
    typingSpeed:   { min: 100, max: 240 },
    tabOutChance:  0.05,  // rarely leaves page
    commentChance: 0.4,   // often reads comments
    microFreq:     8,     // micro-interactions every 8 steps
    jitterRange:   0.35,
  },
  {
    name: 'Casual',
    scrollSpeed:   { slow: 60, body: 90, fast: 150 },
    stepInterval:  65,
    pauseChance:   0.04,
    pauseDuration: { min: 800, max: 3000 },
    bounceChance:  0.10,
    reReadChance:  0.25,
    typingSpeed:   { min: 70, max: 180 },
    tabOutChance:  0.12,  // checks other tabs sometimes
    commentChance: 0.2,
    microFreq:     12,
    jitterRange:   0.30,
  },
  {
    name: 'Skimmer',
    scrollSpeed:   { slow: 100, body: 150, fast: 220 },
    stepInterval:  50,
    pauseChance:   0.015,
    pauseDuration: { min: 300, max: 1200 },
    bounceChance:  0.20,  // often leaves early
    reReadChance:  0.08,
    typingSpeed:   { min: 40, max: 110 },
    tabOutChance:  0.08,
    commentChance: 0.05,  // skimmers don't read comments
    microFreq:     20,
    jitterRange:   0.20,
  },
  {
    name: 'DeepDiver',
    scrollSpeed:   { slow: 20, body: 40, fast: 80 },
    stepInterval:  90,
    pauseChance:   0.12,
    pauseDuration: { min: 2000, max: 8000 },
    bounceChance:  0.01,
    reReadChance:  0.75,  // almost always re-reads something
    typingSpeed:   { min: 130, max: 300 },
    tabOutChance:  0.03,
    commentChance: 0.7,   // always reads comments
    microFreq:     6,
    jitterRange:   0.40,
  },
  {
    name: 'MobileUser',
    // Burst scrolling — fast then stops, then fast again
    scrollSpeed:   { slow: 80, body: 120, fast: 200 },
    stepInterval:  55,
    pauseChance:   0.07,
    pauseDuration: { min: 1000, max: 4000 },
    bounceChance:  0.12,
    reReadChance:  0.20,
    typingSpeed:   { min: 60, max: 160 },
    tabOutChance:  0.15,  // mobile users switch apps often
    commentChance: 0.15,
    microFreq:     10,
    jitterRange:   0.50,  // more jitter (fat-finger simulation)
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUTTER SMOOTH SCROLL — 3-phase reading rhythm
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function butterSmoothScroll(page, durationMs, config = {}, persona = null, siteConfig = null) {
  const p = persona || PERSONAS[1]; // default Casual

  const adPauseMin = (config.adPauseDurationMin || 0.5) * 1000;
  const adPauseMax = (config.adPauseDurationMax || 2.5) * 1000;

  const baseAdSel = 'iframe[src*="ad"], iframe[id*="ad"], ins.adsbygoogle, div[class*="ad-"], div[class*="advertisement"]';
  const siteAdSel = siteConfig?.adZoneSelectors ? siteConfig.adZoneSelectors.join(', ') : '';
  const fullAdSel = siteAdSel ? `${baseAdSel}, ${siteAdSel}` : baseAdSel;

  let totalScrolled = 0;
  let adHitCount = 0;
  let stepCount = 0;
  const startTime = Date.now();

  // Mobile users: burst mode (scroll fast for a bit, then hard stop)
  const isMobile = p.name === 'MobileUser';
  let burstStepsLeft = 0;
  let burstPauseLeft = 0;

  while (true) {
    stepCount++;

    const pos = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight || document.body.scrollHeight,
      viewportH: window.innerHeight,
    })).catch(() => null);

    if (!pos) { await sleep(500); continue; }

    const atBottom = (pos.scrollY + pos.viewportH + 80) >= pos.scrollHeight;
    const elapsed = Date.now() - startTime;
    const scrollProgress = pos.scrollHeight > pos.viewportH
      ? clamp(pos.scrollY / (pos.scrollHeight - pos.viewportH), 0, 1)
      : 1;

    // ── At bottom: wait out remaining dwell time ──
    if (atBottom) {
      const remaining = durationMs - elapsed;
      if (remaining > 800) {
        // Read the comments or just sit there
        if (remaining > 3000 && Math.random() < p.commentChance) {
          await _readCommentsSection(page);
        } else {
          await sleep(Math.min(remaining, 6000));
        }
        // Occasional scroll-up at bottom (re-checking something)
        if (Math.random() < 0.35) {
          await page.mouse.wheel(0, -randomDelay(80, 300)).catch(() => {});
          await sleep(randomDelay(600, 1800));
          await page.mouse.wheel(0, randomDelay(50, 150)).catch(() => {});
        }
        const rem2 = durationMs - (Date.now() - startTime);
        if (rem2 > 800) await sleep(rem2);
      }
      break;
    }

    // ── Time expired: jump to bottom ──
    if (elapsed >= durationMs) {
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })).catch(() => {});
      await sleep(1500);
      break;
    }

    // ── 3-Phase scroll speed ──
    // INTRO: 0–20% → fast (skim) | BODY: 20–80% → slow (read) | OUTRO: 80–100% → medium
    let phaseSpeed;
    if (scrollProgress < 0.20) {
      phaseSpeed = p.scrollSpeed.fast;
    } else if (scrollProgress < 0.80) {
      phaseSpeed = p.scrollSpeed.body;
    } else {
      phaseSpeed = (p.scrollSpeed.body + p.scrollSpeed.fast) / 2;
    }

    // MobileUser: burst pattern
    let chunk;
    if (isMobile) {
      if (burstPauseLeft > 0) {
        burstPauseLeft--;
        await sleep(p.stepInterval + randomDelay(20, 60));
        continue;
      }
      if (burstStepsLeft <= 0) {
        // Start a new burst
        burstStepsLeft = randomDelay(8, 20);
        burstPauseLeft = randomDelay(3, 12); // pause after burst
      }
      burstStepsLeft--;
      chunk = phaseSpeed * (1 + (Math.random() - 0.5) * p.jitterRange) * 1.4;
    } else {
      // Sine-wave variation for natural feel
      const progress = clamp(elapsed / durationMs, 0, 1);
      const sine = 0.5 + Math.sin(progress * Math.PI) * 0.5;
      const jitter = 1 + (Math.random() - 0.5) * p.jitterRange;
      chunk = Math.max(phaseSpeed * sine * jitter, 5);
    }

    await page.mouse.wheel(0, chunk).catch(() => {});
    totalScrolled += chunk;
    await sleep(p.stepInterval + randomDelay(0, 25));

    // ── Reading pause ──
    if (Math.random() < p.pauseChance) {
      const pauseMs = randomDelay(p.pauseDuration.min, p.pauseDuration.max);
      await sleep(pauseMs);
      // Deep divers and Researchers: sometimes select text during pause
      if ((p.name === 'Researcher' || p.name === 'DeepDiver') && Math.random() < 0.5) {
        await _selectTextOnPage(page);
      }
    }

    // ── Micro-interactions (every N steps) ──
    if (stepCount % p.microFreq === 0) {
      const roll = Math.random();

      if (roll < 0.18) {
        await _selectTextOnPage(page);
        await sleep(randomDelay(700, 2000));

      } else if (roll < 0.30) {
        // Scroll up a bit — re-reading
        const upPx = randomDelay(60, 250);
        await page.mouse.wheel(0, -upPx).catch(() => {});
        await sleep(randomDelay(800, 2500));
        await page.mouse.wheel(0, upPx * 0.7).catch(() => {});

      } else if (roll < 0.40) {
        // Hover over image
        await _hoverImage(page);
        await sleep(randomDelay(800, 2500));

      } else if (roll < 0.48) {
        // Hover link without clicking
        await _hoverLink(page);

      } else if (roll < 0.48 + p.tabOutChance) {
        // Tab out — human checks another tab or opens something briefly
        await _tabOut(page);

      } else if (roll < 0.56) {
        // Move mouse naturally
        await humanMouseMove(page);
      }
      // else: do nothing — just keep scrolling
    }

    // ── Ad zone detection (2% check per step) ──
    if (Math.random() < 0.02) {
      await _checkAdZone(page, fullAdSel, adPauseMin, adPauseMax, () => { adHitCount++; });
    }

    if (Math.random() < 0.01) await humanMouseMove(page);
  }

  await sleep(randomDelay(800, 2000));
  return { totalScrolled, adHitCount };
}

// ── Micro-interaction helpers ──
async function _selectTextOnPage(page) {
  await page.evaluate(() => {
    try {
      const paras = Array.from(document.querySelectorAll('p, h2, h3, li, blockquote'))
        .filter(el => el.textContent && el.textContent.trim().length > 20);
      if (!paras.length) return;
      const el = paras[Math.floor(Math.random() * Math.min(paras.length, 8))];
      const range = document.createRange();
      const text = el.firstChild;
      if (text && text.nodeType === 3) {
        const len = text.textContent.length;
        const start = Math.floor(Math.random() * (len * 0.4));
        const end = start + Math.floor(Math.random() * (len * 0.4) + 10);
        range.setStart(text, Math.min(start, len));
        range.setEnd(text, Math.min(end, len));
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        setTimeout(() => window.getSelection().removeAllRanges(), 1000 + Math.random() * 2000);
      }
    } catch {}
  }).catch(() => {});
}

async function _hoverImage(page) {
  await page.evaluate(() => {
    try {
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter(img => { const r = img.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight && r.width > 80; });
      if (imgs.length) imgs[Math.floor(Math.random() * imgs.length)].scrollIntoView({ block: 'nearest' });
    } catch {}
  }).catch(() => {});
  await humanMouseMove(page);
}

async function _hoverLink(page) {
  const links = await page.$$('article a[href], .entry-content a[href], .post-content a[href]').catch(() => []);
  if (!links.length) return;
  const link = links[Math.floor(Math.random() * Math.min(links.length, 5))];
  const box = await link.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 }).catch(() => {});
    await sleep(randomDelay(600, 2000));
    await humanMouseMove(page);
  }
}

// Real distraction sites humans actually visit between reading
const DISTRACTION_SITES = [
  'https://www.youtube.com',
  'https://www.reddit.com',
  'https://news.ycombinator.com',
  'https://www.bbc.com/news',
  'https://weather.com',
  'https://www.cnn.com',
  'https://www.nytimes.com',
  'https://www.espn.com',
];

async function _tabOut(page) {
  try {
    const newTab = await page.context().newPage().catch(() => null);
    if (!newTab) return;
    // Pick a real site — humans don't go to blank tabs
    const dest = DISTRACTION_SITES[Math.floor(Math.random() * DISTRACTION_SITES.length)];
    await newTab.goto(dest, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {});
    await sleep(randomDelay(5000, 14000)); // distracted 5-14s
    // Scroll slightly — proves they looked at it
    if (Math.random() < 0.5) await newTab.mouse.wheel(0, randomDelay(80, 250)).catch(() => {});
    await sleep(randomDelay(1000, 3000));
    await newTab.close().catch(() => {});
  } catch {}
}

async function _readCommentsSection(page) {
  try {
    // Find and scroll to comments
    const commentsEl = await page.$('#comments, .comments-area, .comments-section, [id*="respond"], .wp-block-comments').catch(() => null);
    if (commentsEl) {
      await commentsEl.scrollIntoView({ behavior: 'smooth' }).catch(() => {});
      await sleep(randomDelay(2000, 6000)); // reading comments
      // Sometimes scroll through comments
      if (Math.random() < 0.5) {
        await page.mouse.wheel(0, randomDelay(100, 300)).catch(() => {});
        await sleep(randomDelay(1500, 4000));
      }
    }
  } catch {}
}

async function _checkAdZone(page, fullAdSel, adPauseMin, adPauseMax, onHit) {
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
    onHit();
    const pauseMin = adInfo.highValue ? Math.max(adPauseMin, 2500) : adPauseMin;
    const pauseMax = adInfo.highValue ? Math.max(adPauseMax, 6000) : adPauseMax;
    await sleep(randomDelay(pauseMin, pauseMax));
    if (adInfo.highValue && Math.random() < 0.4) await sleep(randomDelay(500, 1500));
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRAFFIC ROUTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SEARCH_DOMAINS = ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com'];

async function _ensureLandedOnTarget(page, articleUrl) {
  try {
    const current = page.url();
    const onSearch = SEARCH_DOMAINS.some(d => current.includes(d));
    if (onSearch && articleUrl) {
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000, referer: current });
    }
  } catch {}
}

async function _searchAndNavigate(page, searchUrl, inputSel, articleUrl, articleTitle, siteUrl, typingSpeed) {
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(randomDelay(1500, 3500));

  const allSels = [inputSel, 'input[type="search"]', 'input[type="text"]', '[role="combobox"]', 'textarea'].join(', ');
  let input = await page.$(allSels).catch(() => null);
  if (!input) { await sleep(3000); input = await page.$(allSels).catch(() => null); }

  if (!input) {
    await _safeGoto(page, articleUrl, searchUrl);
    return true;
  }

  await input.click().catch(() => {});
  await sleep(randomDelay(300, 700));
  const query = pickSearchQuery(articleTitle, articleUrl, siteUrl);
  await humanType(page, query, typingSpeed || { min: 80, max: 200 });
  await sleep(randomDelay(500, 1200));
  await page.keyboard.press('Enter');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(randomDelay(2000, 5000));

  // Scroll SERP a bit — human behavior
  await page.mouse.wheel(0, randomDelay(80, 300)).catch(() => {});
  await sleep(randomDelay(1000, 3000));

  // Find article link using locator (resilient to DOM changes unlike element handles)
  const refererUrl = page.url();
  let clicked = false;
  try {
    const hostname = new URL(articleUrl).hostname;
    const pathname = new URL(articleUrl).pathname;
    const locator = page.locator(`a[href*="${pathname}"], a[href*="${hostname}"]`).first();
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      await humanMouseMove(page);
      await sleep(randomDelay(800, 2000));
      await locator.click({ timeout: 8000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await _ensureLandedOnTarget(page, articleUrl);
      clicked = true;
    }
  } catch {}

  if (!clicked) {
    // Not found in SERP — goto directly with search referer
    await _safeGoto(page, articleUrl, refererUrl);
  }
  return true;
}

// Safe goto — tries domcontentloaded first, falls back to load, then commit (fastest)
async function _safeGoto(page, url, referer) {
  const opts = referer ? { referer } : {};
  // Try domcontentloaded (fast)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000, ...opts });
    return;
  } catch (e1) {
    // ERR_ABORTED often means page loaded partially (ads aborted) — wait and check
    if (e1.message?.includes('ERR_ABORTED') || e1.message?.includes('net::')) {
      await sleep(2000);
      // If we landed on the right page despite abort, that's fine
      if (page.url().includes(new URL(url).hostname)) return;
    }
  }
  // Fallback: commit (fires as soon as any response comes in)
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 20000, ...opts });
    await sleep(2000);
  } catch {}
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

    case 'internal': {
      const siteBase = siteUrl || (() => { try { return new URL(articleUrl).origin; } catch { return articleUrl; } })();
      await page.goto(siteBase, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await sleep(randomDelay(3000, 6000));
      await page.mouse.wheel(0, randomDelay(200, 500)).catch(() => {});
      await sleep(randomDelay(2000, 5000));
      await page.mouse.wheel(0, randomDelay(100, 300)).catch(() => {});
      await sleep(randomDelay(1500, 3000));
      // Use locator — safe from DOM mutations
      try {
        const pathname = new URL(articleUrl).pathname;
        const locator = page.locator(`a[href*="${pathname}"]`).first();
        if (await locator.count().catch(() => 0) > 0) {
          await humanMouseMove(page);
          await sleep(randomDelay(1000, 2000));
          await locator.click({ timeout: 8000 }).catch(() =>
            page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
          );
          await sleep(randomDelay(2000, 4000));
          return true;
        }
      } catch {}
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      return true;
    }

    case 'social': {
      // Simulate arriving from social media — go to social platform briefly, then navigate to article
      const SOCIAL_REFERRERS = [
        'https://www.facebook.com',
        'https://twitter.com',
        'https://www.linkedin.com',
        'https://www.pinterest.com',
      ];
      const social = SOCIAL_REFERRERS[Math.floor(Math.random() * SOCIAL_REFERRERS.length)];
      await page.goto(social, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await sleep(randomDelay(3000, 8000));
      await page.mouse.wheel(0, randomDelay(100, 300)).catch(() => {});
      await sleep(randomDelay(1000, 3000));
      await _safeGoto(page, articleUrl, social);
      return true;
    }

    case 'backlink':
      if (backlinkData?.sourceUrl) {
        await page.goto(backlinkData.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await sleep(randomDelay(5000, 12000));
        await humanMouseMove(page);
        await page.mouse.wheel(0, randomDelay(200, 400)).catch(() => {});
        await sleep(randomDelay(3000, 6000));
        let blogLink = null;
        try { blogLink = await page.$(`a[href*="${new URL(articleUrl).hostname}"]`); } catch {}
        if (blogLink) {
          await humanMouseMove(page);
          await sleep(randomDelay(1000, 2500));
          await blogLink.click().catch(() => {});
          await sleep(randomDelay(2000, 4000));
          return true;
        }
      }
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      return true;

    case 'random': {
      const mix = [
        { src: 'google',     w: 35 },
        { src: 'direct',     w: 18 },
        { src: 'internal',   w: 17 },
        { src: 'bing',       w: 10 },
        { src: 'social',     w:  8 },
        { src: 'duckduckgo', w:  5 },
        { src: 'yahoo',      w:  4 },
        ...(backlinkData?.sourceUrl ? [{ src: 'backlink', w: 3 }] : []),
      ];
      const total = mix.reduce((s, m) => s + m.w, 0);
      let rand = Math.random() * total;
      let picked = 'direct';
      for (const m of mix) { rand -= m.w; if (rand <= 0) { picked = m.src; break; } }
      return await openArticleByTraffic(page, articleUrl, articleTitle, picked, siteUrl, backlinkData, typingSpeed);
    }

    case 'direct':
    default:
      await _safeGoto(page, articleUrl);
      await sleep(randomDelay(1000, 3000));
      return true;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROFILE AGENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class ProfileAgent {
  constructor(profileId, profileName, debugPort, options = {}) {
    this.profileId   = profileId;
    this.profileName = profileName;
    this.debugPort   = debugPort;
    this.browser     = null;
    this.context     = null;
    this.status      = 'idle';
    this.currentArticle  = null;
    this.options         = options;
    this.logs            = [];
    this.retryCount      = 0;
    this.maxRetries      = 3;
    this.articlesRead    = 0;
    this.totalDwellTime  = 0;
    this._warmedUp       = false;

    // ── Deterministic personality from profileId ──
    const seed = String(profileId).split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0x811c9dc5);
    this.seededRand = (n) => {
      let s = (seed ^ n) >>> 0;
      s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
      s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
      return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
    };

    // Pick persona (deterministic — same profile = same persona forever)
    const personaIdx = Math.floor(this.seededRand(1) * PERSONAS.length);
    this.persona = PERSONAS[personaIdx];

    // Speed multiplier from user config (scrollSpeed setting)
    // applied on top of persona base speed in readArticle
    this._configSpeedMult = 1.0;

    // Bounce and re-read chances — slightly randomized from persona base
    this.bounceChance  = clamp(this.persona.bounceChance + (this.seededRand(3) - 0.5) * 0.05, 0, 0.3);
    this.reReadChance  = clamp(this.persona.reReadChance + (this.seededRand(4) - 0.5) * 0.1, 0, 0.9);

    // Session intent — research / casual / discovery
    // Base is seeded (same profile = same tendency) but small per-session variance adds realism
    const baseIntentRoll = this.seededRand(5);
    const sessionVariance = (Math.random() - 0.5) * 0.25; // ±0.125 each session
    const intentRoll = clamp(baseIntentRoll + sessionVariance, 0, 1);
    this.sessionIntent = intentRoll < 0.3 ? 'research' : intentRoll < 0.7 ? 'casual' : 'discovery';

    // AI Brain — makes smart decisions (search query, read depth, next action)
    // Requires ANTHROPIC_API_KEY in .env or settings. Falls back gracefully if not set.
    this.ai = new AIBrain(profileId, this.persona.name);

    this.log('info', `Persona: ${this.persona.name} | Intent: ${this.sessionIntent} | Bounce: ${(this.bounceChance * 100).toFixed(0)}% | AI: ${this.ai.isEnabled() ? '✓' : 'off'}`);
  }

  log(level, message) {
    const entry = { time: new Date().toISOString(), level, message, profileId: this.profileId };
    this.logs.push(entry);
    if (this.logs.length > 60) this.logs = this.logs.slice(-60);
    console.log(`[${this.profileName}] [${level}] ${message}`);
    return entry;
  }

  // Warmup: browse homepage before first article (arrives naturally)
  async warmup(siteUrl) {
    if (this._warmedUp || !siteUrl || !this.context) return;
    this._warmedUp = true;
    try {
      const page = await this.context.newPage().catch(() => null);
      if (!page) return;

      const base = siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl;
      this.log('info', `Warmup: browsing ${base}`);
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await sleep(randomDelay(2000, 5000));

      // Dismiss overlays (cookie banners etc)
      await dismissOverlays(page);

      await page.mouse.wheel(0, randomDelay(200, 500)).catch(() => {});
      await sleep(randomDelay(1500, 3500));

      // 40% scroll back up (checking header/menu)
      if (Math.random() < 0.4) {
        await page.mouse.wheel(0, -randomDelay(100, 250)).catch(() => {});
        await sleep(randomDelay(800, 2000));
      }

      // Researchers: hover over nav menu items
      if (this.persona.name === 'Researcher' || this.persona.name === 'DeepDiver') {
        const navLinks = await page.$$('nav a, .menu a, header a').catch(() => []);
        if (navLinks.length > 0) {
          const pick = navLinks[Math.floor(Math.random() * Math.min(navLinks.length, 5))];
          const box = await pick.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 }).catch(() => {});
            await sleep(randomDelay(500, 1500));
          }
        }
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
    this.log('info', `Connecting CDP at http://127.0.0.1:${this.debugPort}...`);
    // Retry up to 3 times — browser may still be warming up
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.browser  = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`, { timeout: 60000 });
        this.context  = this.browser.contexts()[0];
        if (!this.context) this.context = await this.browser.newContext();
        this.status = 'connected';
        this.log('success', `Connected! CDP:${this.debugPort} (attempt ${attempt})`);
        return true;
      } catch (err) {
        this.log('warn', `CDP attempt ${attempt}/3 failed: ${err.message}`);
        if (attempt < 3) await sleep(6000); // wait before retry
      }
    }
    this.status = 'error';
    this.log('error', `CDP failed after 3 attempts on port ${this.debugPort}`);
    return false;
  }

  async readArticle(articleUrl, articleTitle, config = {}) {
    if (!this.context) { this.log('error', 'No browser context'); return false; }

    this.currentArticle = articleTitle;
    this.status = 'navigating';
    const trafficType = config.trafficPreference || 'random';
    this.log('info', `[${this.persona.name}/${trafficType}] Opening: "${articleTitle}"`);

    const siteConfig = getSiteConfig(config.siteUrl);

    // Read time: user settings > category defaults
    let readTimeMin = (config.readTimeMin || 0) * 1000;
    let readTimeMax = (config.readTimeMax || 0) * 1000;
    if (!readTimeMin || !readTimeMax) {
      const catTimes = siteConfig ? getReadTimeByCategory(articleUrl, config.siteUrl) : null;
      readTimeMin = catTimes ? catTimes.min * 1000 : 60 * 1000;
      readTimeMax = catTimes ? catTimes.max * 1000 : 180 * 1000;
      this.log('info', `Category read time: ${Math.round(readTimeMin/60000)}-${Math.round(readTimeMax/60000)} min`);
    } else {
      this.log('info', `Profile read time: ${Math.round(readTimeMin/60000)}-${Math.round(readTimeMax/60000)} min`);
    }

    // Persona speed multiplier based on config.scrollSpeed
    const speedMult = config.scrollSpeed === 'slow' ? 0.6 : config.scrollSpeed === 'fast' ? 1.5 : 1.0;

    // Build effective persona with config speed applied
    const effectivePersona = {
      ...this.persona,
      scrollSpeed: {
        slow: this.persona.scrollSpeed.slow * speedMult,
        body: this.persona.scrollSpeed.body * speedMult,
        fast: this.persona.scrollSpeed.fast * speedMult,
      }
    };

    let page;
    try {
      if (!this._warmedUp && config.siteUrl) await this.warmup(config.siteUrl);

      page = await this.context.newPage().catch(() => null);
      if (!page) { this.log('error', 'Could not open new page'); return false; }

      // Start delay (spread profiles out)
      const startDelay = randomDelay((config.startDelayMin || 5) * 1000, (config.startDelayMax || 30) * 1000);
      await sleep(startDelay);

      // AI decides search query if using search traffic
      let aiSearchQuery = null;
      if (['google', 'bing', 'duckduckgo', 'yahoo', 'random'].includes(trafficType) && this.ai.isEnabled()) {
        const topicHint = siteConfig?.searchQueries?.[0] || '';
        aiSearchQuery = await this.ai.decideSearchQuery(articleTitle, topicHint);
        if (aiSearchQuery) this.log('info', `[AI] Search query: "${aiSearchQuery}"`);
      }

      // Navigate via traffic router (pass AI query override)
      const opened = await openArticleByTraffic(page, articleUrl, aiSearchQuery || articleTitle, trafficType, config.siteUrl, null, this.persona.typingSpeed);
      if (!opened) {
        this.log('error', `Could not open: "${articleTitle}"`);
        await page.close().catch(() => {});
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.log('warn', `Retry ${this.retryCount}/${this.maxRetries}...`);
          await sleep(randomDelay(3000, 8000));
          return await this.readArticle(articleUrl, articleTitle, { ...config, trafficPreference: 'direct' });
        }
        return false;
      }

      this.retryCount = 0;
      this.status = 'reading';
      this.log('info', `Reading: "${articleTitle}"`);

      // Wait for page to fully render
      await sleep(randomDelay(1200, 2500));

      // Dismiss popups/cookie banners
      await dismissOverlays(page);

      // Grab page excerpt for AI decision
      const pageExcerpt = await page.evaluate(() => {
        const el = document.querySelector('article p, .entry-content p, .post-content p, p');
        return el?.textContent?.slice(0, 300) || '';
      }).catch(() => '');

      // AI decides read depth (multiplier on dwell time)
      let aiDepthMult = 1.0;
      if (this.ai.isEnabled()) {
        const depth = await this.ai.decideReadDepth(articleTitle, pageExcerpt);
        if (depth !== null) {
          aiDepthMult = depth;
          this.log('info', `[AI] Read depth: ${depth.toFixed(2)}`);
        }
      }

      // Read time for this article
      let readTime = randomDelay(readTimeMin, readTimeMax);

      // Intent modifiers:
      // research → longer dwell; skimmer → shorter dwell
      if (this.sessionIntent === 'research') readTime = Math.floor(readTime * 1.3);
      if (this.sessionIntent === 'discovery') readTime = Math.floor(readTime * 0.75);

      // AI depth multiplier (0.2 = skim, 1.0 = full read)
      readTime = Math.floor(readTime * aiDepthMult);

      // Early bounce simulation
      let actualReadTime = readTime;
      if (Math.random() < this.bounceChance) {
        actualReadTime = Math.floor(readTime * (0.15 + Math.random() * 0.3));
        this.log('info', `Early bounce: only ${Math.round(actualReadTime/1000)}s of ${Math.round(readTime/1000)}s`);
      }

      // SCROLL — 3-phase butter smooth
      const scrollResult = await butterSmoothScroll(page, actualReadTime, config, effectivePersona, siteConfig);

      // Re-read behavior (scroll back up like re-checking)
      if (Math.random() < this.reReadChance && actualReadTime === readTime) {
        const upPx = randomDelay(150, 600);
        await page.mouse.wheel(0, -upPx).catch(() => {});
        await sleep(randomDelay(1500, 5000));
        await page.mouse.wheel(0, upPx * 0.6).catch(() => {});
        await sleep(randomDelay(500, 1500));
      }

      // Finishing scroll-up
      if (Math.random() < 0.28) {
        await page.mouse.wheel(0, -randomDelay(80, 300)).catch(() => {});
        await sleep(randomDelay(800, 2500));
      }

      const dwellSeconds = Math.round(actualReadTime / 1000);
      this.articlesRead++;
      this.totalDwellTime += dwellSeconds;

      const adHits = scrollResult?.adHitCount || 0;
      this.log('success', `Done: "${articleTitle}" | ${dwellSeconds}s | ${trafficType} | ${adHits} ad pauses | ${this.persona.name}`);

      if (!config.keepPageOpen) await page.close().catch(() => {});
      return { dwellTime: dwellSeconds, trafficSource: trafficType, adHitCount: adHits, page: config.keepPageOpen ? page : null };

    } catch (err) {
      const fs = require('fs');
      const logPath = require('path').join(__dirname, '..', 'data', 'agent_errors.log');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${this.profileName} | "${articleTitle}" | ERR: ${err.message}\n`);
      this.log('error', `Error: "${articleTitle}" — ${err.message}`);
      if (page) await page.close().catch(() => {});
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        await sleep(randomDelay(5000, 10000));
        return await this.readArticle(articleUrl, articleTitle, config);
      }
      return false;
    }
  }

  // Find and click a "next post" link — locator-based (DOM detachment safe)
  async _clickNextPost(page) {
    try {
      const nextSelectors = [
        'a[rel="next"]',
        '.nav-next a', '.next-post a', '.post-nav-next a',
        'a.next', 'a.next-post', 'a.nextpostslink',
        '.navigation .next a', '#nav-below .nav-next a',
        '.post-navigation .nav-next a', '.posts-navigation .nav-next a',
        'a:has-text("Next Post")', 'a:has-text("Next Article")',
        'a:has-text("→")', 'a:has-text("»")',
      ];
      const currentUrl = page.url();

      for (const sel of nextSelectors) {
        // Use locator — resilient to DOM mutations
        const locator = page.locator(sel).first();
        const count = await locator.count().catch(() => 0);
        if (!count) continue;

        const href = await locator.getAttribute('href').catch(() => null);
        if (!href) continue;
        const isValid = href.startsWith('http') || href.startsWith('/');
        if (!isValid) continue;
        const resolvedUrl = href.startsWith('http') ? href : new URL(href, currentUrl).href;
        if (resolvedUrl === currentUrl) continue;

        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(randomDelay(600, 1500));
        await humanMouseMove(page);
        await sleep(randomDelay(400, 1000));
        // Click via locator — safe even if DOM re-renders
        await locator.click({ timeout: 8000 }).catch(() =>
          page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
        );
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await sleep(randomDelay(1000, 2200));
        return page.url();
      }
    } catch {}
    return null;
  }

  // Click a related/recommended post — locator-based (DOM detachment safe)
  async _clickRelatedPost(page, siteHostname) {
    const relatedSelectors = [
      '.related-posts a[href]', '.related-articles a[href]', '.yarpp-related a[href]',
      '[class*="related"] a[href]', '[class*="recommended"] a[href]',
      '.post-tags ~ * a[href]', '.entry-footer a[href]', '.more-from-category a[href]',
    ];
    for (const sel of relatedSelectors) {
      // Collect all hrefs first — avoids holding stale element handles
      const hrefs = await page.evaluate((s, host) => {
        const els = Array.from(document.querySelectorAll(s));
        return els.map(el => el.getAttribute('href')).filter(h => h && host && h.includes(host) && !h.includes('#'));
      }, sel, siteHostname).catch(() => []);

      if (!hrefs.length) continue;
      const href = hrefs[Math.floor(Math.random() * hrefs.length)];
      const resolvedUrl = href.startsWith('http') ? href : new URL(href, page.url()).href;

      await humanMouseMove(page);
      await sleep(randomDelay(1200, 2800));
      // Use locator from href — resilient to DOM changes
      const locator = page.locator(`a[href="${href}"], a[href="${resolvedUrl}"]`).first();
      const found = await locator.count().catch(() => 0);
      if (found > 0) {
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(randomDelay(500, 1000));
        await locator.click({ timeout: 8000 }).catch(() =>
          page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
        );
      } else {
        await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(randomDelay(1000, 2200));
      return page.url();
    }
    return null;
  }

  // Run one site's articles in a single tab
  async _runSiteTab(siteArticles, config, siteUrl) {
    const useNextPost      = config.useNextPost === true;
    const multiPageSession = config.multiPageSession !== false;
    const maxRelatedPages  = config.maxRelatedPages || 3;
    const siteConfig       = getSiteConfig(siteUrl);
    const siteHostname     = siteUrl ? (() => { try { return new URL(siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl).hostname; } catch { return ''; } })() : '';
    const results = [];
    let activePage = null;

    // Discovery intent: shuffle article order (seeded)
    let articleList = [...siteArticles];
    if (this.sessionIntent === 'discovery') {
      articleList = articleList.sort(() => this.seededRand(Date.now() % 99) - 0.5);
    }

    for (let i = 0; i < articleList.length; i++) {
      const article = articleList[i];
      this.log('info', `[Tab:${siteHostname || 'site'}] [${i + 1}/${articleList.length}] ${article.title}`);

      // AI decides per-article unique behavior (v2 feature)
      let articleBehavior = null;
      if (this.ai && this.ai.isEnabled()) {
        articleBehavior = await this.ai.decideArticleBehavior(article.title, i, articleList.length);
        if (articleBehavior) {
          this.log('info', `[AI] Article behavior: scroll=${articleBehavior.scrollSpeed}, pauses=${articleBehavior.pauseFrequency}, tabOut=${articleBehavior.tabOut}`);
        }
      }

      // Merge AI behavior into config for this article
      const readConfig = {
        ...config,
        siteUrl,
        keepPageOpen: true,
        // Override with AI decisions if available
        scrollSpeed: articleBehavior?.scrollSpeed || config.scrollSpeed,
        pauseFrequency: articleBehavior?.pauseFrequency || 'normal',
        tabOut: articleBehavior?.tabOut || false,
        mouseActivity: articleBehavior?.mouseActivity || 'normal',
      };

      // Progress callback
      if (this._onProgressCallback) {
        this._onProgressCallback(i, articleList.length, article.url);
      }
      const result = await this.readArticle(article.url, article.title, readConfig);
      if (result && result.page) activePage = result.page;

      // ── Next post navigation ──
      if (useNextPost && activePage) {
        // Per-profile decision: some click mid-page (40% scroll), some wait till bottom
        const midPageChance = 0.3 + (this.seededRand(7) * 0.4);
        const goMidPage = Math.random() < midPageChance;

        if (goMidPage) {
          // Scroll to 50-75% of page then look for next post
          await activePage.evaluate(() => {  // FIXED: was `page` (bug), now `activePage`
            const total = document.documentElement.scrollHeight - window.innerHeight;
            const target = total * (0.5 + Math.random() * 0.25);
            window.scrollTo({ top: target, behavior: 'smooth' });
          }).catch(() => {});
          await sleep(randomDelay(1500, 3500));
        }

        const nextPostCount = this.seededRand(8) < 0.6 ? 1 : 2;

        for (let np = 0; np < nextPostCount; np++) {
          try {
            const nextUrl = await this._clickNextPost(activePage);
            if (nextUrl && nextUrl !== 'about:blank' && nextUrl !== article.url) {
              this.log('info', `[Tab:${siteHostname}] Next post → ${nextUrl} (${goMidPage ? 'mid-page' : 'bottom'})`);
              this.currentArticle = nextUrl;
              this.status = 'reading';

              await dismissOverlays(activePage);

              const npReadTimeMin = (config.readTimeMin || 60) * 1000;
              const npReadTimeMax = (config.readTimeMax || 180) * 1000;
              const npReadTime = randomDelay(npReadTimeMin, npReadTimeMax);

              const speedMult = config.scrollSpeed === 'slow' ? 0.6 : config.scrollSpeed === 'fast' ? 1.5 : 1.0;
              const effectivePersona = {
                ...this.persona,
                scrollSpeed: {
                  slow: this.persona.scrollSpeed.slow * speedMult,
                  body: this.persona.scrollSpeed.body * speedMult,
                  fast: this.persona.scrollSpeed.fast * speedMult,
                }
              };

              await sleep(randomDelay(800, 1800));
              await butterSmoothScroll(activePage, npReadTime, config, effectivePersona, siteConfig);

              if (Math.random() < 0.3) {
                await activePage.mouse.wheel(0, -randomDelay(100, 300)).catch(() => {});
                await sleep(randomDelay(800, 2000));
              }

              const npDwell = Math.round(npReadTime / 1000);
              this.articlesRead++;
              this.totalDwellTime += npDwell;
              this.log('success', `[Tab:${siteHostname}] Next post: ${npDwell}s`);
            } else {
              break;
            }
          } catch { break; }
        }
      }

      // ── Related posts (multi-page session) ──
      if (multiPageSession && activePage && result) {
        const extraPages = randomDelay(1, maxRelatedPages);
        for (let r = 0; r < extraPages; r++) {
          try {
            const relatedUrl = await this._clickRelatedPost(activePage, siteHostname);
            if (relatedUrl && relatedUrl !== 'about:blank') {
              this.log('info', `[Tab:${siteHostname}] Related ${r + 1}: ${relatedUrl}`);
              await dismissOverlays(activePage);
              const relMin = Math.floor((config.readTimeMin || 60) * 1000 * 0.3);
              const relMax = Math.floor((config.readTimeMax || 180) * 1000 * 0.6);
              const relReadTime = randomDelay(relMin, relMax);
              await sleep(randomDelay(800, 1600));
              await butterSmoothScroll(activePage, relReadTime, config, this.persona, siteConfig);
              this.totalDwellTime += Math.round(relReadTime / 1000);
              await sleep(randomDelay(1000, 3000));
            } else { break; }
          } catch { break; }
        }
      }

      results.push({ article, result });

      if (i < articleList.length - 1) {
        const delay = randomDelay((config.articleDelay || 30) * 700, (config.articleDelay || 30) * 1300);
        await sleep(delay);
      }
    }

    if (activePage) await activePage.close().catch(() => {});
    return results;
  }

  async runSession(articles, config = {}) {
    this.status = 'running';
    this.log('info', `Session: ${articles.length} articles | ${this.persona.name} | ${this.sessionIntent}`);

    // Group articles by site — each site = one tab
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
    this.log('info', `Sites: ${sites.length} → ${sites.length} parallel tab(s)`);

    // Warmup once before all tabs
    if (!this._warmedUp && sites[0]?.siteUrl) await this.warmup(sites[0].siteUrl);

    // All site tabs run in parallel
    const allResults = await Promise.all(
      sites.map(({ siteUrl, articles: siteArticles }) =>
        this._runSiteTab(siteArticles, config, siteUrl)
      )
    );

    const results = allResults.flat();
    this.status = 'completed';
    this.log('success', `Session done: ${this.articlesRead} articles, ${this.totalDwellTime}s dwell`);
    return results;
  }

  async disconnect() {
    if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; this.context = null; }
    this.status = 'disconnected';
    this.log('info', 'Disconnected');
  }

  getStatus() {
    return {
      profileId: this.profileId,
      profileName: this.profileName,
      status: this.status,
      currentArticle: this.currentArticle,
      articlesRead: this.articlesRead,
      totalDwellTime: this.totalDwellTime,
      persona: this.persona.name,
      sessionIntent: this.sessionIntent,
      logs: this.logs.slice(-20),
    };
  }
}

module.exports = { ProfileAgent, MMB_SITE_CONFIGS, getSiteConfig, getReadTimeByCategory };
