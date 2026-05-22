/**
 * Profile Agent — One agent per MoreLogin profile
 * Playwright CDP — Human-like behavior
 * 
 * FEATURES:
 * 1. Traffic Router: search / direct / suggested / random
 * 2. Engagement: Like / Subscribe / Comment
 * 3. Auto-recovery: retry on fail, skip unavailable
 * 4. Dark Theme: multiple methods
 * 5. Search bar: multiple fallback methods
 * 6. Smooth scroll: small increments
 */

const { chromium } = require('playwright-core');
const http = require('http');
const { openVideoSmart, openVideoViaBacklink } = require('./searchEngine.cjs');
const {
  detectPageBlock,
  verifyOpenedVideo,
  planWatchAction,
  resolveTrafficMix,
  createProfilePersonality,
  computeWatchTimeMs,
} = require('./agentBrain.cjs');

// Track engagement to backend (updates rate limit dashboard)
async function trackEngagement(profileId, action, value) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ profileId, action, value: value || 1 });
    const req = http.request({
      hostname: '127.0.0.1', port: 3100, path: '/api/analytics/track',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 3000,
    }, () => resolve());
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function humanType(page, text, profileSpeed) {
  // Each profile gets UNIQUE typing speed (set once per profile session)
  // Slow typer: 120-280ms, Medium: 70-180ms, Fast: 40-120ms
  const baseMin = profileSpeed?.min || randomDelay(40, 120);
  const baseMax = profileSpeed?.max || randomDelay(150, 300);
  const pauseChance = profileSpeed?.pauseChance || (0.05 + Math.random() * 0.1); // 5-15% chance of pause

  for (const char of text) {
    // Per-character variation (±30ms jitter)
    const charDelay = randomDelay(baseMin, baseMax) + randomDelay(-15, 15);
    await page.keyboard.type(char, { delay: Math.max(30, charDelay) });
    
    // Random thinking pauses (different frequency per profile)
    if (Math.random() < pauseChance) await sleep(randomDelay(150, 800));
    
    // Occasional longer pause after space (like thinking between words)
    if (char === ' ' && Math.random() < 0.15) await sleep(randomDelay(200, 600));
  }
  await sleep(randomDelay(200, 800));
}

async function humanMouseMove(page) {
  const x = randomDelay(200, 900);
  const y = randomDelay(150, 500);
  await page.mouse.move(x, y, { steps: randomDelay(8, 20) });
  await sleep(randomDelay(100, 300));
}

/** Human-like scroll: eased steps (curve), not one straight wheel dump. */
async function smoothScroll(page, totalPixels, direction = 'down', personality = null) {
  const steps = personality
    ? personality.pickInt(personality.scrollStepsMin, personality.scrollStepsMax)
    : randomDelay(8, 16);
  const curve = personality?.scrollCurve ?? 0.28;
  const total = Math.abs(totalPixels);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    const ease = (1 - Math.cos(t * Math.PI)) / 2;
    const stepPx = (total / steps) * (0.65 + ease * curve * 2);
    const micro = (Math.random() * 10 - 5);
    const delta = direction === 'down' ? stepPx + micro : -(stepPx + micro);
    await page.mouse.wheel(0, delta);
    await sleep(randomDelay(28, 95));
  }
  await sleep(randomDelay(220, 620));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE VISIBILITY OVERRIDE
// Prevents YouTube from pausing when another profile window gets focus.
// YouTube uses document.visibilityState === 'hidden' to auto-pause.
// We override it to always return 'visible' so video keeps playing.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function overridePageVisibility(page) {
  try {
    await page.evaluate(() => {
      try {
        // Override visibilityState — always 'visible'
        Object.defineProperty(document, 'visibilityState', {
          get: () => 'visible', configurable: true,
        });
        Object.defineProperty(document, 'hidden', {
          get: () => false, configurable: true,
        });
        // Block visibilitychange events from reaching YouTube's pause handler
        const _origAEL = document.addEventListener.bind(document);
        document.addEventListener = function(type, handler, opts) {
          if (type === 'visibilitychange') return; // drop it
          return _origAEL(type, handler, opts);
        };
        // Dispatch a fake 'visible' event so YouTube un-pauses if already paused
        document.dispatchEvent(new Event('visibilitychange'));
      } catch {}
    });
  } catch {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOBILE YOUTUBE DETECTION
// Android profiles open m.youtube.com — completely different DOM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function isMobileYouTube(page) {
  try {
    const url = page.url();
    if (url.includes('m.youtube.com')) return true;
    // Check for mobile-specific element (ytm- prefix = mobile components)
    const hasMobileEl = await page.evaluate(() => !!document.querySelector('ytm-app, ytm-browse, ytm-watch')).catch(() => false);
    return hasMobileEl;
  } catch { return false; }
}

// Detect Android/mobile profile by checking navigator.userAgent
// More reliable than URL-based detection — works even when antidetect browser
// doesn't redirect www.youtube.com to m.youtube.com
async function isAndroidUA(page) {
  try {
    const ua = await page.evaluate(() => navigator.userAgent);
    return /android|mobile/i.test(ua);
  } catch { return false; }
}

// Mobile YouTube search via URL (avoids typing selector issues on mobile)
async function mobileYouTubeSearch(page, videoTitle, channelName, log) {
  try {
    log('info', '[Mobile] Using URL-based search for mobile YouTube...');

    // ESCALATION: Try progressively more specific queries if first attempt fails
    const queries = [];
    if (channelName) queries.push(`${channelName} ${videoTitle}`);
    queries.push(videoTitle);
    // Also try just key words (first 5 words) as fallback query
    const shortTitle = videoTitle.split(' ').slice(0, 5).join(' ');
    if (shortTitle !== videoTitle) queries.push(channelName ? `${channelName} ${shortTitle}` : shortTitle);

    const stopWords = new Set(['the','a','an','is','are','in','on','at','to','for','of','with','and','or','this','that']);

    // Word-level matching helper (same logic as desktop verifyVideoMatch)
    function mobileWordMatch(cardText, targetTitle) {
      const targetWords = targetTitle.toLowerCase().split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
      if (targetWords.length === 0) return 0;
      const matched = targetWords.filter(w => cardText.toLowerCase().includes(w));
      return matched.length / targetWords.length;
    }

    for (const query of queries) {
      const encodedQuery = encodeURIComponent(query);
      await page.goto(`https://m.youtube.com/results?search_query=${encodedQuery}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomDelay(2500, 4000));

      // Use word-level matching to find best video in mobile results
      const videoHref = await page.evaluate(({ titleTarget, channelTarget, stopWordsArr }) => {
        const stopSet = new Set(stopWordsArr);
        function wordMatch(text, target) {
          const words = target.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopSet.has(w));
          if (words.length === 0) return 0;
          return words.filter(w => text.toLowerCase().includes(w)).length / words.length;
        }

        // All video cards — try multiple mobile selectors
        const cardSelectors = [
          'ytm-compact-video-renderer',
          'ytm-video-with-context-renderer',
        ];

        let bestHref = null;
        let bestScore = 0;

        for (const cardSel of cardSelectors) {
          const cards = document.querySelectorAll(cardSel);
          for (const card of cards) {
            const cardText = (card.textContent || '').toLowerCase();
            const titleScore = wordMatch(cardText, titleTarget);
            let channelScore = 0;
            if (channelTarget) {
              const ct = channelTarget.toLowerCase().trim();
              if (cardText.includes(ct) || ct.split(/\s+/).filter(w => w.length > 2).every(w => cardText.includes(w))) {
                channelScore = 0.35;
              }
            }
            const totalScore = titleScore + channelScore;

            if (totalScore > bestScore) {
              // Find the watch link in this card
              const link = card.querySelector('a[href*="/watch?v="]') || card.querySelector('a[href*="/watch"]');
              if (link) {
                const href = link.getAttribute('href');
                if (href && href.includes('/watch')) {
                  bestScore = totalScore;
                  bestHref = href;
                }
              }
            }
          }
        }

        // Confident match only — require channel hint when channel is known
        const minScore = channelTarget ? 0.58 : 0.48;
        return bestScore >= minScore ? bestHref : null;
      }, { titleTarget: videoTitle, channelTarget: channelName || '', stopWordsArr: Array.from(stopWords) });

      if (videoHref) {
        const fullUrl = videoHref.startsWith('http') ? videoHref : `https://m.youtube.com${videoHref}`;
        log('info', `[Mobile] Matched video — navigating to: ${fullUrl}`);
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(randomDelay(2000, 4000));
        return true;
      }

      log('info', `[Mobile] No confident match for query "${query}" — trying next...`);
      await sleep(randomDelay(1000, 2000));
    }

    // All queries failed — do NOT click first result (would play wrong video)
    log('warn', '[Mobile] No matching video found after all queries — skipping to avoid wrong video');
    return false;
  } catch (err) {
    log('warn', `[Mobile] Search error: ${err.message}`);
    return false;
  }
}

