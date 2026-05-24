/**
 * YouTube page UI: mobile detection/routing, theme, search bar, quality, autoplay, popups, description/related hovers.
 * Multi-source traffic routing (Google/backlink/direct/suggested) lives in `./TrafficRouter.cjs` — helpers wired from agent.cjs.
 * Uses HumanBehavior for typing + smooth scroll where needed.
 */

'use strict';

const { humanType, smoothScroll } = require('./HumanBehavior.cjs');

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOBILE YOUTUBE DETECTION
// Android profiles open m.youtube.com — completely different DOM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function isMobileYouTube(page) {
  try {
    const url = page.url();
    if (url.includes('m.youtube.com')) return true;
    const hasMobileEl = await page.evaluate(() => !!document.querySelector('ytm-app, ytm-browse, ytm-watch')).catch(() => false);
    return hasMobileEl;
  } catch { return false; }
}

async function isAndroidUA(page) {
  try {
    const ua = await page.evaluate(() => navigator.userAgent);
    return /android|mobile/i.test(ua);
  } catch { return false; }
}

async function mobileYouTubeSearch(page, videoTitle, channelName, log) {
  try {
    log('info', '[Mobile] Using URL-based search for mobile YouTube...');

    const queries = [];
    if (channelName) queries.push(`${channelName} ${videoTitle}`);
    queries.push(videoTitle);
    const shortTitle = videoTitle.split(' ').slice(0, 5).join(' ');
    if (shortTitle !== videoTitle) queries.push(channelName ? `${channelName} ${shortTitle}` : shortTitle);

    const stopWords = new Set(['the','a','an','is','are','in','on','at','to','for','of','with','and','or','this','that']);

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

      const videoHref = await page.evaluate(({ titleTarget, channelTarget, stopWordsArr }) => {
        const stopSet = new Set(stopWordsArr);
        function wordMatch(text, target) {
          const words = target.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopSet.has(w));
          if (words.length === 0) return 0;
          return words.filter(w => text.toLowerCase().includes(w)).length / words.length;
        }

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

    log('warn', '[Mobile] No matching video found after all queries — skipping to avoid wrong video');
    return false;
  } catch (err) {
    log('warn', `[Mobile] Search error: ${err.message}`);
    return false;
  }
}

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

async function forceDarkTheme(page) {
  try {
    await page.evaluate(() => {
      document.cookie = 'PREF=f6=400; path=/; domain=.youtube.com; max-age=31536000';
      document.documentElement.setAttribute('dark', 'true');
      document.documentElement.style.colorScheme = 'dark';
      try {
        const pref = JSON.parse(localStorage.getItem('yt-player-quality') || '{}');
        pref.darkTheme = true;
        localStorage.setItem('yt-player-quality', JSON.stringify(pref));
      } catch {}
    });
    await page.emulateMedia({ colorScheme: 'dark' }).catch(() => {});
  } catch {}
}

async function clickSearchAndType(page, query) {
  try {
    await page.keyboard.press('/');
    await sleep(800);
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

  try {
    const searchBtn = await page.$('#search-icon-legacy, button[aria-label="Search"]');
    if (searchBtn) {
      await searchBtn.click();
      await sleep(800);
      await humanType(page, query);
      return true;
    }
  } catch {}

  try {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      await sleep(200);
      const focuses = await page.evaluate(() => document.activeElement?.id === 'search');
      if (focuses) { await humanType(page, query); return true; }
    }
  } catch {}

  return false;
}

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

async function verifyAutoplayOff(page) {
  return page.evaluate(() => {
    const btn = document.querySelector(
      'button[data-tooltip-target-id="autoplay-toggle-button"], .ytp-autonav-toggle-button, button[aria-label*="Autoplay" i], button[aria-label*="autoplay" i]',
    );
    if (!btn) return true;
    const on = btn.getAttribute('aria-pressed') === 'true'
      || btn.getAttribute('aria-checked') === 'true'
      || btn.classList.contains('ytp-autonav-toggle-button--active');
    return !on;
  }).catch(() => true);
}

async function ensureAutoplayOff(page, logFn = () => {}) {
  for (let pass = 1; pass <= 3; pass++) {
    await disableAutoplay(page, logFn);
    const off = await verifyAutoplayOff(page);
    if (off) {
      logFn('success', `[Autoplay] Verified OFF (pass ${pass}/3): OK`);
      return true;
    }
    if (pass < 3) {
      logFn('warn', `[Autoplay] Still ON after pass ${pass} — retrying...`);
      await sleep(randomDelay(600, 1200));
    }
  }
  logFn('warn', '[Autoplay] Could not confirm OFF after 3 passes');
  return false;
}

async function dismissYouTubePopups(page, logFn = () => {}) {
  try {
    const clicked = await page.evaluate(() => {
      const labels = [
        'accept all', 'accept', 'i agree', 'agree', 'got it', 'reject all', 'reject',
        'no thanks', 'not now', 'dismiss', 'close', 'continue', 'allow all',
      ];
      for (const sel of [
        'button[aria-label*="Accept" i]', 'button[aria-label*="Reject" i]',
        'tp-yt-paper-button', 'ytd-button-renderer button', 'button',
      ]) {
        for (const el of document.querySelectorAll(sel)) {
          const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().trim();
          if (!t || t.length > 40) continue;
          if (labels.some((w) => t === w || t.includes(w))) {
            const r = el.getBoundingClientRect();
            if (r.width > 20 && r.height > 12 && r.top >= 0 && r.top < window.innerHeight) {
              el.click();
              return t.slice(0, 30);
            }
          }
        }
      }
      const consent = document.querySelector('button[aria-label*="Accept" i], form[action*="consent"] button');
      if (consent) { consent.click(); return 'consent-btn'; }
      return null;
    });
    if (clicked) {
      logFn('info', `[YouTube popup] Dismissed: "${clicked}"`);
      await sleep(randomDelay(800, 1500));
    }
  } catch (err) {
    logFn('warn', `[YouTube popup] Error: ${err.message}`);
  }
}

async function expandDescriptionAndRead(page, logFn = () => {}) {
  try {
    await smoothScroll(page, randomDelay(120, 280), 'down');
    await sleep(randomDelay(800, 1600));
    const expanded = await page.evaluate(() => {
      const btn = document.querySelector(
        '#expand, tp-yt-paper-button#expand, ytd-text-inline-expander #expand, button[aria-label*="more" i]',
      );
      if (btn) { btn.click(); return true; }
      const more = [...document.querySelectorAll('button, yt-formatted-string')].find(el => {
        const t = (el.textContent || '').toLowerCase();
        return t === '...more' || t === 'show more' || t.includes('show more');
      });
      if (more) { more.click(); return true; }
      return false;
    });
    if (expanded) {
      logFn('info', '[Human] Description expanded — reading...');
      await sleep(randomDelay(2000, 4500));
      await smoothScroll(page, randomDelay(180, 420), 'down');
      await sleep(randomDelay(1500, 3000));
      await smoothScroll(page, randomDelay(200, 500), 'up');
      await sleep(randomDelay(800, 1800));
      const player = await page.$('#movie_player, .html5-video-player, video').catch(() => null);
      if (player) {
        const box = await player.boundingBox().catch(() => null);
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: randomDelay(6, 14) }).catch(() => {});
      }
      logFn('info', '[Human] Back to video area');
    }
  } catch (err) {
    logFn('warn', `[Human] Description read: ${err.message}`);
  }
}

