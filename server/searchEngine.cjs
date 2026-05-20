/**
 * SEARCH ENGINE — Smart Video Discovery
 * 
 * Features:
 * 1. Escalation Search (short → long → channel → near-full)
 * 2. Video Verification (title + channel + duration match before click)
 * 3. Multiple Traffic Sources (YouTube, Google, Bing, Channel Page, Direct URL)
 * 4. Per-profile traffic mix (auto-assigned, different for each)
 * 5. Ad tracking (separate from video watch time)
 */

function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEARCH QUERY GENERATOR — Escalation Levels
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'and', 'or', 'but', 'not', 'this', 'that', 'it', 'its', 'how', 'what', 'which', 'who', 'when', 'where', 'why', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'you', 'your', 'my', 'our', 'their', 'his', 'her']);

function generateEscalationQueries(videoTitle, channelName) {
  const title = videoTitle || '';
  const channel = channelName || '';
  
  // Extract meaningful keywords (remove stop words, punctuation, year in brackets)
  const cleanTitle = title
    .replace(/[()[\]{}|:!?—–\-]/g, ' ')  // Remove punctuation
    .replace(/\b\d{4}\b/g, '')             // Remove years
    .replace(/\s+/g, ' ')
    .trim();
  
  const keywords = cleanTitle.split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .map(w => w.toLowerCase());
  
  // Level 1: 2-4 core keywords (most natural)
  const coreKeywords = keywords.slice(0, Math.min(4, keywords.length));
  const level1 = coreKeywords.join(' ');
  
  // Level 2: 4-6 keywords (more specific)
  const level2Keywords = keywords.slice(0, Math.min(6, keywords.length));
  const level2 = level2Keywords.join(' ');
  
  // Level 3: Channel name + 2-3 keywords
  const level3 = channel ? `${channel} ${coreKeywords.slice(0, 3).join(' ')}` : level2;
  
  // Level 4: Near-full title (remove only year and special chars)
  const level4 = cleanTitle.split(' ').filter(w => w.length > 1).slice(0, 10).join(' ');
  
  // Level 5: EXACT original title (last resort — guaranteed to find if video exists)
  const level5 = title.trim();
  
  return [level1, level2, level3, level4, level5].filter(q => q.trim().length > 3);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIDEO VERIFICATION — Check before clicking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function verifyVideoMatch(resultTitle, resultChannel, resultDuration, expectedTitle, expectedChannel, expectedDuration) {
  const expectedWords = expectedTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const resultWords = resultTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const matchedWords = expectedWords.filter(w => resultWords.some(rw => rw.includes(w) || w.includes(rw)));
  const titleMatchPercent = expectedWords.length > 0 ? matchedWords.length / expectedWords.length : 0;

  let score = 0;
  if (titleMatchPercent >= 0.65) score += 55;
  else if (titleMatchPercent >= 0.5) score += 42;
  else if (titleMatchPercent >= 0.4) score += 28;
  else return { score, titleMatchPercent, isMatch: false };

  const needChannel = !!(expectedChannel && String(expectedChannel).trim());
  let channelOk = !needChannel;

  if (needChannel && resultChannel) {
    const expCh = expectedChannel.toLowerCase().trim();
    const resCh = resultChannel.toLowerCase().trim();
    if (resCh.includes(expCh) || expCh.includes(resCh)) {
      score += 35;
      channelOk = true;
    } else {
      const expParts = expCh.split(/\s+/).filter(w => w.length > 2);
      const resParts = resCh.split(/\s+/).filter(w => w.length > 2);
      const chRatio = expParts.length > 0
        ? expParts.filter(w => resParts.some(r => r.includes(w) || w.includes(r))).length / expParts.length
        : 0;
      if (chRatio >= 0.6) {
        score += 28;
        channelOk = true;
      }
    }
  }

  if (expectedDuration > 0 && resultDuration > 0) {
    const diff = Math.abs(expectedDuration - resultDuration);
    if (diff < 10) score += 15;
    else if (diff < 30) score += 8;
  }

  const isMatch = needChannel
    ? (channelOk && titleMatchPercent >= 0.45 && score >= 62)
    : (titleMatchPercent >= 0.5 && score >= 42);

  return { score, titleMatchPercent, isMatch };
}

// Parse duration text like "12:34" or "1:02:34" to seconds
function parseDurationText(text) {
  if (!text) return 0;
  const parts = text.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRAFFIC SOURCE ASSIGNMENT
// Har profile ko alag traffic source milta hai
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function assignTrafficSource(profileIndex, totalProfiles, hasUrl, trafficMix, trafficPreference) {
  const pref = String(trafficPreference || 'custom').toLowerCase();

  if (pref === 'random') {
    const pool = ['youtube-search', 'google', 'bing', 'channel-page', 'duckduckgo', 'yahoo'];
    if (hasUrl) pool.push('direct');
    return pool[Math.floor(Math.random() * pool.length)];
  }

  if (pref === 'search') return 'youtube-search';
  if (pref === 'google') return 'google';
  if (pref === 'bing') return 'bing';
  if (pref === 'duckduckgo') return 'duckduckgo';
  if (pref === 'yahoo') return 'yahoo';
  if (pref === 'direct') return hasUrl ? 'direct' : 'youtube-search';
  if (pref === 'suggested') return 'channel-page';

  // If trafficMix is provided from frontend config, use it
  if (trafficMix && typeof trafficMix === 'object') {
    const sources = [];
    const yt = trafficMix.youtubeSearch || 0;
    const ch = trafficMix.channelPage || 0;
    const go = trafficMix.google || 0;
    const bi = trafficMix.bing || 0;
    const di = trafficMix.direct || 0;
    const ddg = trafficMix.duckduckgo || 0;
    const yh = trafficMix.yahoo || 0;
    
    for (let i = 0; i < yt; i++) sources.push('youtube-search');
    for (let i = 0; i < ch; i++) sources.push('channel-page');
    for (let i = 0; i < go; i++) sources.push('google');
    for (let i = 0; i < bi; i++) sources.push('bing');
    for (let i = 0; i < ddg; i++) sources.push('duckduckgo');
    for (let i = 0; i < yh; i++) sources.push('yahoo');
    if (hasUrl) { for (let i = 0; i < di; i++) sources.push('direct'); }
    else { for (let i = 0; i < di; i++) sources.push('youtube-search'); }
    
    if (sources.length === 0) sources.push('youtube-search');
    
    // Random pick (not deterministic — each video gets random source from mix)
    return sources[Math.floor(Math.random() * sources.length)];
  }
  
  // Default fallback: mostly search
  const sources = [];
  for (let i = 0; i < 50; i++) sources.push('youtube-search');
  for (let i = 0; i < 20; i++) sources.push('channel-page');
  for (let i = 0; i < 15; i++) sources.push('google');
  for (let i = 0; i < 10; i++) sources.push('bing');
  if (hasUrl) for (let i = 0; i < 5; i++) sources.push('direct');
  else for (let i = 0; i < 5; i++) sources.push('youtube-search');
  
  const index = (profileIndex * 7 + 3) % sources.length;
  return sources[index];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// YOUTUBE SEARCH WITH ESCALATION + VERIFICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function searchYouTube(page, videoTitle, channelName, expectedDuration, humanTypeFn, log, expectedVideoId) {
  const queries = generateEscalationQueries(videoTitle, channelName);

  for (let attempt = 0; attempt < queries.length; attempt++) {
    const query = queries[attempt];
    log('info', `[Search Attempt ${attempt + 1}/${queries.length}] "${query}"${expectedVideoId ? ` [ID: ${expectedVideoId}]` : ''}`);

    const currentUrl = page.url();
    if (!currentUrl.includes('youtube.com')) {
      await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomDelay(2000, 3000));
    }

    const searched = await typeInSearchBar(page, query, humanTypeFn);
    if (!searched) continue;

    await page.keyboard.press('Enter');
    await sleep(randomDelay(3000, 5000));

    await page.waitForSelector('ytd-video-renderer, ytd-item-section-renderer', { timeout: 10000 }).catch(() => {});
    await sleep(randomDelay(2000, 3000));

    await browseResults(page);

    // Pass expectedVideoId — 100% accurate match when URL available
    const found = await findAndVerifyVideo(page, videoTitle, channelName, expectedDuration, log, expectedVideoId);
    if (found) {
      log('success', `[Search] Found video on attempt ${attempt + 1}: "${query}"`);
      return { success: true, source: 'youtube-search', query };
    }

    log('info', `[Search] Video not found with "${query}" — trying next...`);
    await sleep(randomDelay(1000, 2000));
  }

  log('warn', '[Search] All 5 attempts failed — exact title not found in results');
  return { success: false, source: 'youtube-search' };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXTERNAL SEARCH HELPERS (Google/Bing/Yahoo — mobile overlays)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function dismissSiteOverlays(page, log, label = '') {
  const tag = label ? `[${label}]` : '';
  try {
    const clicked = await page.evaluate(() => {
      const gBtn = document.querySelector('#L2AGLb, button#L2AGLb');
      if (gBtn) { gBtn.click(); return 'google-consent'; }
      const want = ['accept all', 'accept', 'i agree', 'reject all', 'agree', 'got it', 'allow all'];
      for (const el of document.querySelectorAll('button, [role="button"], input[type="submit"]')) {
        const t = (el.textContent || el.value || '').toLowerCase().trim();
        if (!t || t.length > 48) continue;
        if (want.some((w) => t === w || t.includes(w))) {
          const r = el.getBoundingClientRect();
          if (r.width > 8 && r.height > 8) {
            el.click();
            return t.slice(0, 24);
          }
        }
      }
      return null;
    });
    if (clicked) {
      log('info', `${tag} Dismissed overlay (${clicked})`);
      await sleep(randomDelay(800, 1500));
    }
    return !!clicked;
  } catch {
    return false;
  }
}

async function dismissYahooPromo(page, log) {
  try {
    const closed = await page.evaluate(() => {
      const close = document.querySelector(
        '.scoutPromoPopup button, [class*="scoutPromo"] button, button[aria-label="Close"], button[aria-label="close"]',
      );
      if (close) { close.click(); return true; }
      document.querySelectorAll('.scoutPromoPopup, section.scoutPromoPopup').forEach((el) => el.remove());
      return false;
    });
    if (closed) {
      log('info', '[Yahoo] Closed promo popup');
      await sleep(500);
    }
  } catch { /* ignore */ }
}

async function typeInExternalSearch(page, selectors, query, humanTypeFn, log, label) {
  const sels = Array.isArray(selectors) ? selectors : [selectors];
  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissSiteOverlays(page, log, label);
    for (const sel of sels) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) === 0) continue;
        await loc.waitFor({ state: 'visible', timeout: 8000 });
        await loc.focus().catch(() => {});
        await loc.click({ timeout: 8000, force: true }).catch(async () => {
          await page.evaluate((s) => {
            const el = document.querySelector(s);
            if (el) { el.focus(); el.click(); }
          }, sel);
        });
        await sleep(randomDelay(300, 700));
        await page.keyboard.press('Control+a').catch(() => {});
        await page.keyboard.press('Meta+a').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await humanTypeFn(page, query);
        return true;
      } catch { /* try next selector */ }
    }
    await sleep(1000);
  }
  return false;
}