/** Open watch URL directly on mobile when search path fails but URL is known */
async function mobileDirectWatch(page, videoUrl, log) {
  if (!videoUrl || !videoUrl.includes('watch')) return false;
  try {
    const mobileUrl = videoUrl.replace('www.youtube.com', 'm.youtube.com');
    log('info', `[Mobile] Direct URL fallback: ${mobileUrl}`);
    await page.goto(mobileUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(randomDelay(2000, 4000));
    return page.url().includes('/watch');
  } catch (err) {
    log('warn', `[Mobile] Direct URL failed: ${err.message}`);
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DARK THEME — Multiple methods
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function forceDarkTheme(page) {
  try {
    await page.evaluate(() => {
      // Method 1: Cookie
      document.cookie = 'PREF=f6=400; path=/; domain=.youtube.com; max-age=31536000';
      // Method 2: DOM attribute
      document.documentElement.setAttribute('dark', 'true');
      document.documentElement.style.colorScheme = 'dark';
      // Method 3: localStorage
      try {
        const pref = JSON.parse(localStorage.getItem('yt-player-quality') || '{}');
        pref.darkTheme = true;
        localStorage.setItem('yt-player-quality', JSON.stringify(pref));
      } catch {}
    });
    // Method 4: Emulate dark color scheme
    await page.emulateMedia({ colorScheme: 'dark' }).catch(() => {});
  } catch {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEARCH BAR — Multiple fallback methods
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function clickSearchAndType(page, query) {
  // Method 1: '/' keyboard shortcut
  try {
    await page.keyboard.press('/');
    await sleep(800);
    // Check if search is focused
    const focused = await page.evaluate(() => document.activeElement?.id === 'search' || document.activeElement?.tagName === 'INPUT');
    if (focused) {
      await page.keyboard.press('Control+a');
      await sleep(100);
      await page.keyboard.press('Backspace');
      await sleep(300);
      await humanType(page, query);
      return true;
    }
  } catch {}

  // Method 2: Click search input directly
  try {
    const searchInput = await page.$('input#search');
    if (searchInput) {
      await searchInput.click();
      await sleep(500);
      await page.keyboard.press('Control+a');
      await sleep(100);
      await page.keyboard.press('Backspace');
      await sleep(300);
      await humanType(page, query);
      return true;
    }
  } catch {}

  // Method 3: Click search button then input
  try {
    const searchBtn = await page.$('#search-icon-legacy, button[aria-label="Search"]');
    if (searchBtn) {
      await searchBtn.click();
      await sleep(800);
      await humanType(page, query);
      return true;
    }
  } catch {}

  // Method 4: Tab to search
  try {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      await sleep(200);
      const focused = await page.evaluate(() => document.activeElement?.id === 'search');
      if (focused) { await humanType(page, query); return true; }
    }
  } catch {}

  return false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SET VIDEO QUALITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function setVideoQuality(page, quality, logFn = () => {}) {
  if (!quality || quality === 'auto') {
    logFn('info', '[Quality] auto — no change');
    return true;
  }
  const qualityMap = { '144p': '144', '240p': '240', '360p': '360', '480p': '480', '720p': '720', '1080p': '1080' };
  const targetRes = qualityMap[quality] || String(quality).replace('p', '');
  const mobile = await isMobileYouTube(page);

  try {
    await sleep(mobile ? 1500 : 2000);

    if (mobile) {
      const setMobile = await page.evaluate((res) => {
        try {
          const v = document.querySelector('video');
          if (v && v.getVideoPlaybackQuality) {
            /* quality set via menu only on mobile */
          }
          const gear = document.querySelector(
            'button[aria-label*="Settings" i], button[aria-label*="Quality" i], .player-settings-icon, button.ytm-settings-button',
          );
          if (gear) { gear.click(); return 'opened-menu'; }
          return null;
        } catch { return null; }
      }, targetRes).catch(() => null);

      if (setMobile === 'opened-menu') {
        await sleep(800);
        const picked = await page.evaluate((res) => {
          const items = [...document.querySelectorAll('button, [role="menuitem"], .ytm-menu-item-renderer')];
          for (const el of items) {
            const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
            if (t.includes(res) && (t.includes('p') || t.includes(res))) {
              el.click();
              return true;
            }
          }
          return false;
        }, targetRes).catch(() => false);
        if (picked) {
          logFn('success', `[Quality] Mobile set to ${quality}`);
          return true;
        }
      }
      logFn('warn', `[Quality] Mobile ${quality} — menu not found (may stay auto)`);
      return false;
    }

    const settingsBtn = await page.$('.ytp-settings-button');
    if (!settingsBtn) {
      logFn('warn', '[Quality] Settings button not found');
      return false;
    }
    await settingsBtn.click();
    await sleep(800);

    const items = await page.$$('.ytp-menuitem');
    for (const item of items) {
      const text = await item.textContent().catch(() => '');
      if (text.toLowerCase().includes('quality') || text.toLowerCase().includes('qualit')) {
        await item.click();
        await sleep(600);
        break;
      }
    }

    const qualityOptions = await page.$$('.ytp-quality-menu .ytp-menuitem, .ytp-panel-menu .ytp-menuitem');
    for (const option of qualityOptions) {
      const text = await option.textContent().catch(() => '');
      if (text.includes(targetRes)) {
        await option.click();
        await sleep(500);
        logFn('success', `[Quality] Set to ${quality}`);
        return true;
      }
    }
    await page.keyboard.press('Escape');
    logFn('warn', `[Quality] ${quality} option not found`);
    return false;
  } catch (err) {
    logFn('warn', `[Quality] Error: ${err.message}`);
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISABLE AUTOPLAY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function disableAutoplay(page, logFn = () => {}) {
  let ok = false;
  try {
    await sleep(1500);
    const mobile = await isMobileYouTube(page);

    const clickIfOn = async (selector) => {
      const el = await page.$(selector);
      if (!el) return false;
      const isOn = await el.evaluate((node) => {
        return node.getAttribute('aria-pressed') === 'true'
          || node.getAttribute('aria-checked') === 'true'
          || node.classList.contains('ytp-autonav-toggle-button--active');
      }).catch(() => false);
      if (isOn) {
        await el.click({ force: true }).catch(() => {});
        await sleep(500);
        return true;
      }
      return false;
    };

    if (await clickIfOn('button[data-tooltip-target-id="autoplay-toggle-button"]')) ok = true;
    else if (await clickIfOn('.ytp-autonav-toggle-button[aria-checked="true"]')) ok = true;
    else if (await clickIfOn('button[aria-label*="Autoplay" i], button[aria-label*="autoplay" i]')) ok = true;

    if (mobile) {
      const mob = await page.evaluate(() => {
        const btn = document.querySelector(
          'button[aria-label*="Autoplay" i], ytm-toggle-button-renderer button, [class*="autonav"]',
        );
        if (btn) {
          const on = btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-checked') === 'true';
          if (on) { btn.click(); return true; }
          return true;
        }
        return false;
      }).catch(() => false);
      if (mob) ok = true;
    }

    await page.evaluate(() => {
      try {
        const keys = ['yt-player-autoplay', 'yt-player-bandwidth'];
        for (const k of keys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const prefs = JSON.parse(raw);
          if (prefs && typeof prefs === 'object') {
            prefs.autoplay = false;
            localStorage.setItem(k, JSON.stringify(prefs));
          }
        }
        try {
          localStorage.setItem('yt-player-autoplay', JSON.stringify({ autoplay: false }));
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    });
    ok = true;

    logFn(ok ? 'success' : 'warn', `[Autoplay] ${ok ? 'OFF' : 'could not confirm OFF'}`);
    return ok;
  } catch (err) {
    logFn('warn', `[Autoplay] Error: ${err.message}`);
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRAFFIC ROUTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function openVideoByTraffic(page, videoTitle, channelName, trafficType, videoUrl, backlinkData) {
  switch (trafficType) {
    case 'backlink':
      // Backlink traffic — open external page first, then find YouTube link
      if (backlinkData?.sourceUrl) {
        await page.goto(backlinkData.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(randomDelay(5000, 15000)); // Read page like human
        await humanMouseMove(page);
        await smoothScroll(page, randomDelay(200, 500), 'down');
        await sleep(randomDelay(2000, 5000));
        
        // Find YouTube link on page
        const ytLink = await page.$('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
        if (ytLink) {
          await humanMouseMove(page);
          await sleep(randomDelay(500, 1500));
          await ytLink.click();
          await sleep(randomDelay(3000, 5000));
          return true;
        }
        // Fallback: if no YouTube link found, search for video
        return await openVideoBySearch(page, videoTitle, channelName);
      }
      return await openVideoBySearch(page, videoTitle, channelName);

    case 'direct':
      // Direct URL — just navigate
      if (videoUrl) {
        await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        // Fallback to search if no URL
        return await openVideoBySearch(page, videoTitle, channelName);
      }
      return true;

    case 'suggested':
      // Go to channel page first, then find video
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(channelName)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(randomDelay(3000, 5000));
      // Click channel link
      const channelLink = await page.$('ytd-channel-renderer a, a[href*="/channel/"], a[href*="/@"]');
      if (channelLink) {
        await channelLink.click();
        await sleep(randomDelay(3000, 5000));
        // Click Videos tab
        const videosTab = await page.$('tp-yt-paper-tab:nth-child(2), [tab-title="Videos"]');
        if (videosTab) { await videosTab.click(); await sleep(randomDelay(2000, 4000)); }
        // Find and click the video
        const videoEl = await page.$(`a[title*="${videoTitle.substring(0, 30)}"], ytd-rich-item-renderer a#video-title-link`);
        if (videoEl) { await videoEl.click(); return true; }
      }
      // Fallback to search
      return await openVideoBySearch(page, videoTitle, channelName);

    case 'random':
      // Randomly pick a method (including backlink if data available)
      const methods = backlinkData?.sourceUrl ? ['search', 'direct', 'suggested', 'backlink'] : ['search', 'direct', 'suggested'];
      const picked = methods[Math.floor(Math.random() * methods.length)];
      return await openVideoByTraffic(page, videoTitle, channelName, picked, videoUrl, backlinkData);

    case 'google':
      // Google Search Referral — search on Google, click YouTube result
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomDelay(2000, 4000));
      
      // Find Google search box and type
      const googleInput = await page.$('input[name="q"], textarea[name="q"]');
      if (googleInput) {
        await googleInput.click();
        await sleep(randomDelay(300, 800));
        const googleQuery = `${channelName} ${videoTitle} youtube`;
        await humanType(page, googleQuery);
        await sleep(randomDelay(500, 1000));
        await page.keyboard.press('Enter');
        await sleep(randomDelay(3000, 6000));
        
        // Find YouTube result in Google search results
        const ytResult = await page.$('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
        if (ytResult) {
          await humanMouseMove(page);
          await sleep(randomDelay(1000, 3000));
          await ytResult.click();
          await sleep(randomDelay(3000, 5000));
          return true;
        }
      }
      // Fallback to YouTube search
      return await openVideoBySearch(page, videoTitle, channelName);

    case 'search':
    default:
      return await openVideoBySearch(page, videoTitle, channelName);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEARCH QUERY VARIATION ENGINE
// Har profile ke liye alag query — YouTube coordinated detection se bachne ke liye
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateSearchQuery(videoTitle, channelName) {
  const title = videoTitle || '';
  const channel = channelName || '';

  // Title ke words
  const titleWords = title.split(' ').filter(w => w.length > 2);
  const shortTitle = titleWords.slice(0, Math.floor(titleWords.length * 0.6) + 1).join(' ');
  const longTitle = titleWords.join(' ');

  // Channel short form
  const channelShort = channel.split(' ')[0]; // First word only

  // Query variations pool
  const variations = [
    // Full: channel + title
    channel ? `${channel} ${title}` : title,
    // Short title only
    shortTitle,
    // Channel short + title
    channel ? `${channelShort} ${title}` : title,
    // Title + channel
    channel ? `${title} ${channel}` : title,
    // Title with year
    `${title} ${new Date().getFullYear()}`,
    // Short title + channel
    channel ? `${shortTitle} ${channelShort}` : shortTitle,
    // Title only (no channel)
    longTitle,
    // Channel + short title
    channel ? `${channel} ${shortTitle}` : shortTitle,
  ].filter(q => q.trim().length > 3);

  // Pick random variation
  return variations[Math.floor(Math.random() * variations.length)];
}

async function openVideoBySearch(page, videoTitle, channelName) {
  await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(randomDelay(2000, 4000));
  await forceDarkTheme(page);
  await humanMouseMove(page);

  // UNIQUE query per profile — not same for all
  const searchQuery = generateSearchQuery(videoTitle, channelName);
  const typed = await clickSearchAndType(page, searchQuery);
  if (!typed) return false;

  await sleep(randomDelay(500, 1000));
  await page.keyboard.press('Enter');
  await sleep(randomDelay(3000, 5000));

  // Wait for results
  await page.waitForSelector('ytd-video-renderer', { timeout: 10000 }).catch(() => {});
  await sleep(randomDelay(1500, 3000));

  // HUMAN BEHAVIOR: Don't click immediately — browse results first
  // Each profile gets DIFFERENT scroll amounts (wider range = less detectable)
  const scrollDown1 = randomDelay(150, 600);
  const scrollDown2 = randomDelay(80, 400);
  const scrollUp1 = randomDelay(100, 550);

  await smoothScroll(page, scrollDown1, 'down');
  await sleep(randomDelay(1000, 4000));
  await smoothScroll(page, scrollDown2, 'down');
  await sleep(randomDelay(800, 3500));
  await smoothScroll(page, scrollUp1, 'up');
  await sleep(randomDelay(800, 2500));

  // Now find and click the CORRECT video (title match)
  const videoLink = await page.evaluate((searchTitle) => {
    const results = document.querySelectorAll('ytd-video-renderer a#video-title');
    const titleLower = searchTitle.toLowerCase();
    // First pass: find exact/close match
    for (const el of results) {
      const resultTitle = (el.getAttribute('title') || el.textContent || '').toLowerCase();
      if (resultTitle.includes(titleLower) || titleLower.includes(resultTitle.substring(0, 20))) {
        return true; // Found matching video
      }
    }
    return false;
  }, videoTitle);

  if (videoLink) {
    // Click the matched video
    const matchedVideo = await page.evaluateHandle((searchTitle) => {
      const results = document.querySelectorAll('ytd-video-renderer a#video-title');
      const titleLower = searchTitle.toLowerCase();
      for (const el of results) {
        const resultTitle = (el.getAttribute('title') || el.textContent || '').toLowerCase();
        if (resultTitle.includes(titleLower) || titleLower.includes(resultTitle.substring(0, 20))) {
          return el;
        }
      }
      return results[0]; // Fallback to first if no match
    }, videoTitle);

    if (matchedVideo) {
      await humanMouseMove(page);
      await sleep(randomDelay(500, 1500));
      await matchedVideo.click();
      return true;
    }
  }

  // Fallback: click first result if no title match
  const firstVideo = await page.$('ytd-video-renderer a#video-title');
  if (firstVideo) {
    await humanMouseMove(page);
    await sleep(randomDelay(500, 1500));
    await firstVideo.click();
    return true;
  }
  return false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGAGEMENT ACTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function performEngagement(page, config) {
  if (!config) return;
  await sleep(randomDelay(5000, 15000)); // Wait before engaging

  // Like — setting ON = always attempt
  if (config.likeEnabled) {
    try {
      const likeBtn = await page.$('like-button-view-model button, ytd-toggle-button-renderer#top-level-buttons-computed button:first-child, button[aria-label*="like"]');
      if (likeBtn) {
        const isLiked = await likeBtn.evaluate(el => el.getAttribute('aria-pressed') === 'true');
        if (!isLiked) {
          await humanMouseMove(page);
          await sleep(randomDelay(500, 1500));
          await likeBtn.click();
          await sleep(randomDelay(1000, 2000));
        }
      }
    } catch {}
  }

  // Subscribe — setting ON = always attempt
  if (config.subscribeEnabled) {
    try {
      const subBtn = await page.$('#subscribe-button button, ytd-subscribe-button-renderer button');
      if (subBtn) {
        const text = await subBtn.textContent().catch(() => '');
        if (text && !text.toLowerCase().includes('subscribed')) {
          await humanMouseMove(page);
          await sleep(randomDelay(1000, 3000));
          await subBtn.click();
          await sleep(randomDelay(1000, 2000));
        }
      }
    } catch {}
  }

  // Comment — setting ON + text = always attempt
  if (config.commentEnabled && config.commentText) {
    try {
      await smoothScroll(page, randomDelay(400, 800), 'down');
      await sleep(randomDelay(2000, 4000));
      const commentBox = await page.$('#simplebox-placeholder, #placeholder-area');
      if (commentBox) {
        await commentBox.click();
        await sleep(randomDelay(1000, 2000));
        await humanType(page, config.commentText);
        await sleep(randomDelay(1000, 2000));
        // Submit comment
        const submitBtn = await page.$('#submit-button button, tp-yt-paper-button#submit-button');
        if (submitBtn) await submitBtn.click();
        await trackEngagement(this.profileId, 'comment').catch(() => {});
        await sleep(randomDelay(2000, 3000));
      }
    } catch {}
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
    this.currentVideo = null;
    this.options = options;
    this.cdpEndpoint = options.cdpEndpoint || null;
    this.logs = [];
    this.retryCount = 0;
    this.maxRetries = 3;
    
    // Per-profile personality (scroll curves, phases, typing) — stable per profileId
    this._personality = createProfilePersonality(profileId);
    this.typingSpeed = this._personality.typingSpeed;
    this._videoIndex = 0;
    
    // Profile index for traffic source assignment
    this._profileIndex = parseInt(profileId.slice(-4), 16) || Math.floor(Math.random() * 100);

    // Session-level flags — initialized ONCE per session (not per video)
    // _subscribedThisSession must NOT be reset on every video — subscribe should fire at most once per session
    this._subscribedThisSession = false;
    this._warmedUp = false;
    // Cached Android detection — evaluated once during warmup, reused for all videos
    this._isAndroidProfile = false;
    this._blockRecoveryCount = 0;
    this._maxBlockRecoveries = 2;
  }

  /**
   * Sign-in / captcha wall → clear cache or recreate via worker callback.
   */
  async recoverFromPageBlock(page, reason = 'block') {
    if (this._blockRecoveryCount >= this._maxBlockRecoveries) {
      this.log('error', `Max block recoveries (${this._maxBlockRecoveries}) reached`);
      return false;
    }
    if (!this.options.onRecoverProfile) {
      this.log('warn', 'No recovery handler — cannot clear cache / recreate');
      return false;
    }

    const strategy = this._blockRecoveryCount === 0 ? 'clear_cache' : 'recreate';
    this._blockRecoveryCount++;
    this.log('warn', `[Recovery ${this._blockRecoveryCount}] ${reason} → ${strategy}`);

    try {
      await this.disconnect().catch(() => {});
    } catch {}

    const result = await this.options.onRecoverProfile({
      profileId: this.profileId,
      strategy,
      profileName: this.profileName,
    });

    if (!result?.ok || !result.cdpPort) {
      this.log('error', `Recovery failed: ${result?.message || 'unknown'}`);
      return false;
    }

    if (result.profileId && result.profileId !== this.profileId) {
      this.log('info', `Profile ID updated after recreate: ${this.profileId} → ${result.profileId}`);
      this.profileId = result.profileId;
    }

    this.debugPort = result.cdpPort;
    this._warmedUp = false;
    this._lastPage = null;
    const connected = await this.connect();
    if (connected) {
      this.log('success', `Reconnected after recovery on port ${this.debugPort}`);
    }
    return connected;
  }

  async ensurePageNotBlocked(page, config) {
    const block = await detectPageBlock(page);
    if (!block.blocked) return true;
    this.log('warn', `Page block (${block.kind}): ${block.message}`);
    const recovered = await this.recoverFromPageBlock(page, block.kind);
    if (!recovered) return false;
    return true;
  }

  log(level, message) {
    const entry = { time: new Date().toISOString(), level, message, profileId: this.profileId };
    this.logs.push(entry);
    if (this.logs.length > 50) this.logs = this.logs.slice(-50);
    console.log(`[${this.profileName}] [${level}] ${message}`);
    // Forward to worker thread → main process → frontend UI
    if (this.options.onLog) this.options.onLog(level, message);
    return entry;
  }

  async connect() {
    this.status = 'connecting';
    const endpoint = this.cdpEndpoint || `http://127.0.0.1:${this.debugPort}`;
    this.log('info', `Connecting to CDP at ${endpoint}...`);
    try {
      this.browser = await chromium.connectOverCDP(endpoint);
      this.context = this.browser.contexts()[0];
      if (!this.context) this.context = await this.browser.newContext();
      this.status = 'running';
      this.log('success', `Connected! CDP: ${endpoint}`);
      return true;
    } catch (err) {
      this.status = 'error';
      this.log('error', `CDP connection failed: ${err.message}`);
      return false;
    }
  }

  /** Multilogin browser needs several seconds after launcher start before CDP accepts connections. */
  async connectWithRetry(maxAttempts = 10, delayMs = 4000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (await this.connect()) return true;
      if (attempt < maxAttempts) {
        this.log('warn', `CDP not ready (${attempt}/${maxAttempts}) — retry in ${Math.round(delayMs / 1000)}s...`);
        await sleep(delayMs);
      }
    }
    return false;
  }

  // WARMUP — Browse homepage + maybe watch 1-2 shorts (like real user)
  async warmup() {
    if (!this.context) return;
    this.log('info', 'Warmup: Browsing YouTube homepage...');
    this.status = 'warmup';

    try {
      const page = this.context.pages()[0] || await this.context.newPage();
      this._lastPage = page;

      // Detect Android/mobile profile via User-Agent BEFORE navigating anywhere
      // This is the only reliable way — antidetect browsers may not auto-redirect
      // www.youtube.com to m.youtube.com even with an Android UA
      const isAndroid = await isAndroidUA(page);
      if (isAndroid) {
        this.log('info', 'Warmup: Android profile detected — using mobile YouTube (m.youtube.com)');
        this._isAndroidProfile = true;
      }

      // Go to correct YouTube homepage (mobile or desktop)
      const ytHome = isAndroid ? 'https://m.youtube.com' : 'https://www.youtube.com';
      await page.goto(ytHome, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomDelay(2000, 4000));

      // Dark theme only works on desktop YouTube
      if (!isAndroid) await forceDarkTheme(page);

      // Browse homepage (scroll around like real user)
      await humanMouseMove(page);
      await sleep(randomDelay(2000, 4000));
      await smoothScroll(page, randomDelay(200, 400), 'down');
      await sleep(randomDelay(3000, 6000));
      await smoothScroll(page, randomDelay(100, 300), 'down');
      await sleep(randomDelay(2000, 5000));
      await smoothScroll(page, randomDelay(200, 400), 'up');
      await sleep(randomDelay(1000, 3000));

      // 40% chance: Watch 1-3 Shorts — desktop only, wrapped in its own try/catch
      // so a Shorts timeout does NOT break the page for the main video search
      if (!isAndroid && Math.random() < 0.4) {
        try {
          this.log('info', 'Warmup: Watching a few Shorts...');
          await page.goto('https://www.youtube.com/shorts', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(randomDelay(2000, 4000));
          const shortsCount = randomDelay(1, 3);
          for (let i = 0; i < shortsCount; i++) {
            await sleep(randomDelay(5000, 15000)); // Watch short
            await page.keyboard.press('ArrowDown'); // Next short
            await sleep(randomDelay(500, 1500));
          }
          // Go back to homepage
          await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(randomDelay(2000, 4000));
        } catch (shortsErr) {
          // Shorts failed — recover by going back to main YouTube page
          this.log('warn', `Warmup Shorts skipped: ${shortsErr.message.split('\n')[0]}`);
          try {
            await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
            await sleep(1000);
          } catch {
            // Page is unrecoverable — clear _lastPage so searchAndWatch opens a fresh page
            this.log('warn', 'Warmup: page unrecoverable — will open fresh page for video');
            this._lastPage = null;
          }
        }
      }

      this.log('success', 'Warmup complete — ready to watch videos');
    } catch (err) {
      this.log('warn', `Warmup failed (non-critical): ${err.message.split('\n')[0]}`);
      // Clear broken page reference so searchAndWatch always starts fresh
      this._lastPage = null;
    }
  }

  // Main watch function with traffic routing + engagement
  async searchAndWatch(videoTitle, channelName, config = {}, _retryDepth = 0) {
    if (!this.context) { this.log('error', 'No browser context'); return false; }

    // WARMUP: First video of session — browse homepage + maybe shorts
    if (!this._warmedUp) {
      await this.warmup();
      this._warmedUp = true;
    }

    // Reset per-video flags (like/comment are per-video, subscribe is per-SESSION so NOT reset here)
    this._likedThisVideo = false;
    this._commentedThisVideo = false;
    this._dislikedThisVideo = false;
    this._seekedForward = false;
    this._qaScrolledEarly = false;

    this.currentVideo = videoTitle;
    this.status = 'searching';
    const trafficType = config.trafficPreference || 'search';
    this.log('info', `[${trafficType}] Searching: "${videoTitle}"`);

    // SESSION PERSISTENCE: Reuse existing page instead of opening new one every time
    // If _lastPage was cleared (e.g. warmup failed) always open a fresh page
    let page;
    try {
      const existingPages = this.context.pages();
      if (this._lastPage && existingPages.includes(this._lastPage)) {
        // Verify page is still alive (not crashed/closed)
        try {
          await this._lastPage.evaluate(() => true);
          page = this._lastPage;
        } catch {
          // Page is dead — create new one
          page = await this.context.newPage();
          this._lastPage = page;
        }
      } else if (!this._lastPage) {
        // Warmup cleared _lastPage — always open fresh page (avoid reusing broken pages)
        page = await this.context.newPage();
        this._lastPage = page;
      } else {
        page = existingPages.length > 0 ? existingPages[existingPages.length - 1] : await this.context.newPage();
        this._lastPage = page;
      }
    } catch {
      // Context might be broken — try new page
      page = await this.context.newPage();
      this._lastPage = page;
    }

    try {
      // MOBILE DETECTION: Check User-Agent first — most reliable signal.
      // Antidetect browsers may not auto-redirect www.youtube.com → m.youtube.com
      // even for Android profiles, so URL-based detection alone is unreliable.
      //
      // Use cached result from warmup if available (avoids repeat UA evaluation)
      const isAndroid = this._isAndroidProfile || await isAndroidUA(page);
      if (isAndroid) this._isAndroidProfile = true; // cache for future videos

      if (isAndroid) {
        // Android profile: force navigation to mobile YouTube if not already there
        const currentUrl = page.url();
        if (!currentUrl.includes('m.youtube.com')) {
          this.log('info', '[Mobile] Navigating to m.youtube.com for Android profile...');
          await page.goto('https://m.youtube.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await sleep(randomDelay(1000, 2000));
        }
      } else {
        // Desktop profile: apply dark theme and check if somehow mobile
        await forceDarkTheme(page);
        const currentUrl = page.url();
        if (!currentUrl.includes('youtube.com') && !currentUrl.includes('google.com') && !currentUrl.includes('bing.com')) {
          // Fresh page — peek at what YouTube serves us
          await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await sleep(1000);
        }
      }

      const isMobile = isAndroid || await isMobileYouTube(page);

      const useBacklink = String(config.trafficPreference || '').toLowerCase() === 'backlink'
        || !!config.backlinkData?.sourceUrl;

      let searchResult;
      if (useBacklink) {
        if (!(await this.ensurePageNotBlocked(page, config))) {
          return false;
        }
        searchResult = await openVideoViaBacklink(
          page,
          videoTitle,
          channelName,
          config.videoUrl || '',
          config.backlinkData,
          (level, msg) => this.log(level, msg),
        );
        if (!searchResult?.success && _retryDepth < this.maxRetries) {
          this.log('warn', '[Backlink] Referral failed — trying smart search fallback…');
          const effectiveMix = resolveTrafficMix(config);
          searchResult = await openVideoSmart(
            page,
            videoTitle,
            channelName,
            config.videoUrl || '',
            config.expectedDuration || 0,
            this._profileIndex || 0,
            (p, text) => humanType(p, text, this.typingSpeed),
            (level, msg) => this.log(level, msg),
            effectiveMix,
            config.trafficPreference === 'backlink' ? 'search' : (config.trafficPreference || 'custom'),
            { strictTraffic: !!config.qaTestMode },
          );
        }
      } else if (isMobile) {
        const pref = String(config.trafficPreference || 'search').toLowerCase();
        const externalEngines = new Set(['google', 'bing', 'duckduckgo', 'yahoo']);
        const useRealEngine = externalEngines.has(pref) || pref === 'direct';

        if (useRealEngine) {
          // Google/Bing/Yahoo/DuckDuckGo/Direct must hit real sites — NOT m.youtube.com/results URL paste
          this.log('info', `[Mobile] Android profile — using REAL traffic: ${pref} (google.com / bing.com / direct URL)`);
          if (!(await this.ensurePageNotBlocked(page, config))) {
            return false;
          }
          const effectiveMix = resolveTrafficMix(config);
          searchResult = await openVideoSmart(
            page,
            videoTitle,
            channelName,
            config.videoUrl || '',
            config.expectedDuration || 0,
            this._profileIndex || 0,
            (p, text) => humanType(p, text, this.typingSpeed),
            (level, msg) => this.log(level, msg),
            effectiveMix,
            pref,
            { strictTraffic: !!config.qaTestMode },
          );
        } else {
          // YouTube search / suggested / custom → mobile YouTube search UI, then full fallback chain
          this.log('info', '[Mobile] Android profile — YouTube search on m.youtube.com');
          let mobileSuccess = await mobileYouTubeSearch(page, videoTitle, channelName, (level, msg) => this.log(level, msg));
          if (!mobileSuccess) {
            this.log('warn', '[Mobile] YouTube search failed — trying external search fallback chain...');
            const effectiveMix = resolveTrafficMix(config);
            searchResult = await openVideoSmart(
              page,
              videoTitle,
              channelName,
              config.videoUrl || '',
              config.expectedDuration || 0,
              this._profileIndex || 0,
              (p, text) => humanType(p, text, this.typingSpeed),
              (level, msg) => this.log(level, msg),
              effectiveMix,
              config.trafficPreference || 'custom',
              { strictTraffic: !!config.qaTestMode },
            );
            mobileSuccess = !!searchResult?.success;
          }
          if (!mobileSuccess && config.videoUrl) {
            mobileSuccess = await mobileDirectWatch(page, config.videoUrl, (level, msg) => this.log(level, msg));
            if (mobileSuccess) {
              searchResult = { success: true, source: 'mobile-direct-fallback', intendedSource: 'youtube-search', usedFallback: true };
            }
          }
          if (!searchResult) {
            searchResult = { success: mobileSuccess, source: 'mobile-youtube-search', intendedSource: 'youtube-search' };
          }
        }
      } else {
        // DESKTOP PATH: Use smart search engine (escalation + verification + multi-source)
        const effectiveMix = resolveTrafficMix(config);
        if (!(await this.ensurePageNotBlocked(page, config))) {
          return false;
        }

        searchResult = await openVideoSmart(
          page,
          videoTitle,
          channelName,
          config.videoUrl || '',
          config.expectedDuration || 0,
          this._profileIndex || 0,
          (p, text) => humanType(p, text, this.typingSpeed),
          (level, msg) => this.log(level, msg),
          effectiveMix,
          config.trafficPreference || 'custom',
          { strictTraffic: !!config.qaTestMode },
        );
      }

      if (searchResult?.blocked && _retryDepth < this.maxRetries) {
        const recovered = await this.recoverFromPageBlock(page, searchResult.blockKind || 'blocked');
        if (recovered) {
          return await this.searchAndWatch(videoTitle, channelName, config, _retryDepth + 1);
        }
      }

      if (!searchResult || !searchResult.success) {
        this.log('error', `Could not open video: "${videoTitle}"${searchResult?.verifyReason ? ` (${searchResult.verifyReason})` : ''}`);
        // Auto-recovery: retry with different approach
        if (_retryDepth < this.maxRetries) {
          this.log('warn', `Retrying (${_retryDepth + 1}/${this.maxRetries})...`);
          await sleep(randomDelay(3000, 8000));
          return await this.searchAndWatch(videoTitle, channelName, config, _retryDepth + 1);
        }
        return false;
      }
      
      // Track which source was used (for analytics)
      this._lastTrafficSource = searchResult.source;
      if (searchResult.intendedSource && searchResult.source !== searchResult.intendedSource) {
        this.log(
          'warn',
          `[Traffic] Intended: ${searchResult.intendedSource} → Actual: ${searchResult.source}${searchResult.usedFallback ? ' (fallback)' : ''}${searchResult.query ? ` | query: "${searchResult.query}"` : ''}`,
        );
      } else {
        this.log('success', `[Traffic] Opened via: ${searchResult.source}${searchResult.query ? ` | query: "${searchResult.query}"` : ''}`);
      }

      const postVerify = await verifyOpenedVideo(page, {
        title: videoTitle,
        channelName,
        videoUrl: config.videoUrl || '',
      });
      if (!postVerify.ok) {
        this.log('error', `Wrong video after open (${postVerify.reason}) — "${postVerify.actual?.title}"`);
        if (_retryDepth < this.maxRetries) {
          await sleep(randomDelay(2000, 5000));
          return await this.searchAndWatch(videoTitle, channelName, config, _retryDepth + 1);
        }
        return false;
      }

      if (!(await this.ensurePageNotBlocked(page, config))) {
        return false;
      }

      // Success — no reset needed (depth resets automatically on fresh call)
      await sleep(randomDelay(3000, 6000));
      await forceDarkTheme(page);
      await disableAutoplay(page, (l, m) => this.log(l, m));
      await setVideoQuality(page, config.videoQuality, (l, m) => this.log(l, m));
      await overridePageVisibility(page);

      this.status = 'watching';
      this.log('success', `Now watching: "${videoTitle}"`);

      const duration = await this.getVideoDuration(page, config);
      const { watchTime, watchPercent } = computeWatchTimeMs(
        duration,
        config,
        this.profileId,
        this._videoIndex++,
      );
      this.log(
        'info',
        `Duration: ${Math.round(duration / 1000)}s — Profile watch ${watchPercent}% (${config.watchTimeMin}–${config.watchTimeMax}% range) = ${Math.round(watchTime / 1000)}s`,
      );

      await this.watchVideo(page, watchTime, config);

      this.log('success', `Finished: "${videoTitle}" (${watchPercent}%)`);
      
      // Track view + watch time in analytics
      await trackEngagement(this.profileId, 'view').catch(() => {});
      await trackEngagement(this.profileId, 'watchTime', Math.round(watchTime / 1000)).catch(() => {});
      await trackEngagement(this.profileId, 'session').catch(() => {});
      // Track traffic source (youtube-search, google, bing, direct, channel-page)
      if (this._lastTrafficSource) {
        await trackEngagement(this.profileId, `traffic_${this._lastTrafficSource}`).catch(() => {});
      }
      
      // Track in watch history (prevents repeat)
      await this.trackWatchHistory(videoTitle, watchPercent, config.videoId || '').catch(() => {});
      
      // Don't close page — reuse for next video (session persistence)
      return true;
    } catch (err) {
      this.log('error', `Error: ${err.message}`);
      // Do NOT page.close() here — kills the only tab and Multilogin window looks "closed"
      if (_retryDepth < this.maxRetries) {
        this.log('warn', `Auto-recovery retry (${_retryDepth + 1}/${this.maxRetries})...`);
        await sleep(randomDelay(5000, 10000));
        return await this.searchAndWatch(videoTitle, channelName, config, _retryDepth + 1);
      }
      return false;
    }
  }

  async watchByUrl(videoUrl, config = {}) {
    if (!this.context) { this.log('error', 'No browser context'); return false; }

    // WARMUP: First video of session
    if (!this._warmedUp) {
      await this.warmup();
      this._warmedUp = true;
    }

    // Reset per-video flags (subscribe is per-SESSION so NOT reset here)
    this._likedThisVideo = false;
    this._commentedThisVideo = false;
    this._dislikedThisVideo = false;
    this._seekedForward = false;
    this._qaScrolledEarly = false;

    this.currentVideo = videoUrl;
    this.status = 'watching';
    try {
      // Reuse existing page (session persistence) instead of new page every time
      let page;
      try {
        const existingPages = this.context.pages();
        if (this._lastPage && existingPages.includes(this._lastPage)) {
          try { await this._lastPage.evaluate(() => true); page = this._lastPage; } catch {}
        }
        if (!page) {
          page = existingPages.length > 0 ? existingPages[existingPages.length - 1] : await this.context.newPage();
          this._lastPage = page;
        }
      } catch {
        page = await this.context.newPage();
        this._lastPage = page;
      }

      await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(randomDelay(3000, 6000));

      if (!(await this.ensurePageNotBlocked(page, config))) {
        return false;
      }

      const directVerify = await verifyOpenedVideo(page, {
        videoUrl,
        title: config.expectedTitle || '',
        channelName: config.channelName || '',
      });
      if (!directVerify.ok && config.expectedTitle) {
        this.log('error', `Direct URL wrong video (${directVerify.reason})`);
        return false;
      }

      await forceDarkTheme(page);
      await disableAutoplay(page, (l, m) => this.log(l, m));
      await setVideoQuality(page, config.videoQuality, (l, m) => this.log(l, m));
      await overridePageVisibility(page);

      const duration = await this.getVideoDuration(page, config);
      const { watchTime, watchPercent } = computeWatchTimeMs(
        duration,
        config,
        this.profileId,
        this._videoIndex++,
      );
      if (config.qaTestMode) {
        this.log('info', `[QA] Watch target: ${Math.round(watchTime / 1000)}s (${watchPercent}% + QA cap)`);
      } else {
        this.log(
          'info',
          `Duration: ${Math.round(duration / 1000)}s — Profile watch ${watchPercent}% (${config.watchTimeMin}–${config.watchTimeMax}%) = ${Math.round(watchTime / 1000)}s`,
        );
      }

      // BUG FIX: Pass config to watchVideo (was missing — ad skip, scroll etc. were ignored)
      // BUG FIX: Removed duplicate performEngagement — watchVideo phases handle engagement
      await this.watchVideo(page, watchTime, config);

      // Track analytics
      await trackEngagement(this.profileId, 'view').catch(() => {});
      await trackEngagement(this.profileId, 'watchTime', Math.round(watchTime / 1000)).catch(() => {});
      await trackEngagement(this.profileId, 'session').catch(() => {});

      const title = config.expectedTitle || videoUrl;
      await this.trackWatchHistory(title, watchPercent, config.videoId || '').catch(() => {});

      return true;
    } catch (err) {
      this.log('error', `URL watch error: ${err.message}`);
      return false;
    }
  }

  async getVideoDuration(page, config = {}) {
    // ─────────────────────────────────────────────────────
    // STEP 1: Pehle saari ads khatam hone do — max 5 min wait
    // 60s nahi, 300s — kyunki 2min unskippable ads bhi aati hain
    // BUG FIX: config accept karo taaki adSkipEnabled respect ho
    // ─────────────────────────────────────────────────────
    const adSkipEnabled = config.adSkipEnabled !== false; // default true
    this.log('info', `Waiting for ads to finish (adSkip: ${adSkipEnabled ? 'ON' : 'OFF'})...`);
    // Poll every 2s instead of 1s — halves CDP calls (150 max vs 300) without affecting ad detection.
    // With 50 profiles concurrent, this saves ~7500 CDP evaluate() calls per 5-min window.
    for (let adWait = 0; adWait < 150; adWait++) { // max 5 min (150 × 2s = 300s)
      try {
        const adInfo = await page.evaluate(() => {
          const selectors = [
            '.ytp-ad-player-overlay',
            '.ad-showing',
            '.ytp-ad-text',
            '.ytp-ad-preview-text',
            '.ytp-ad-overlay-container',
            '[class*="ad-showing"]',
          ];
          const hasAd = selectors.some(s => !!document.querySelector(s));
          const timeEl = document.querySelector('.ytp-time-duration');
          const timeText = timeEl?.textContent?.trim() || '';
          return { hasAd, timeText };
        });

        if (!adInfo.hasAd) {
          this.log('info', `Ads finished after ${adWait}s — reading real duration now`);
          break;
        }

        // BUG FIX: Only skip if adSkipEnabled — respect user's config
        if (adSkipEnabled) {
          await page.evaluate(() => {
            const skipBtn = document.querySelector(
              '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, [class*="skip-button"]'
            );
            if (skipBtn) skipBtn.click();
          }).catch(() => {});
        }

        if (adWait % 5 === 0 && adWait > 0) {
          this.log('info', `Ad still playing... waited ${adWait * 2}s so far${adSkipEnabled ? ' (trying to skip)' : ' (watching full per config)'}`);
        }
      } catch {}
      await sleep(2000); // 2s interval — halves CDP load vs 1s
    }

    // ─────────────────────────────────────────────────────
    // STEP 2: Ab real video duration lo — 3 methods
    // ─────────────────────────────────────────────────────
    // Extra 2s wait — YouTube ko video duration load karne do
    await sleep(2000);

    for (let i = 0; i < 20; i++) {
      try {
        const duration = await page.evaluate(() => {
          // Double check — ad abhi bhi nahi hai
          const adOverlay = document.querySelector('.ytp-ad-player-overlay, .ad-showing, [class*="ad-showing"]');
          if (adOverlay) return 0;

          // Method 1: video element se directly
          const video = document.querySelector('video');
          if (video && video.duration && isFinite(video.duration) && video.duration > 10) {
            return Math.round(video.duration * 1000);
          }

          // Method 2: .ytp-time-duration display text se
          // Format: "12:34" ya "1:23:45"
          const el = document.querySelector('.ytp-time-duration');
          if (el && el.textContent && !el.textContent.includes('Ad')) {
            const parts = el.textContent.trim().split(':').map(Number);
            if (parts.length === 3 && parts.every(p => !isNaN(p))) {
              return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
            }
            if (parts.length === 2 && parts.every(p => !isNaN(p)) && parts[0] >= 0) {
              return (parts[0] * 60 + parts[1]) * 1000;
            }
          }

          // Method 3: ytd-watch-metadata se (backup)
          const metaDuration = document.querySelector('ytd-watch-metadata span.ytd-badge-and-author-renderer');
          if (metaDuration?.textContent) {
            const parts = metaDuration.textContent.trim().split(':').map(Number);
            if (parts.length === 2 && parts.every(p => !isNaN(p))) {
              return (parts[0] * 60 + parts[1]) * 1000;
            }
          }

          return 0;
        });

        if (duration > 10000) { // kam se kam 10 second ki video honi chahiye
          this.log('info', `Real video duration: ${Math.round(duration / 1000)}s`);
          return duration;
        }
      } catch {}
      await sleep(500);
    }

    // Fallback: 5 min default
    this.log('warn', 'Could not read duration — using 5min default');
    return 300000;
  }

  // Handle YouTube ads — properly waits for ALL ad types including long unskippable ones
  async handleAds(page, config = {}) {
    const adSkipEnabled = config.adSkipEnabled !== false;
    const adSkipAfterSec = config.adSkipAfterSec || 15;
    let totalAdTime = 0;
    let adsCount = 0;
    let adsSkipped = 0;

    // Max 10 ads handle karo (safety limit)
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        // ── Check if ad is playing ──
        const adInfo = await page.evaluate(() => {
          const isAdShowing = !!(
            document.querySelector('.ytp-ad-player-overlay') ||
            document.querySelector('.ad-showing') ||
            document.querySelector('.ytp-ad-overlay-container') ||
            document.querySelector('.ytp-ad-text') ||
            document.querySelector('.ytp-ad-preview-text')
          );
          if (!isAdShowing) return { hasAd: false };

          // Ad ki real duration pado
          const video = document.querySelector('video');
          const adDurationSec = (video && video.duration && isFinite(video.duration))
            ? Math.round(video.duration)
            : 0;

          // Skip button hai ya nahi
          const skipBtn = document.querySelector(
            '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, [class*="skip-button"]'
          );

          // Countdown timer — "5 seconds" type text
          const countdownEl = document.querySelector('.ytp-ad-skip-button-slot, .ytp-ad-preview-container');
          const countdownText = countdownEl?.textContent?.trim() || '';

          return { hasAd: true, adDurationSec, hasSkipBtn: !!skipBtn, countdownText };
        }).catch(() => ({ hasAd: false }));

        if (!adInfo.hasAd) break; // Koi ad nahi — bahar niklo

        adsCount++;
        const adStartTime = Date.now();
        this.log('info', `📺 Ad #${adsCount} detected — duration: ${adInfo.adDurationSec}s, skippable: ${adInfo.hasSkipBtn}`);

        if (!adSkipEnabled) {
          // Skip disabled — puri ad dekho
          // Real ad duration use karo (blind wait nahi)
          const waitMs = adInfo.adDurationSec > 0
            ? (adInfo.adDurationSec * 1000 + 2000)
            : 60000; // fallback 1 min
          this.log('info', `Ad Skip OFF — watching full ad (${Math.round(waitMs/1000)}s)`);
          await this._waitForAdToFinish(page, waitMs);
          totalAdTime += Date.now() - adStartTime;
          continue;
        }

        // ── Skip enabled — try to skip ──
        // Pehle skip timer wait karo
        await sleep(adSkipAfterSec * 1000 + randomDelay(300, 1000));

        // Skip button dhundo aur click karo
        const skipped = await page.evaluate(() => {
          const btn = document.querySelector(
            '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, [class*="skip-button"]'
          );
          if (btn) { btn.click(); return true; }
          return false;
        }).catch(() => false);

        if (skipped) {
          adsSkipped++;
          this.log('info', `✓ Ad skipped after ${adSkipAfterSec}s`);
          totalAdTime += Date.now() - adStartTime;
          await sleep(randomDelay(1000, 2000));
          continue;
        }

        // ── Skip button nahi mila — unskippable ad ──
        // Andha wait nahi — real duration track karo
        this.log('info', `Unskippable ad — waiting for it to finish naturally (${adInfo.adDurationSec}s)`);
        const unskippableWait = adInfo.adDurationSec > 0
          ? (adInfo.adDurationSec * 1000 + 3000) // real duration + 3s buffer
          : 120000; // fallback 2 min
        await this._waitForAdToFinish(page, unskippableWait);
        totalAdTime += Date.now() - adStartTime;

      } catch (err) {
        this.log('warn', `Ad handling error: ${err.message}`);
        break;
      }
    }

    if (adsCount > 0) {
      this.log('info', `Ads done — total: ${adsCount}, skipped: ${adsSkipped}, time: ${Math.round(totalAdTime/1000)}s`);
      await trackEngagement(this.profileId, 'ads_total', adsCount).catch(() => {});
      await trackEngagement(this.profileId, 'ads_skipped', adsSkipped).catch(() => {});
      await trackEngagement(this.profileId, 'ads_watched_full', adsCount - adsSkipped).catch(() => {});
      await trackEngagement(this.profileId, 'ad_watch_time', Math.round(totalAdTime / 1000)).catch(() => {});
    }
    
    return { totalAdTime, adsCount, adsSkipped };
  }

  // Ad khatam hone ka intezaar karo — blind sleep nahi, har second check karo
  async _waitForAdToFinish(page, maxWaitMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await sleep(1000);
      try {
        const stillHasAd = await page.evaluate(() => {
          return !!(
            document.querySelector('.ytp-ad-player-overlay') ||
            document.querySelector('.ad-showing') ||
            document.querySelector('.ytp-ad-text')
          );
        });
        if (!stillHasAd) {
          this.log('info', `Ad finished after ${Math.round((Date.now()-startTime)/1000)}s`);
          return;
        }
      } catch { break; }
    }
  }

  async watchVideo(page, durationMs, config = {}) {
    // ═══════════════════════════════════════════════════
    // FIX: Ad time timer se BAHAR hai
    // Kitni bhi ads aayein — durationMs ki guarantee hai
    // ═══════════════════════════════════════════════════

    // Handle pre-roll ads pehle
    // Mobile YouTube pe handleAds selectors fail kar sakte hain — but it's non-critical
    await this.handleAds(page, config);

    const startTime = Date.now();
    let totalAdTime = 0;        // FIX: Total ad time track karo
    let adPlaying = false;      // FIX: Ad chal rahi hai ya nahi
    let adStartTime = 0;        // FIX: Current ad kab shuru hui

    // ── Video play karo ──────────────────────────────
    try {
      const isPaused = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? v.paused : true;
      }).catch(() => true);

      if (isPaused) {
        // Desktop: try play button first
        const bigPlayBtn = await page.$('.ytp-large-play-button, .ytp-play-button').catch(() => null);
        if (bigPlayBtn) {
          await bigPlayBtn.click();
          await sleep(randomDelay(1000, 2000));
        } else {
          // Mobile YouTube: tap center of video element to play
          // (.ytp-* buttons don't exist on m.youtube.com)
          const videoEl = await page.$('video').catch(() => null);
          if (videoEl) {
            const box = await videoEl.boundingBox().catch(() => null);
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              await sleep(randomDelay(1000, 2000));
            } else {
              await videoEl.click().catch(() => {});
              await sleep(randomDelay(1000, 2000));
            }
          } else {
            // Fallback: click player container
            const player = await page.$('#movie_player, .html5-video-player, #player').catch(() => null);
            if (player) { await player.click().catch(() => {}); await sleep(randomDelay(1000, 2000)); }
          }
        }
      }
    } catch {}

    // ── Mid-roll ad + play check — random 4-7 sec ────────
    // HUMAN FIX 1: Fixed setInterval(5000) is detectable — use randomized recursive setTimeout
    let playCheckCancelled = false;
    let playCheckTimer = null;
    const schedulePlayCheck = () => {
      if (playCheckCancelled) return;
      const nextDelay = randomDelay(4000, 7000); // random — not a fixed detectable interval
      playCheckTimer = setTimeout(async () => {
        if (playCheckCancelled) return;
        try {
          const hasAd = await page.evaluate(() => {
            return !!(
              document.querySelector('.ytp-ad-player-overlay') ||
              document.querySelector('.ad-showing') ||
              document.querySelector('.ytp-ad-overlay-container') ||
              document.querySelector('.ytp-ad-text')
            );
          }).catch(() => false);

          if (hasAd) {
            // Ad shuru hui — timer pause karo
            if (!adPlaying) {
              adPlaying = true;
              adStartTime = Date.now();
              this.log('info', '📺 Mid-roll ad shuru — timer paused');
              this.adPlaying = true;
              this.adCount = (this.adCount || 0) + 1;
            }

            // HUMAN FIX 2: Check adSkipEnabled BEFORE waiting (was checked after — logic bug)
            // HUMAN FIX 3: Add ±2-3s jitter to skip timing — not perfectly predictable
            if (config?.adSkipEnabled !== false) {
              const baseDelay = (config?.adSkipAfterSec || 15) * 1000;
              const jitter = randomDelay(-2000, 3000);
              await sleep(Math.max(2000, baseDelay + jitter));
              // HUMAN FIX 4: Use Playwright element click on skip button — not JS btn.click()
              const skipBtn = await page.$('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, [class*="skip-button"]').catch(() => null);
              if (skipBtn) {
                await skipBtn.click().catch(() => {});
                this.log('info', '⏭ Mid-roll ad skipped');
              }
            }

            await trackEngagement(this.profileId, 'ads_total', 1).catch(() => {});
            schedulePlayCheck();
            return;
          }

          // Ad khatam hui — timer resume karo
          if (adPlaying) {
            const adDuration = Date.now() - adStartTime;
            totalAdTime += adDuration;
            adPlaying = false;
            this.adPlaying = false;
            this.log('info', `📺 Ad khatam — ${Math.round(adDuration/1000)}s tha. Total ad time: ${Math.round(totalAdTime/1000)}s. Timer resume.`);
          }

          // Normal play check — video paused to resume
          const isPlaying = await page.evaluate(() => {
            const v = document.querySelector('video');
            return v && !v.paused && !v.ended;
          }).catch(() => false);

          if (!isPlaying) {
            // HUMAN FIX 5: Never use JS v.play() — YouTube detects script-triggered play
            // Use Playwright click on the actual play button instead
            try {
              const playBtn = await page.$('.ytp-play-button[aria-label*="Play"], .ytp-play-button[title*="Play"]').catch(() => null);
              if (playBtn) {
                await playBtn.click();
              } else {
                // Fallback: click the player container (same as user clicking the video)
                const player = await page.$('#movie_player, .html5-video-player').catch(() => null);
                if (player) await player.click().catch(() => {});
              }
              this.log('info', 'Video paused tha — resume kiya');
            } catch {}
          }

        } catch {}
        schedulePlayCheck(); // reschedule with new random delay
      }, nextDelay);
    };
    schedulePlayCheck();

    try {
      const pers = this._personality;
      const commentScrollChance = pers?.commentScrollChance ?? 0.4;
      const relatedPeekChance = pers?.relatedPeekChance ?? 0.2;
      const mouseMoveChance = pers?.mouseMoveChance ?? 0.3;
      const scrollAmount = pers ? pers.pickInt(180, 520) : randomDelay(200, 500);
      const pauseDuration = pers ? pers.pickInt(1000, 4000) : randomDelay(1000, 4000);

      const phase1End = pers?.phase1End ?? 0.08;
      const phase2End = pers?.phase2End ?? 0.22;
      const phase3End = pers?.phase3End ?? 0.48;
      const phase4End = pers?.phase4End ?? 0.68;
      const phase5End = pers?.phase5End ?? 0.85;

      // ════════════════════════════════════════════
      // FIX: MAIN TIMER LOOP
      // elapsed = actual video time (ads ka time minus)
      // Guarantee: durationMs tak video ZAROOR dekhega
      // ════════════════════════════════════════════
      while (true) {
        // FIX: Ad chal rahi ho to kuch mat karo — wait karo
        if (adPlaying) {
          await sleep(1000);
          continue;
        }

        // FIX: Actual watched time = total elapsed - ad time
        const totalElapsed = Date.now() - startTime;
        const actualWatched = totalElapsed - totalAdTime;
        const remaining = durationMs - actualWatched;

        // FIX: durationMs poora hua — ab band karo
        if (remaining <= 0) {
          this.log('info', `✅ Video complete! Watched: ${Math.round(actualWatched/1000)}s | Ad time: ${Math.round(totalAdTime/1000)}s | Total elapsed: ${Math.round(totalElapsed/1000)}s`);
          break;
        }

        // Progress = actual watched / total to watch
        const progress = actualWatched / durationMs;

        // ── Phase 1: Koi action nahi ──────────────
        if (progress < phase1End) {
          await sleep(Math.min(randomDelay(8000, 20000), remaining));
          continue;
        }

        // ── Phase 2: Sirf mouse move ──────────────
        if (progress < phase2End) {
          if (config?.qaTestMode && !this._qaScrolledEarly) {
            this._qaScrolledEarly = true;
            await smoothScroll(page, pers.pickInt(200, 450), 'down', pers);
            await sleep(randomDelay(1500, 3000));
            await smoothScroll(page, pers.pickInt(150, 300), 'up', pers);
            this.log('info', '[QA] Early scroll on watch page');
          }
          if (Math.random() < mouseMoveChance) {
            const x = randomDelay(150, 900);
            const y = randomDelay(100, 400);
            await page.mouse.move(x, y, { steps: randomDelay(5, 15) }).catch(() => {});
            await sleep(randomDelay(500, 2000));
          }
          await sleep(Math.min(randomDelay(10000, 25000), remaining));
          continue;
        }

        // ── Phase 3: Smart scroll + Like at 40-60% ─────
        if (progress < phase3End) {
          const scrollPlan = planWatchAction(progress, config, 3, pers);
          if (scrollPlan.scroll) {
            const px = scrollPlan.intensity || scrollAmount;
            await smoothScroll(page, px + (pers ? pers.pickInt(50, 200) : randomDelay(50, 200)), 'down', pers);
            await sleep(scrollPlan.pauseMs || randomDelay(2000, 6000));
            if (pers ? pers.chance(0.35) : Math.random() < 0.35) {
              await smoothScroll(page, pers ? pers.pickInt(50, 150) : randomDelay(50, 150), 'down', pers);
              await sleep(pauseDuration);
            }
            await smoothScroll(page, px + (pers ? pers.pickInt(50, 200) : randomDelay(50, 200)), 'up', pers);
            await sleep(randomDelay(500, 1500));
          } else if (config?.scrollDuringWatch !== false && (pers ? pers.chance(commentScrollChance * 0.5) : Math.random() < commentScrollChance * 0.5)) {
            await smoothScroll(page, scrollAmount, 'down', pers);
            await sleep(randomDelay(1500, 4000));
            await smoothScroll(page, scrollAmount, 'up', pers);
          }

          if (progress >= 0.4 && progress < 0.6 && config?.likeEnabled && !this._likedThisVideo) {
            try {
              const likeBtn = await page.$('like-button-view-model button, ytd-toggle-button-renderer#top-level-buttons-computed button:first-child, button[aria-label*="like"]');
              if (likeBtn) {
                const isLiked = await likeBtn.evaluate(el => el.getAttribute('aria-pressed') === 'true');
                if (!isLiked) {
                  await humanMouseMove(page);
                  await sleep(randomDelay(500, 1500));
                  await likeBtn.click();
                  this._likedThisVideo = true;
                  this.log('info', '👍 Liked at ~50%');
                  await trackEngagement(this.profileId, 'like').catch(() => {});
                }
              }
            } catch {}
          }

          // QA / human: skip forward ~10s + optional back 5s once mid-watch
          if (
            !this._seekedForward
            && progress >= (config?.qaTestMode ? 0.15 : 0.25)
            && progress < 0.5
            && (config?.qaTestMode || (pers ? pers.chance(0.12) : Math.random() < 0.12))
          ) {
            const sec = config?.seekForwardSec || 10;
            try {
              await page.keyboard.press('l');
              this._seekedForward = true;
              this.log('info', `[QA] ⏩ Forward ~${sec}s (keyboard L)`);
              await sleep(randomDelay(1500, 2500));
              if (config?.qaTestMode) {
                await page.keyboard.press('j');
                this.log('info', '[QA] ⏪ Back ~10s (keyboard J)');
                await sleep(randomDelay(1000, 2000));
              }
            } catch {
              try {
                await page.evaluate((s) => {
                  const v = document.querySelector('video');
                  if (v && isFinite(v.duration)) v.currentTime = Math.min(v.duration - 1, v.currentTime + s);
                }, sec);
                this._seekedForward = true;
                this.log('info', `[QA] ⏩ Seeked forward ${sec}s via video element`);
              } catch {}
            }
          }

          // Dislike test (QA mode or rare random)
          if (
            config?.dislikeEnabled
            && !this._dislikedThisVideo
            && progress >= 0.35
            && progress < 0.5
          ) {
            try {
              const dislikeBtn = await page.$(
                'like-button-view-model button:nth-of-type(2), ytd-toggle-button-renderer#top-level-buttons-computed button:nth-of-type(2), button[aria-label*="dislike"]',
              );
              if (dislikeBtn) {
                await humanMouseMove(page);
                await sleep(randomDelay(500, 1200));
                await dislikeBtn.click();
                this._dislikedThisVideo = true;
                this.log('info', '👎 Dislike clicked (QA test)');
              }
            } catch {}
          }

          await sleep(Math.min(randomDelay(15000, 35000), remaining));
          continue;
        }

        // ── Phase 4: Mouse hover + Subscribe at 70% ──
        if (progress < phase4End) {
          if (Math.random() < mouseMoveChance) {
            const x = randomDelay(200, 750);
            const y = randomDelay(80, 300);
            await page.mouse.move(x, y, { steps: randomDelay(8, 20) }).catch(() => {});
          }

          if (progress >= 0.7 && config?.subscribeEnabled && !this._subscribedThisSession) {
            try {
              const subBtn = await page.$('#subscribe-button button, ytd-subscribe-button-renderer button');
              if (subBtn) {
                const text = await subBtn.textContent().catch(() => '');
                if (text && !text.toLowerCase().includes('subscribed')) {
                  await humanMouseMove(page);
                  await sleep(randomDelay(1000, 3000));
                  await subBtn.click();
                  this._subscribedThisSession = true;
                  this.log('info', '🔔 Subscribed at ~70%');
                  await trackEngagement(this.profileId, 'subscribe').catch(() => {});
                }
              }
            } catch {}
          }

          await sleep(Math.min(randomDelay(12000, 28000), remaining));
          continue;
        }

        // ── Phase 5: Related peek + Comment at 85% ──
        if (progress < phase5End) {
          const peekPlan = planWatchAction(progress, config, 5, pers);
          if (peekPlan.scroll || (config?.scrollDuringWatch !== false && (pers ? pers.chance(relatedPeekChance) : Math.random() < relatedPeekChance))) {
            const peekPx = peekPlan.intensity || (pers ? pers.pickInt(100, 300) : randomDelay(100, 300));
            await smoothScroll(page, peekPx, 'down', pers);
            await sleep(peekPlan.pauseMs || randomDelay(1500, 4000));
            await smoothScroll(page, peekPx, 'up', pers);
          }

          const commentAt = config?.qaTestMode ? 0.5 : 0.85;
          if (
            progress >= commentAt
            && config?.commentEnabled
            && config?.commentText
            && !this._commentedThisVideo
          ) {
            try {
              await smoothScroll(page, pers ? pers.pickInt(400, 800) : randomDelay(400, 800), 'down', pers);
              await sleep(randomDelay(2000, 4000));
              const commentBox = await page.$('#simplebox-placeholder, #placeholder-area');
              if (commentBox) {
                await commentBox.click();
                await sleep(randomDelay(1000, 2000));
                await humanType(page, config.commentText);
                await sleep(randomDelay(1000, 2000));
                const submitBtn = await page.$('#submit-button button, tp-yt-paper-button#submit-button');
                if (submitBtn) await submitBtn.click();
                this._commentedThisVideo = true;
                this.log('info', '💬 Comment posted at ~85%');
                await trackEngagement(this.profileId, 'comment').catch(() => {});
                await sleep(randomDelay(2000, 3000));
              }
              await smoothScroll(page, randomDelay(400, 800), 'up');
            } catch {}
          }

          await sleep(Math.min(randomDelay(15000, 30000), remaining));
          continue;
        }

        // ── Phase 6: Bas dekho — koi action nahi ──
        await sleep(Math.min(randomDelay(10000, 25000), remaining));
      }

    } finally {
      // Cancel the recursive play-check timer
      playCheckCancelled = true;
      if (playCheckTimer) clearTimeout(playCheckTimer);
      // FIX: Ad status reset
      this.adPlaying = false;
    }
  }

  async disconnect() {
    if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; this.context = null; }
    this.status = 'done';
    this.log('info', 'Agent disconnected');
  }

  getStatus() {
    return { profileId: this.profileId, profileName: this.profileName, status: this.status, currentVideo: this.currentVideo, logs: this.logs.slice(-20) };
  }

  // Track watch history to backend (prevents same video repeat on same profile)
  async trackWatchHistory(videoTitle, watchPercent, videoId = '') {
    const post = (path, payload) => new Promise((resolve) => {
      const body = JSON.stringify(payload);
      const req = http.request({
        hostname: '127.0.0.1', port: 3100, path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 3000,
      }, () => resolve());
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    });
    await post('/api/history/add', { profileId: this.profileId, videoTitle, watchPercent, videoId: videoId || undefined });
    if (videoId) {
      await post('/api/watch-history/add', { profileId: this.profileId, videoId, videoTitle });
    }
  }
}

module.exports = { ProfileAgent };