async function hoverRelatedVideos(page, logFn = () => {}) {
  try {
    const items = await page.$$('ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer');
    const pick = items.slice(0, Math.min(items.length, 12));
    if (!pick.length) return;
    const count = randomDelay(1, 3);
    const used = new Set();
    for (let i = 0; i < count; i++) {
      let idx = Math.floor(Math.random() * pick.length);
      if (used.size < pick.length) {
        while (used.has(idx)) idx = Math.floor(Math.random() * pick.length);
        used.add(idx);
      }
      const el = pick[idx];
      const box = await el.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: randomDelay(10, 22) }).catch(() => {});
        await sleep(randomDelay(1200, 2800));
        logFn('info', `[Human] Hover related video ${i + 1}/${count}`);
      }
    }
  } catch (err) {
    logFn('warn', `[Human] Related hover: ${err.message}`);
  }
}

async function verifyVideoQuality(page, quality) {
  if (!quality || quality === 'auto') return true;
  const targetRes = String(quality).replace('p', '');
  return page.evaluate((res) => {
    const v = document.querySelector('video');
    if (v && v.videoHeight >= parseInt(res, 10) * 0.85) return true;
    const gear = document.querySelector('.ytp-settings-button');
    const qualityBtn = document.querySelector('.ytp-quality-button .ytp-menuitem-label');
    const label = (qualityBtn?.textContent || gear?.getAttribute('aria-label') || '').toLowerCase();
    return label.includes(res) && label.includes('p');
  }, targetRes).catch(() => false);
}

async function ensureVideoQuality(page, quality, logFn = () => {}) {
  if (!quality || quality === 'auto') {
    logFn('info', '[Quality] auto — no change');
    return true;
  }
  let ok = await setVideoQuality(page, quality, logFn);
  let verified = await verifyVideoQuality(page, quality);
  if (!verified) {
    logFn('warn', `[Quality] Verify failed after pass 1 — retrying ${quality}...`);
    await sleep(1000);
    ok = await setVideoQuality(page, quality, logFn) || ok;
    verified = await verifyVideoQuality(page, quality);
  }
  logFn(verified ? 'success' : 'warn', `[Quality] Verified (2-pass): ${verified ? quality : 'unconfirmed'}`);
  return verified || ok;
}

module.exports = {
  isMobileYouTube,
  isAndroidUA,
  mobileYouTubeSearch,
  mobileDirectWatch,
  forceDarkTheme,
  clickSearchAndType,
  setVideoQuality,
  disableAutoplay,
  verifyAutoplayOff,
  ensureAutoplayOff,
  dismissYouTubePopups,
  expandDescriptionAndRead,
  hoverRelatedVideos,
  verifyVideoQuality,
  ensureVideoQuality,
};