function resolveSearchResultUrl(href, baseHost = 'https://www.google.com') {
  if (!href) return null;
  let url = href.trim();
  if (url.startsWith('/url?')) {
    try {
      const u = new URL(baseHost + url);
      url = u.searchParams.get('q') || u.searchParams.get('url') || url;
    } catch { /* keep */ }
  }
  if (url.startsWith('//')) url = `https:${url}`;
  else if (url.startsWith('/')) url = `${baseHost.replace(/\/$/, '')}${url}`;
  if (!url.startsWith('http')) return null;
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) return null;
  return url;
}

async function openYouTubeResultLink(page, link, log, label) {
  const href = await link.getAttribute('href').catch(() => null);
  const url = resolveSearchResultUrl(href);
  if (!url) return false;
  log('info', `[${label}] Opening result: ${url.slice(0, 80)}…`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(randomDelay(3000, 5000));
  return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BING SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function searchBing(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) {
  log('info', '[Bing] Searching via Bing...');
  
  try {
    await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(randomDelay(2000, 4000));

    const sanitize = (s) => s.replace(/[\[\](){}:!?—–"']/g, ' ').replace(/\s+/g, ' ').trim();
    const bingQuery = channelName
      ? `${sanitize(channelName)} ${sanitize(videoTitle)} youtube`
      : `${sanitize(videoTitle)} youtube`;

    const typed = await typeInExternalSearch(
      page,
      ['textarea[name="q"]', 'input[name="q"]', '#sb_form_q'],
      bingQuery,
      humanTypeFn,
      log,
      'Bing',
    );
    if (!typed) {
      log('warn', '[Bing] Search box not found');
      return { success: false, source: 'bing' };
    }
    await sleep(randomDelay(500, 1000));
    await page.keyboard.press('Enter');
    await sleep(randomDelay(3000, 6000));
    
    // Find YouTube links and VERIFY exact title + channel
    const ytLinks = await page.$$('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
    
    for (const link of ytLinks.slice(0, 5)) {
      const text = await link.textContent().catch(() => '');
      const textClean = text.toLowerCase().trim();
      // Word-level matching — same logic as YouTube search (no more string.includes)
      const verification = verifyVideoMatch(textClean, '', 0, videoTitle, channelName || '', 0);
      if (verification.isMatch) {
        await sleep(randomDelay(1000, 3000));
        if (await openYouTubeResultLink(page, link, log, 'Bing')) {
          log('success', `[Bing] Found video and opened (score=${verification.score})`);
          return { success: true, source: 'bing', query: bingQuery };
        }
      }
    }

    log('info', '[Bing] Video not found in Bing results');
    return { success: false, source: 'bing' };
  } catch (err) {
    log('warn', `[Bing] Error: ${err.message}`);
    return { success: false, source: 'bing' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GOOGLE SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function searchGoogle(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) {
  log('info', '[Google] Searching via Google...');
  
  try {
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(randomDelay(2000, 4000));

    const sanitize = (s) => s.replace(/[\[\](){}:!?—–"']/g, ' ').replace(/\s+/g, ' ').trim();
    const googleQuery = channelName
      ? `${sanitize(channelName)} ${sanitize(videoTitle)} youtube`
      : `${sanitize(videoTitle)} youtube`;

    const typed = await typeInExternalSearch(
      page,
      ['textarea[name="q"]', 'input[name="q"]', 'textarea[title="Search"]', 'input[title="Search"]'],
      googleQuery,
      humanTypeFn,
      log,
      'Google',
    );
    if (!typed) {
      log('warn', '[Google] Search box not found');
      return { success: false, source: 'google' };
    }
    await sleep(randomDelay(500, 1000));
    await page.keyboard.press('Enter');
    await sleep(randomDelay(3000, 6000));
    
    // Find YouTube links in Google results and VERIFY title + channel
    const ytLinks = await page.$$('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
    
    for (const link of ytLinks.slice(0, 5)) {
      const text = await link.textContent().catch(() => '');
      const textClean = text.toLowerCase().trim();
      // Word-level matching — same logic as YouTube search (no more string.includes)
      const verification = verifyVideoMatch(textClean, '', 0, videoTitle, channelName || '', 0);
      if (verification.isMatch) {
        await sleep(randomDelay(1000, 3000));
        if (await openYouTubeResultLink(page, link, log, 'Google')) {
          log('success', `[Google] Found video and opened (score=${verification.score})`);
          return { success: true, source: 'google', query: googleQuery };
        }
      }
    }

    log('info', '[Google] Video not found in Google results');
    return { success: false, source: 'google' };
  } catch (err) {
    log('warn', `[Google] Error: ${err.message}`);
    return { success: false, source: 'google' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHANNEL PAGE — Go to channel, find video
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function searchChannelPage(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) {
  if (!channelName) return { success: false, source: 'channel-page' };
  log('info', `[Channel] Going to "${channelName}" channel page...`);
  
  try {
    // Search for channel on YouTube
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(channelName)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(randomDelay(3000, 5000));
    
    // Click the channel that matches the expected name (not the first result)
    const channelRenderers = await page.$$('ytd-channel-renderer');
    let channelOpened = false;
    const expCh = channelName.toLowerCase().trim();

    for (const chEl of channelRenderers.slice(0, 10)) {
      const chTitle = await chEl.evaluate(el => {
        const t = el.querySelector('#channel-title, #text-container #text, yt-formatted-string#text, #main-link #text');
        return (t?.textContent || '').trim();
      }).catch(() => '');

      const got = chTitle.toLowerCase().trim();
      const nameOk = got && (got.includes(expCh) || expCh.includes(got) ||
        expCh.split(/\s+/).filter(w => w.length > 2).every(w => got.includes(w)));

      if (!nameOk) continue;

      const link = await chEl.$('a#main-link, a#avatar-link, a');
      if (link) {
        await link.click();
        channelOpened = true;
        break;
      }
    }

    if (!channelOpened) {
      log('warn', `[Channel] Channel "${channelName}" not found in YouTube search results`);
      return { success: false, source: 'channel-page' };
    }
    await sleep(randomDelay(3000, 5000));
    
    // Click Videos tab
    const videosTab = await page.$('[tab-title="Videos"], tp-yt-paper-tab:nth-child(2)');
    if (videosTab) {
      await videosTab.click();
      await sleep(randomDelay(2000, 4000));
    }
    
    // Scroll and find video by title
    for (let scroll = 0; scroll < 3; scroll++) {
      const videos = await page.$$('ytd-rich-item-renderer a#video-title-link, ytd-grid-video-renderer a#video-title');
      
      for (const vid of videos) {
        const title = await vid.getAttribute('title').catch(() => '') || await vid.textContent().catch(() => '');
        const verification = verifyVideoMatch(title, channelName, 0, videoTitle, channelName, expectedDuration);
        
        if (verification.isMatch) {
          await sleep(randomDelay(500, 1500));
          await vid.click();
          await sleep(randomDelay(2000, 4000));
          log('success', '[Channel] Found video on channel page');
          return { success: true, source: 'channel-page' };
        }
      }
      
      // Scroll down to load more
      await page.mouse.wheel(0, 500);
      await sleep(randomDelay(1500, 3000));
    }
    
    log('info', '[Channel] Video not found on channel page');
    return { success: false, source: 'channel-page' };
  } catch (err) {
    log('warn', `[Channel] Error: ${err.message}`);
    return { success: false, source: 'channel-page' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Type in YouTube search bar (multiple fallback methods)
async function typeInSearchBar(page, query, humanTypeFn) {
  // Method 1: '/' shortcut
  try {
    await page.keyboard.press('/');
    await sleep(600);
    const focused = await page.evaluate(() => document.activeElement?.id === 'search' || document.activeElement?.tagName === 'INPUT');
    if (focused) {
      await page.keyboard.press('Control+a');
      await sleep(100);
      await page.keyboard.press('Backspace');
      await sleep(200);
      await humanTypeFn(page, query);
      return true;
    }
  } catch {}

  // Method 2: Click input
  try {
    const input = await page.$('input#search');
    if (input) {
      await input.click();
      await sleep(400);
      await page.keyboard.press('Control+a');
      await sleep(100);
      await page.keyboard.press('Backspace');
      await sleep(200);
      await humanTypeFn(page, query);
      return true;
    }
  } catch {}

  // Method 3: Click search icon
  try {
    const btn = await page.$('#search-icon-legacy, button[aria-label="Search"]');
    if (btn) {
      await btn.click();
      await sleep(600);
      await humanTypeFn(page, query);
      return true;
    }
  } catch {}

  return false;
}

// Browse search results like human (scroll around before clicking)
async function browseResults(page) {
  const scrollDown = randomDelay(150, 500);
  const scrollUp = randomDelay(100, 400);
  
  // Scroll down a bit
  await page.mouse.wheel(0, scrollDown);
  await sleep(randomDelay(1000, 3000));
  
  // Maybe scroll more
  if (Math.random() < 0.4) {
    await page.mouse.wheel(0, randomDelay(80, 200));
    await sleep(randomDelay(800, 2000));
  }
  
  // Scroll back up
  await page.mouse.wheel(0, -scrollUp);
  await sleep(randomDelay(800, 2000));
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Find and verify video in YouTube search results
// RULE: Only click if EXACT title matches — never click wrong video
// ENHANCEMENT: If expectedVideoId provided (from URL), use it for 100% accurate match
async function findAndVerifyVideo(page, videoTitle, channelName, expectedDuration, log, expectedVideoId) {
  try {
    // Wait for results to fully render
    await sleep(1500);
    
    // Check if results exist
    const hasResults = await page.evaluate(() => {
      return document.querySelectorAll('ytd-video-renderer').length;
    });
    
    if (hasResults === 0) return false;
    
    // Scroll through results to load more (up to 3 scrolls)
    for (let scrollAttempt = 0; scrollAttempt < 3; scrollAttempt++) {
      // Get all video results
      const results = await page.evaluate(() => {
        const videos = document.querySelectorAll('ytd-video-renderer');
        const matches = [];
        
        for (let i = 0; i < Math.min(videos.length, 15); i++) {
          const el = videos[i];
          const titleEl = el.querySelector('a#video-title');
          const channelEl = el.querySelector('ytd-channel-name a, .ytd-channel-name, ytd-channel-name yt-formatted-string');
          
          const title = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || '';
          const channel = channelEl?.textContent?.trim() || '';
          
          matches.push({ index: i, title, channel });
        }
        
        return matches;
      });
      
      if (!results || results.length === 0) return false;
      
      // Check each result for match
      const expectedTitleClean = videoTitle.toLowerCase().trim();

      for (const result of results) {
        const resultTitleClean = result.title.toLowerCase().trim();

        // ── VIDEO ID CHECK (100% accurate — thumbnail se better) ──
        // Agar URL se video ID available hai toh seedha ID match karo
        if (expectedVideoId) {
          const idMatch = await page.evaluate((idx, vid) => {
            const videos = document.querySelectorAll('ytd-video-renderer');
            const el = videos[idx];
            if (!el) return false;
            const link = el.querySelector('a#video-title');
            const href = link?.getAttribute('href') || '';
            return href.includes(vid);
          }, result.index, expectedVideoId).catch(() => false);

          if (idMatch) {
            // 100% correct video — click it directly
            const clicked = await page.evaluate((vid) => {
              const videos = document.querySelectorAll('ytd-video-renderer a#video-title');
              for (const a of videos) {
                if ((a.getAttribute('href') || '').includes(vid)) { a.click(); return true; }
              }
              return false;
            }, expectedVideoId).catch(() => false);

            if (clicked) {
              if (typeof log === 'function') log('success', `[YT] Video ID verified and clicked: ${expectedVideoId}`);
              await sleep(randomDelay(2000, 4000));
              return true;
            }
          }
          // ID not matched for this result — skip to title-based check
        }

        // ── TITLE + CHANNEL MATCH (fallback when no video ID) ──
        // BUG FIX: Ab verifyVideoMatch() use karo — WORD-LEVEL matching (50%+ words match = click)
        // Pehle raw string.includes() tha — fail hota tha agar keyword partial tha ya different order mein
        // Example fail: keyword="secret huge deposits", title="Secret to Huge Deposits in Idle Bank Tycoon..."
        //   → "includes" fail (exact substring nahi) but WORDS sab match hote → verifyVideoMatch catches it
        const verification = verifyVideoMatch(
          result.title,
          result.channel,
          0,                        // duration unknown at search stage
          videoTitle,
          channelName || '',
          0
        );

        if (verification.isMatch) {
          if (typeof log === 'function') {
            log('info', `[YT] Match found: "${result.title}" / "${result.channel}" (score: ${verification.score}) — clicking index ${result.index}...`);
          }

          // Click ONLY the verified row — never re-scan all results (that caused wrong-video clicks)
          const clickedInEval = await page.evaluate((idx) => {
            const videos = document.querySelectorAll('ytd-video-renderer');
            const el = videos[idx];
            if (!el) return false;
            const titleEl = el.querySelector('a#video-title');
            if (!titleEl) return false;
            titleEl.click();
            return true;
          }, result.index).catch(() => false);

          if (clickedInEval) {
            if (typeof log === 'function') log('success', `[YT] Clicked verified result at index ${result.index}`);
            await sleep(randomDelay(2000, 4000));
            return true;
          }

          const videoEls = await page.$$('ytd-video-renderer a#video-title');
          if (videoEls && videoEls[result.index]) {
            try {
              const box = await videoEls[result.index].boundingBox();
              if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: randomDelay(5, 12) });
                await sleep(randomDelay(300, 800));
              }
              await videoEls[result.index].click();
              await sleep(2000);
              return true;
            } catch {
              try { await videoEls[result.index].click(); await sleep(2000); return true; } catch {}
            }
          }
        }
      }
      
      // Not found in current results — scroll down to load more
      if (scrollAttempt < 2) {
        await page.mouse.wheel(0, 400);
        await sleep(randomDelay(1500, 2500));
      }
    }
    
    // Video not found in results — return false (will try next keyword)
    return false;
  } catch {
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DUCKDUCKGO SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function searchDuckDuckGo(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) {
  log('info', '[DuckDuckGo] Searching via DuckDuckGo...');
  
  try {
    await page.goto('https://duckduckgo.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(randomDelay(2000, 4000));

    const ddgQuery = channelName ? `${channelName} ${videoTitle} youtube` : `${videoTitle} youtube`;

    const typed = await typeInExternalSearch(
      page,
      ['input[name="q"]', '#searchbox_input', 'textarea[name="q"]'],
      ddgQuery,
      humanTypeFn,
      log,
      'DuckDuckGo',
    );
    if (!typed) {
      log('warn', '[DuckDuckGo] Search box not found');
      return { success: false, source: 'duckduckgo' };
    }
    await sleep(randomDelay(500, 1000));
    await page.keyboard.press('Enter');
    await sleep(randomDelay(3000, 6000));
    
    // Find YouTube links and verify exact title + channel
    const ytLinks = await page.$$('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
    
    for (const link of ytLinks.slice(0, 5)) {
      const text = await link.textContent().catch(() => '');
      const textClean = text.toLowerCase().trim();
      // Word-level matching — same logic as YouTube search (no more string.includes)
      const verification = verifyVideoMatch(textClean, '', 0, videoTitle, channelName || '', 0);
      if (verification.isMatch) {
        await sleep(randomDelay(1000, 3000));
        if (await openYouTubeResultLink(page, link, log, 'DuckDuckGo')) {
          log('success', `[DuckDuckGo] Found video and opened (score=${verification.score})`);
          return { success: true, source: 'duckduckgo', query: ddgQuery };
        }
      }
    }

    log('info', '[DuckDuckGo] Video not found');
    return { success: false, source: 'duckduckgo' };
  } catch (err) {
    log('warn', `[DuckDuckGo] Error: ${err.message}`);
    return { success: false, source: 'duckduckgo' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// YAHOO SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function searchYahoo(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) {
  log('info', '[Yahoo] Searching via Yahoo...');
  
  try {
    await page.goto('https://search.yahoo.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(randomDelay(2000, 4000));
    await dismissYahooPromo(page, log);

    const yahooQuery = channelName ? `${channelName} ${videoTitle} youtube` : `${videoTitle} youtube`;

    const typed = await typeInExternalSearch(
      page,
      ['input[name="p"]', '#yschsp', 'textarea[name="p"]'],
      yahooQuery,
      humanTypeFn,
      log,
      'Yahoo',
    );
    if (!typed) {
      log('warn', '[Yahoo] Search box not found');
      return { success: false, source: 'yahoo' };
    }
    await sleep(randomDelay(500, 1000));
    await page.keyboard.press('Enter');
    await sleep(randomDelay(3000, 6000));
    await dismissYahooPromo(page, log);

    // Find YouTube links and verify exact title + channel
    const ytLinks = await page.$$('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');

    for (const link of ytLinks.slice(0, 5)) {
      const text = await link.textContent().catch(() => '');
      const textClean = text.toLowerCase().trim();
      const verification = verifyVideoMatch(textClean, '', 0, videoTitle, channelName || '', 0);
      if (verification.isMatch) {
        await sleep(randomDelay(1000, 3000));
        await dismissYahooPromo(page, log);
        if (await openYouTubeResultLink(page, link, log, 'Yahoo')) {
          log('success', `[Yahoo] Found video and opened (score=${verification.score})`);
          return { success: true, source: 'yahoo', query: yahooQuery };
        }
      }
    }

    log('info', '[Yahoo] Video not found');
    return { success: false, source: 'yahoo' };
  } catch (err) {
    log('warn', `[Yahoo] Error: ${err.message}`);
    return { success: false, source: 'yahoo' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN EXPORT — Open Video with Smart Strategy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function openVideoSmart(page, videoTitle, channelName, videoUrl, expectedDuration, profileIndex, humanTypeFn, log, trafficMix, trafficPreference, options = {}) {
  const strictSource = !!options.strictTraffic;
  const source = assignTrafficSource(profileIndex, 30, !!videoUrl, trafficMix, trafficPreference);
  log('info', `[Traffic] Assigned source: ${source} (preference: ${trafficPreference || 'custom'})`);

  // Extract video ID from URL for 100% accurate verification in search results
  const expectedVideoId = extractVideoId(videoUrl);
  if (expectedVideoId) log('info', `[VideoID] Will verify with ID: ${expectedVideoId}`);

  let result;

  switch (source) {
    case 'direct':
      if (videoUrl) {
        await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(randomDelay(2000, 4000));
        log('success', '[Direct] Video opened via URL');
        return { success: true, source: 'direct' };
      }
      result = await searchYouTube(page, videoTitle, channelName, expectedDuration, humanTypeFn, log, expectedVideoId);
      break;

    case 'youtube-search':
      result = await searchYouTube(page, videoTitle, channelName, expectedDuration, humanTypeFn, log, expectedVideoId);
      break;
      
    case 'google':
      result = await searchGoogle(page, videoTitle, channelName, expectedDuration, humanTypeFn, log);
      break;
      
    case 'bing':
      result = await searchBing(page, videoTitle, channelName, expectedDuration, humanTypeFn, log);
      break;
      
    case 'channel-page':
      result = await searchChannelPage(page, videoTitle, channelName, expectedDuration, humanTypeFn, log);
      break;
      
    case 'duckduckgo':
      result = await searchDuckDuckGo(page, videoTitle, channelName, expectedDuration, humanTypeFn, log);
      break;
      
    case 'yahoo':
      result = await searchYahoo(page, videoTitle, channelName, expectedDuration, humanTypeFn, log);
      break;
      
    default:
      result = await searchYouTube(page, videoTitle, channelName, expectedDuration, humanTypeFn, log);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FALLBACK CHAIN — Sab sources try karo before direct URL
  // Order: YouTube Search (5 levels) → Google → Bing → DuckDuckGo → Yahoo → Channel Page
  // LAST RESORT: Direct URL — sirf tab jab sab 6 sources fail ho jaayein
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (strictSource && (!result || !result.success)) {
    log('warn', `[QA] Strict traffic: "${source}" failed — skipping fallback chain`);
  }

  if (!strictSource && (!result || !result.success)) {
    const fallbackOrder = [
      { id: 'youtube-search', fn: () => searchYouTube(page, videoTitle, channelName, expectedDuration, humanTypeFn, log, expectedVideoId) },
      { id: 'google',         fn: () => searchGoogle(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) },
      { id: 'bing',           fn: () => searchBing(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) },
      { id: 'duckduckgo',     fn: () => searchDuckDuckGo(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) },
      { id: 'yahoo',          fn: () => searchYahoo(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) },
      { id: 'channel-page',   fn: () => searchChannelPage(page, videoTitle, channelName, expectedDuration, humanTypeFn, log) },
    ].filter(f => f.id !== source); // Primary already tried — skip karo

    log('info', `[Fallback] "${source}" failed — trying ${fallbackOrder.length} more sources before direct URL...`);

    for (const fallback of fallbackOrder) {
      log('info', `[Fallback] Trying: ${fallback.id}`);
      try {
        result = await fallback.fn();
        if (result && result.success) {
          log('success', `[Fallback] Found via ${fallback.id} ✓`);
          break;
        }
      } catch (err) {
        log('warn', `[Fallback] ${fallback.id} error: ${err.message}`);
      }
      await sleep(randomDelay(1000, 2000));
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ABSOLUTE LAST RESORT: Direct URL
  // Sirf tab jab SARE 6 search methods fail ho jaayein
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!strictSource && (!result || !result.success)) {
    if (videoUrl) {
      log('warn', '[Fallback] ⚠️ All search sources failed — direct URL as LAST RESORT');
      await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(randomDelay(2000, 4000));
      result = { success: true, source: 'direct-fallback' };
    } else {
      log('error', '[Fallback] All sources failed and no URL available');
    }
  }

  // Post-open verification — wrong video par watch mat karo
  if (result && result.success) {
    try {
      const { verifyOpenedVideo, detectPageBlock } = require('./agentBrain.cjs');
      const block = await detectPageBlock(page);
      if (block.blocked) {
        log('warn', `[Verify] Page blocked (${block.kind}): ${block.message}`);
        return { success: false, source: result.source, blocked: true, blockKind: block.kind };
      }
      const check = await verifyOpenedVideo(page, {
        title: videoTitle,
        channelName,
        videoUrl,
      });
      if (!check.ok) {
        log('warn', `[Verify] Opened wrong video (${check.reason}): playing "${check.actual?.title}" by "${check.actual?.channel}"`);
        return { success: false, source: result.source, verifyFailed: true, verifyReason: check.reason };
      }
      log('success', `[Verify] Confirmed: "${check.actual.title}"`);
    } catch (err) {
      log('warn', `[Verify] Check skipped: ${err.message}`);
    }
  }

  return result || { success: false, source: 'none' };
}

function extractVideoIdFromUrl(url) {
  if (!url) return '';
  const m = String(url).match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : '';
}

/**
 * External referral page → find YouTube link → click (YouTube Analytics "External").
 */
async function openVideoViaBacklink(page, videoTitle, channelName, videoUrl, backlinkData, log) {
  const sourceUrl = backlinkData?.sourceUrl;
  if (!sourceUrl) {
    log('warn', '[Backlink] No source URL on video');
    return { success: false, source: 'backlink' };
  }
  const expectedVid = extractVideoIdFromUrl(videoUrl);
  try {
    log('info', `[Backlink] Referral: ${String(sourceUrl).slice(0, 72)}…`);
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await sleep(randomDelay(5000, 12000));
    await page.evaluate(() => {
      window.scrollBy(0, 200 + Math.random() * 500);
    });
    await sleep(randomDelay(2000, 5000));
    await page.evaluate(() => {
      window.scrollBy(0, 150 + Math.random() * 300);
    });
    await sleep(randomDelay(1500, 3500));

    const clickResult = await page.evaluate((vid) => {
      const anchors = [...document.querySelectorAll('a[href]')];
      const yt = anchors.filter((a) => {
        const h = a.href || '';
        return /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\//i.test(h);
      });
      if (vid) {
        const match = yt.find((a) => (a.href || '').includes(vid));
        if (match) {
          match.click();
          return 'matched';
        }
      }
      if (yt.length > 0) {
        yt[Math.floor(Math.random() * Math.min(yt.length, 5))].click();
        return 'first';
      }
      return '';
    }, expectedVid || '');

    if (clickResult) {
      log('info', `[Backlink] Clicked YouTube link (${clickResult})`);
      await sleep(randomDelay(4000, 8000));
      return { success: true, source: 'backlink' };
    }

    if (videoUrl) {
      log('warn', '[Backlink] No YT link on page — opening target video URL');
      await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(randomDelay(2500, 5000));
      return { success: true, source: 'backlink-direct-fallback' };
    }

    log('warn', '[Backlink] No YouTube link on referral page');
    return { success: false, source: 'backlink' };
  } catch (err) {
    log('warn', `[Backlink] ${err.message}`);
    return { success: false, source: 'backlink' };
  }
}

module.exports = {
  openVideoSmart,
  openVideoViaBacklink,
  extractVideoIdFromUrl,
  generateEscalationQueries,
  verifyVideoMatch,
  assignTrafficSource,
  parseDurationText,
  searchYouTube,
  searchGoogle,
  searchBing,
  searchDuckDuckGo,
  searchYahoo,
  searchChannelPage,
};
