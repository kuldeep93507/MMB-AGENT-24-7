/**
 * REAL TEST — Tera channel "USA INSURANCE" ki videos
 * P-351: Video 1 (search by title)
 * P-348: Video 2 (search by title)
 * Full flow: Search → Click → Duration → Watch 60 sec → Report
 */
const http = require('http');
const { ProfileAgent } = require('./server/agent.cjs');

const PROFILES = [
  { id: '2052791530343174144', name: 'P-351', video: 'Best Credit Cards 2026: My $1,000/Month Rewards Strategy (Step-by-Step)', channel: 'USA INSURANCE' },
  { id: '2052697500397670400', name: 'P-348', video: 'The Top 5 Biggest Banks in the USA: Which is Best for You? (2026)', channel: 'USA INSURANCE' },
];

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

async function testProfile(profileData) {
  const { id, name, video, channel } = profileData;
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`TESTING: ${name} — "${video.substring(0, 50)}..."`);
  console.log(`${'━'.repeat(60)}`);

  // Step 1: Start/check profile
  console.log(`\n[${name}] Step 1: Starting profile...`);
  let debugPort = null;
  
  const statusRes = await moreloginRequest('/api/env/status', { envId: id });
  if (statusRes.code === 0 && statusRes.data?.status === 'running' && statusRes.data?.debugPort) {
    debugPort = statusRes.data.debugPort;
    console.log(`[${name}] Already running! Port: ${debugPort}`);
  } else {
    const startRes = await moreloginRequest('/api/env/start', { envId: id });
    if (startRes.code === 0 && startRes.data?.debugPort) {
      debugPort = startRes.data.debugPort;
    } else {
      console.log(`[${name}] Waiting 15s for profile...`);
      await sleep(15000);
      const retry = await moreloginRequest('/api/env/status', { envId: id });
      if (retry.code === 0 && retry.data?.debugPort) debugPort = retry.data.debugPort;
    }
  }

  if (!debugPort) {
    console.log(`[${name}] ✗ FAILED: No debug port`);
    return;
  }
  console.log(`[${name}] ✓ Port: ${debugPort}`);

  // Step 2: Create agent and connect
  console.log(`\n[${name}] Step 2: Connecting agent...`);
  const agent = new ProfileAgent(id, name, debugPort);
  const connected = await agent.connect();
  if (!connected) {
    console.log(`[${name}] ✗ CDP connection failed`);
    return;
  }
  console.log(`[${name}] ✓ Connected!`);
  console.log(`[${name}] Typing speed: ${JSON.stringify(agent.typingSpeed)}`);

  // Step 3: Run searchAndWatch with SHORT watch time (60 sec for test)
  console.log(`\n[${name}] Step 3: searchAndWatch("${video.substring(0, 40)}...", "${channel}")`);
  console.log(`[${name}] Config: watchTimeMin=80, watchTimeMax=100, trafficMix=youtube-search`);
  
  const startTime = Date.now();
  
  const config = {
    trafficPreference: 'custom',
    trafficMix: { youtubeSearch: 100, channelPage: 0, google: 0, bing: 0, direct: 0 },
    watchTimeMin: 80,
    watchTimeMax: 100,
    likeEnabled: false,
    subscribeEnabled: false,
    commentEnabled: false,
    adSkipEnabled: true,
    adSkipAfterSec: 5,
    videoQuality: 'auto',
    scrollDuringWatch: true,
  };

  // Override watchVideo to only watch 60 seconds (for test speed)
  const originalGetDuration = agent.getVideoDuration.bind(agent);
  agent.getVideoDuration = async (page) => {
    const realDuration = await originalGetDuration(page);
    console.log(`[${name}] ★ REAL DURATION DETECTED: ${Math.round(realDuration/1000)}s`);
    // For test: cap at 60 sec watch
    return Math.min(realDuration, 75000); // 75 sec max for test (so 80% = 60 sec)
  };

  const success = await agent.searchAndWatch(video, channel, config);
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n[${name}] ═══════════════════════════════════`);
  console.log(`[${name}] RESULT: ${success ? '✓ SUCCESS' : '✗ FAILED'}`);
  console.log(`[${name}] Total time: ${elapsed}s`);
  console.log(`[${name}] Last traffic source: ${agent._lastTrafficSource || 'unknown'}`);
  console.log(`[${name}] Logs:`);
  agent.logs.slice(-15).forEach(l => {
    console.log(`   [${l.level}] ${l.message}`);
  });
  console.log(`[${name}] ═══════════════════════════════════`);

  // Disconnect (leave browser open)
  await agent.disconnect();
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  MMB AGENT — REAL VIDEO TEST                            ║');
  console.log('║  Channel: USA INSURANCE (@KULDEEP1211-g9o)              ║');
  console.log('║  Profiles: P-351, P-348                                 ║');
  console.log('║  Watch: 60 sec (capped for test speed)                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Test P-351 first
  await testProfile(PROFILES[0]);
  
  // Small gap
  console.log('\n\n⏳ Waiting 5s before P-348 test...\n');
  await sleep(5000);
  
  // Test P-348
  await testProfile(PROFILES[1]);

  console.log('\n\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ALL TESTS COMPLETE                                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(err => console.error('Fatal:', err.message));
