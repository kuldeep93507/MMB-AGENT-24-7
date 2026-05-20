/**
 * TEST SCRIPT — P-348 with longer video + ad detection stress test
 */
const http = require('http');

const PROFILE_ID = '2052697500397670400'; // P-348
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
  console.log('TEST: P-348 — Long Video + Ad Stress Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Start profile
  console.log('\n[1] Starting P-348...');
  const statusRes = await moreloginRequest('/api/env/status', { envId: PROFILE_ID });
  let debugPort = null;
  
  if (statusRes.code === 0 && statusRes.data?.status === 'running' && statusRes.data?.debugPort) {
    debugPort = statusRes.data.debugPort;
    console.log(`   Already running! Port: ${debugPort}`);
  } else {
    const startRes = await moreloginRequest('/api/env/start', { envId: PROFILE_ID });
    if (startRes.code === 0 && startRes.data?.debugPort) {
      debugPort = startRes.data.debugPort;
    } else {
      await sleep(15000);
      const retry = await moreloginRequest('/api/env/status', { envId: PROFILE_ID });
      if (retry.code === 0 && retry.data?.debugPort) debugPort = retry.data.debugPort;
    }
  }

  if (!debugPort) { console.log('   ✗ No debug port'); return; }
  console.log(`   ✓ Port: ${debugPort}`);

  // Connect
  console.log('\n[2] Connecting CDP...');
  const { chromium } = require('playwright-core');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  console.log(`   ✓ Connected! Pages: ${pages.length}`);

  // Search for a LONG video (30+ min)
  const testQuery = 'full movie hindi dubbed 2024';
  console.log(`\n[3] Searching long video: "${testQuery}"...`);
  await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2000);
  
  await page.keyboard.press('/');
  await sleep(800);
  await page.keyboard.press('Control+a');
  await sleep(100);
  await page.keyboard.press('Backspace');
  await sleep(200);
  for (const char of testQuery) {
    await page.keyboard.type(char, { delay: 60 });
  }
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(5000);

  // Find a video that's 30+ minutes
  const videos = await page.evaluate(() => {
    const results = document.querySelectorAll('ytd-video-renderer');
    const list = [];
    for (let i = 0; i < Math.min(results.length, 10); i++) {
      const titleEl = results[i].querySelector('a#video-title');
      const timeEl = results[i].querySelector('ytd-thumbnail-overlay-time-status-renderer span');
      list.push({
        index: i,
        title: titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || '',
        duration: timeEl?.textContent?.trim() || 'unknown',
      });
    }
    return list;
  });
  
  console.log('   Results:');
  videos.forEach(v => console.log(`     [${v.index}] ${v.duration} — ${v.title.substring(0, 60)}`));

  // Click first video (any duration for now)
  const firstVideo = await page.$('ytd-video-renderer a#video-title');
  if (firstVideo) {
    const clickTitle = await firstVideo.getAttribute('title').catch(() => 'unknown');
    console.log(`\n[4] Clicking: "${clickTitle.substring(0, 60)}"`);
    await firstVideo.click();
    await sleep(5000);
  }

  // AD DETECTION — detailed
  console.log('\n[5] AD DETECTION (detailed)...');
  let adFound = false;
  for (let i = 0; i < 15; i++) {
    const adInfo = await page.evaluate(() => {
      const adOverlay = document.querySelector('.ytp-ad-player-overlay, .ad-showing');
      const adText = document.querySelector('.ytp-ad-text, .ytp-ad-preview-text, .ytp-ad-simple-ad-badge');
      const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, [class*="skip"] button');
      const video = document.querySelector('video');
      return {
        hasAdOverlay: !!adOverlay,
        adText: adText?.textContent?.trim() || 'none',
        hasSkipBtn: !!skipBtn,
        skipBtnText: skipBtn?.textContent?.trim() || 'none',
        videoDuration: video?.duration || 0,
        videoCurrentTime: video?.currentTime || 0,
      };
    }).catch(() => ({ error: true }));
    
    if (adInfo.hasAdOverlay) {
      adFound = true;
      console.log(`   ${i+1}s: AD! duration=${Math.round(adInfo.videoDuration)}s, skip=${adInfo.hasSkipBtn}, text="${adInfo.adText}"`);
      if (adInfo.hasSkipBtn) {
        console.log('   → Skipping ad...');
        const skipBtn = await page.$('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, [class*="skip"] button');
        if (skipBtn) await skipBtn.click();
        await sleep(2000);
        break;
      }
    } else {
      if (i === 0 && !adFound) console.log('   No ad on first check');
      if (adFound) { console.log(`   Ad finished at ${i+1}s`); break; }
      if (i > 3) break; // No ad after 4 seconds, move on
    }
    await sleep(1000);
  }

  // DURATION DETECTION — THE CRITICAL TEST
  console.log('\n[6] DURATION DETECTION (after ad)...');
  // Wait 3 sec after ad (this is the fix we need to test)
  await sleep(3000);
  
  for (let attempt = 0; attempt < 15; attempt++) {
    const info = await page.evaluate(() => {
      const video = document.querySelector('video');
      const durationEl = document.querySelector('.ytp-time-duration');
      const adOverlay = document.querySelector('.ytp-ad-player-overlay, .ad-showing');
      return {
        videoDuration: video?.duration || 0,
        isFinite: isFinite(video?.duration),
        durationText: durationEl?.textContent || 'NOT FOUND',
        hasAd: !!adOverlay,
        readyState: video?.readyState || 0,
        currentTime: Math.round(video?.currentTime || 0),
        paused: video?.paused,
      };
    }).catch(() => ({ error: true }));
    
    console.log(`   Attempt ${attempt + 1}: duration=${Math.round(info.videoDuration)}s, text="${info.durationText}", ad=${info.hasAd}, ready=${info.readyState}, time=${info.currentTime}s`);
    
    if (info.videoDuration > 10 && !info.hasAd && info.isFinite) {
      console.log(`\n   ✓ FINAL DURATION: ${Math.round(info.videoDuration)}s (${info.durationText})`);
      console.log(`   ✓ Video playing at: ${info.currentTime}s, paused: ${info.paused}`);
      break;
    }
    
    if (attempt === 14) {
      console.log('\n   ✗ DURATION DETECTION FAILED after 15 attempts!');
      console.log('   → This is the bug! Would fallback to 300000ms (5 min)');
    }
    await sleep(1000);
  }

  // Watch 20 seconds and verify progress
  console.log('\n[7] Watching 20 seconds — verifying actual playback...');
  const startTime = Date.now();
  let startPos = 0, endPos = 0;
  
  const pos1 = await page.evaluate(() => document.querySelector('video')?.currentTime || 0);
  startPos = pos1;
  
  for (let i = 0; i < 4; i++) {
    await sleep(5000);
    const pos = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { time: Math.round(v?.currentTime || 0), paused: v?.paused };
    });
    endPos = pos.time;
    console.log(`   ${(i+1)*5}s: video at ${pos.time}s, paused=${pos.paused}`);
  }
  
  const wallClock = Math.round((Date.now() - startTime) / 1000);
  const videoAdvanced = Math.round(endPos - startPos);
  console.log(`\n   Wall clock: ${wallClock}s`);
  console.log(`   Video advanced: ${videoAdvanced}s`);
  console.log(`   Drift: ${wallClock - videoAdvanced}s (should be ~0)`);
  
  if (Math.abs(wallClock - videoAdvanced) > 5) {
    console.log('   ⚠️ DRIFT DETECTED! Video not advancing at real-time speed (buffering/paused?)');
  } else {
    console.log('   ✓ Video advancing normally');
  }

  // Disconnect (don't close browser — leave it for user to see)
  console.log('\n[8] Disconnecting CDP (browser stays open)...');
  await browser.close().catch(() => {});
  console.log('   ✓ Done!');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST COMPLETE — P-348');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

runTest().catch(err => console.error('Test failed:', err.message));
