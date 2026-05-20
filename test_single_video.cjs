/**
 * TEST SCRIPT — Single video test on P-351
 * Tests: Profile start → CDP connect → Search → Duration detect → Watch → Analytics
 */
const http = require('http');

const PROFILE_ID = '2052791530343174144'; // P-351
const PROFILE_NAME = 'P-351';
const MORELOGIN_API_KEY = 'dbc21d41137f29238f4679e71b7986decb0581115e34a84e';

function moreloginRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 40000, path: endpoint, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MORELOGIN_API_KEY, 'Content-Length': Buffer.byteLength(payload) },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ code: -1 }); } });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTest() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST: Single Video on P-351');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Step 1: Check profile status
  console.log('\n[1] Checking profile status...');
  const statusRes = await moreloginRequest('/api/env/status', { envId: PROFILE_ID });
  console.log('   Status response:', JSON.stringify(statusRes));

  let debugPort = null;
  if (statusRes.code === 0 && statusRes.data?.status === 'running' && statusRes.data?.debugPort) {
    debugPort = statusRes.data.debugPort;
    console.log(`   ✓ Profile already running! Port: ${debugPort}`);
  } else {
    // Start profile
    console.log('   Starting profile...');
    const startRes = await moreloginRequest('/api/env/start', { envId: PROFILE_ID });
    console.log('   Start response:', JSON.stringify(startRes));
    
    if (startRes.code === 0 && startRes.data?.debugPort) {
      debugPort = startRes.data.debugPort;
    } else {
      console.log('   Waiting 15s for profile to start...');
      await sleep(15000);
      const retry = await moreloginRequest('/api/env/status', { envId: PROFILE_ID });
      console.log('   Retry status:', JSON.stringify(retry));
      if (retry.code === 0 && retry.data?.debugPort) {
        debugPort = retry.data.debugPort;
      }
    }
  }

  if (!debugPort) {
    console.log('   ✗ FAILED: No debug port. Cannot continue.');
    return;
  }

  console.log(`   ✓ Debug port: ${debugPort}`);

  // Step 2: Connect Playwright CDP
  console.log('\n[2] Connecting Playwright CDP...');
  const { chromium } = require('playwright-core');
  let browser, context, page;
  
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    context = browser.contexts()[0];
    if (!context) context = await browser.newContext();
    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    console.log(`   ✓ Connected! Pages: ${pages.length}`);
  } catch (err) {
    console.log(`   ✗ CDP connection failed: ${err.message}`);
    return;
  }

  // Step 3: Go to YouTube
  console.log('\n[3] Opening YouTube...');
  await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(3000);
  const ytTitle = await page.title();
  console.log(`   ✓ YouTube loaded. Title: "${ytTitle}"`);

  // Step 4: Search for a video (use a known video)
  const testQuery = 'biryani recipe';
  console.log(`\n[4] Searching: "${testQuery}"...`);
  
  // Try '/' shortcut
  await page.keyboard.press('/');
  await sleep(800);
  const focused = await page.evaluate(() => document.activeElement?.id === 'search' || document.activeElement?.tagName === 'INPUT');
  console.log(`   Search focused: ${focused}`);
  
  if (focused) {
    await page.keyboard.press('Control+a');
    await sleep(100);
    await page.keyboard.press('Backspace');
    await sleep(200);
    // Type query (fast for test)
    for (const char of testQuery) {
      await page.keyboard.type(char, { delay: 80 });
    }
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(5000);
    
    // Check results
    const resultCount = await page.evaluate(() => document.querySelectorAll('ytd-video-renderer').length);
    console.log(`   ✓ Search results: ${resultCount} videos found`);
    
    // Click first video
    if (resultCount > 0) {
      const firstTitle = await page.evaluate(() => {
        const el = document.querySelector('ytd-video-renderer a#video-title');
        return el?.getAttribute('title') || el?.textContent?.trim() || 'unknown';
      });
      console.log(`   Clicking first result: "${firstTitle}"`);
      
      const firstVideo = await page.$('ytd-video-renderer a#video-title');
      if (firstVideo) {
        await firstVideo.click();
        await sleep(5000);
      }
    }
  } else {
    console.log('   ✗ Search bar not focused. Trying click method...');
    const searchInput = await page.$('input#search');
    if (searchInput) {
      await searchInput.click();
      await sleep(500);
      for (const char of testQuery) {
        await page.keyboard.type(char, { delay: 80 });
      }
      await page.keyboard.press('Enter');
      await sleep(5000);
      const firstVideo = await page.$('ytd-video-renderer a#video-title');
      if (firstVideo) await firstVideo.click();
      await sleep(5000);
    }
  }

  // Step 5: Check for ads
  console.log('\n[5] Checking for ads...');
  for (let i = 0; i < 30; i++) {
    const hasAd = await page.evaluate(() => {
      const ad = document.querySelector('.ytp-ad-player-overlay, .ad-showing, .ytp-ad-text');
      return !!ad;
    }).catch(() => false);
    
    if (hasAd) {
      console.log(`   Ad detected! Waiting... (${i+1}s)`);
      // Try skip
      const skipBtn = await page.$('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, [class*="skip"] button');
      if (skipBtn) {
        console.log('   Skip button found! Clicking...');
        await skipBtn.click();
        await sleep(1000);
        break;
      }
    } else {
      if (i === 0) console.log('   No ad detected');
      break;
    }
    await sleep(1000);
  }

  // Step 6: Get video duration (THE CRITICAL TEST)
  console.log('\n[6] DURATION DETECTION TEST...');
  await sleep(3000); // Wait for video to load
  
  for (let attempt = 0; attempt < 10; attempt++) {
    const durationInfo = await page.evaluate(() => {
      const video = document.querySelector('video');
      const durationEl = document.querySelector('.ytp-time-duration');
      const adOverlay = document.querySelector('.ytp-ad-player-overlay, .ad-showing');
      
      return {
        videoDuration: video?.duration || 0,
        videoCurrentTime: video?.currentTime || 0,
        videoPaused: video?.paused || false,
        durationText: durationEl?.textContent || 'NOT FOUND',
        hasAd: !!adOverlay,
        videoSrc: video?.src?.substring(0, 50) || 'none',
        readyState: video?.readyState || 0,
      };
    }).catch(() => ({ error: 'evaluate failed' }));
    
    console.log(`   Attempt ${attempt + 1}:`, JSON.stringify(durationInfo));
    
    if (durationInfo.videoDuration > 10 && !durationInfo.hasAd) {
      console.log(`   ✓ DURATION DETECTED: ${Math.round(durationInfo.videoDuration)}s (${durationInfo.durationText})`);
      break;
    }
    await sleep(2000);
  }

  // Step 7: Check video playing status
  console.log('\n[7] Video playing status...');
  const playStatus = await page.evaluate(() => {
    const v = document.querySelector('video');
    return {
      playing: v && !v.paused && !v.ended,
      currentTime: v?.currentTime || 0,
      duration: v?.duration || 0,
      paused: v?.paused,
      ended: v?.ended,
      muted: v?.muted,
      volume: v?.volume,
    };
  });
  console.log('   Status:', JSON.stringify(playStatus));

  // Step 8: Watch for 30 seconds and check progress
  console.log('\n[8] Watching for 30 seconds...');
  const watchStart = Date.now();
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    const progress = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { currentTime: Math.round(v?.currentTime || 0), paused: v?.paused };
    });
    console.log(`   ${i*5+5}s: currentTime=${progress.currentTime}s, paused=${progress.paused}`);
  }
  const watchEnd = Date.now();
  console.log(`   Wall clock: ${Math.round((watchEnd - watchStart) / 1000)}s`);

  // Step 9: Check for "Still watching?" popup
  console.log('\n[9] Checking for popups/overlays...');
  const popups = await page.evaluate(() => {
    const confirmBtn = document.querySelector('button[aria-label*="Yes"], .ytp-popup-confirm-button, paper-button#confirm-button, yt-confirm-dialog-renderer button');
    const overlay = document.querySelector('.ytp-ad-overlay-container, .ytp-popup-container');
    return {
      hasConfirmButton: !!confirmBtn,
      confirmText: confirmBtn?.textContent || 'none',
      hasOverlay: !!overlay,
    };
  });
  console.log('   Popups:', JSON.stringify(popups));

  // Step 10: Disconnect
  console.log('\n[10] Disconnecting...');
  await browser.close().catch(() => {});
  console.log('   ✓ Done!');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

runTest().catch(err => console.error('Test failed:', err.message));
