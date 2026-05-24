/**
 * Video watching: duration discovery, ads, timed watch loop (+ mixed-in ProfileAgent methods).
 * Scroll/keyboard/mouse + description + related hover: HumanBehavior / YoutubeUi (agent.cjs → setBehaviorHelpers).
 * Traffic source routing (youtube UI search helpers) lives in TrafficRouter.cjs — separate from watcher.
 */

const { planWatchAction } = require('../agentBrain.cjs');

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Populated by agent.cjs via setBehaviorHelpers before ProfileAgent instances run watch flows. */
let behavior = {};

function setBehaviorHelpers(d) {
  behavior = d;
}

function bx() {
  return behavior;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AD DETECTION — strict (avoids false 5min "ad wait" + replay)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function detectYouTubeAd(page) {
  return page.evaluate(() => {
    const skipSelectors = '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button, button[aria-label*="Skip" i], .ytp-ad-skip-button-slot button';
    const skipBtn = document.querySelector(skipSelectors);
    const skipVisible = !!(skipBtn && skipBtn.offsetParent !== null
      && window.getComputedStyle(skipBtn).display !== 'none');

    const player = document.querySelector('#movie_player, .html5-video-player');
    if (player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) {
      return { hasAd: true, skipVisible };
    }
    const overlay = document.querySelector('.ytp-ad-player-overlay');
    if (overlay) {
      const rect = overlay.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        return { hasAd: true, skipVisible };
      }
    }
    if (skipVisible) return { hasAd: true, skipVisible: true };
    const video = document.querySelector('video');
    // Main video already playing (long duration) — stale ad UI, not a real ad
    if (video && video.duration > 90 && video.currentTime > 2) {
      return { hasAd: false, skipVisible: false };
    }
    const adText = document.querySelector('.ytp-ad-text, .ytp-ad-preview-text');
    if (adText && video && video.duration > 0 && video.duration <= 70) {
      return { hasAd: true, skipVisible };
    }
    return { hasAd: false, skipVisible: false };
  }).catch(() => ({ hasAd: false, skipVisible: false }));
}

/** In-page ad skipper (page context click + seek/speedup for unskippable ads). */
async function ensureYouTubeAdSkipper(page, config = {}) {
  const enabled = config.adSkipEnabled !== false;
  const minWaitSec = Math.max(0, Number(config.adSkipAfterSec ?? 5));
  await page.evaluate(({ enabled, minWaitSec }) => {
    if (window.__mmbAdSkipperInstalled) return;
    window.__mmbAdSkipperInstalled = true;
    window.__mmbAdSkipStart = null;

    const isAdPlaying = () => {
      const player = document.querySelector('#movie_player, .html5-video-player');
      if (player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) return true;
      return !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-preview-text, .ytp-skip-ad-button, .ytp-ad-skip-button');
    };

    const trySkip = () => {
      if (!enabled) return { action: 'disabled' };
      if (!isAdPlaying()) {
        window.__mmbAdSkipStart = null;
        return { action: 'none' };
      }
      if (!window.__mmbAdSkipStart) window.__mmbAdSkipStart = Date.now();
      const elapsedSec = (Date.now() - window.__mmbAdSkipStart) / 1000;
      if (elapsedSec < minWaitSec) return { action: 'waiting', elapsedSec };

      const selectors = [
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button',
        'button.ytp-ad-skip-button',
        'button[aria-label*="Skip ad" i]',
        'button[aria-label*="Skip" i]',
        '.ytp-ad-skip-button-slot button',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (!btn || btn.offsetParent === null) continue;
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        btn.click();
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { action: 'clicked', selector: sel };
      }

      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && video.duration > 0 && isFinite(video.duration) && video.duration <= 180) {
        try {
          video.currentTime = Math.max(0, video.duration - 0.05);
          return { action: 'seeked' };
        } catch { /* ignore */ }
      }
      if (video && video.playbackRate < 8) {
        try { video.playbackRate = 16; return { action: 'speedup' }; } catch { /* ignore */ }
      }
      return { action: 'pending' };
    };

    window.__mmbTrySkipAd = trySkip;
    setInterval(trySkip, 400);
    document.addEventListener('yt-navigate-finish', () => {
      window.__mmbAdSkipStart = null;
      trySkip();
    }, true);
  }, { enabled, minWaitSec }).catch(() => {});
}

async function attemptSkipYouTubeAd(page, config = {}) {
  const adSkipEnabled = config.adSkipEnabled !== false;
  const adSkipAfterSec = Math.max(0, Number(config.adSkipAfterSec ?? 5));
  if (!adSkipEnabled) return { skipped: false, reason: 'disabled' };

  await ensureYouTubeAdSkipper(page, config);

  const result = await page.evaluate(({ adSkipAfterSec }) => {
    const isAdPlaying = () => {
      const player = document.querySelector('#movie_player, .html5-video-player');
      if (player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) return true;
      return !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-preview-text, .ytp-skip-ad-button, .ytp-ad-skip-button');
    };
    if (!isAdPlaying()) return { skipped: false, reason: 'no_ad' };

    if (typeof window.__mmbTrySkipAd === 'function') {
      const r = window.__mmbTrySkipAd();
      if (r?.action === 'clicked' || r?.action === 'seeked') return { skipped: true, method: r.action };
      if (r?.action === 'waiting') return { skipped: false, reason: 'waiting', waitSec: adSkipAfterSec };
    }

    const selectors = [
      '.ytp-skip-ad-button', '.ytp-ad-skip-button-modern', '.ytp-ad-skip-button',
      'button[aria-label*="Skip" i]', '.ytp-ad-skip-button-slot button',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        return { skipped: true, method: 'click', selector: sel };
      }
    }
    const video = document.querySelector('video');
    if (video && video.duration > 0 && isFinite(video.duration) && video.duration <= 180) {
      video.currentTime = Math.max(0, video.duration - 0.05);
      return { skipped: true, method: 'seek' };
    }
    return { skipped: false, reason: 'no_button' };
  }, { adSkipAfterSec }).catch(() => ({ skipped: false, reason: 'error' }));

  return result;
}

async function waitForAdsToClear(page, config = {}, logFn = () => {}, maxWaitSec = 300) {
  const adSkipEnabled = config.adSkipEnabled !== false;
  const adSkipAfterSec = Math.max(0, Number(config.adSkipAfterSec ?? 5));
  await ensureYouTubeAdSkipper(page, config);

  let adSeen = false;
  let skippedCount = 0;
  const start = Date.now();

  while ((Date.now() - start) / 1000 < maxWaitSec) {
    const adInfo = await detectYouTubeAd(page);
    if (!adInfo.hasAd) {
      if (adSeen) logFn('info', `Ads cleared after ${Math.round((Date.now() - start) / 1000)}s`);
      break;
    }
    adSeen = true;

    if (adSkipEnabled && adInfo.skipVisible) {
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed >= adSkipAfterSec) {
        const attempt = await attemptSkipYouTubeAd(page, config);
        if (attempt.skipped) {
          skippedCount++;
          logFn('info', `⏭ Ad skipped (${attempt.method || 'auto'})`);
          await sleep(randomDelay(600, 1200));
          const after = await detectYouTubeAd(page);
          if (!after.hasAd) break;
        }
      }
    } else if (adSkipEnabled) {
      const attempt = await attemptSkipYouTubeAd(page, config);
      if (attempt.skipped) {
        skippedCount++;
        logFn('info', `⏭ Ad bypassed (${attempt.method || 'seek/speed'})`);
        await sleep(randomDelay(600, 1200));
        const after = await detectYouTubeAd(page);
        if (!after.hasAd) break;
      }
    }

    await sleep(450);
  }

  return { adSeen, skippedCount, waitedMs: Date.now() - start };
}

async function getVideoPlaybackState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return { ok: false };
    const dur = v.duration || 0;
    const cur = v.currentTime || 0;
    return {
      ok: true,
      paused: v.paused,
      ended: v.ended,
      nearEnd: dur > 0 && cur >= Math.max(0, dur - 3),
      currentTime: cur,
      duration: dur,
    };
  }).catch(() => ({ ok: false }));
}

const videoWatcherPrototype = {
  async getVideoDuration(page, config = {}) {
    const adSkipEnabled = config.adSkipEnabled !== false;
    const adSkipAfterSec = config.adSkipAfterSec ?? 15;
    this.log('info', `Waiting for ads to finish (adSkip: ${adSkipEnabled ? 'ON' : 'OFF'}, wait ${adSkipAfterSec}s before skip)...`);
    await waitForAdsToClear(page, config, (l, m) => this.log(l, m), 300);

    await sleep(2000);

    for (let i = 0; i < 20; i++) {
      try {
        const duration = await page.evaluate(() => {
          const adOverlay = document.querySelector('.ytp-ad-player-overlay, .ad-showing, [class*="ad-showing"]');
          if (adOverlay) return 0;

          const video = document.querySelector('video');
          if (video && video.duration && isFinite(video.duration) && video.duration > 10) {
            return Math.round(video.duration * 1000);
          }

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

          const metaDuration = document.querySelector('ytd-watch-metadata span.ytd-badge-and-author-renderer');
          if (metaDuration?.textContent) {
            const parts = metaDuration.textContent.trim().split(':').map(Number);
            if (parts.length === 2 && parts.every(p => !isNaN(p))) {
              return (parts[0] * 60 + parts[1]) * 1000;
            }
          }

          return 0;
        });

        if (duration > 10000) {
          this.log('info', `Real video duration: ${Math.round(duration / 1000)}s`);
          return duration;
        }
      } catch {}
      await sleep(500);
    }

    this.log('warn', 'Could not read duration — using 5min default');
    return 300000;
  },

  async handleAds(page, config = {}) {
    const { sleep: sl, randomDelay: rd, trackEngagement } = bx();
    const adSkipEnabled = config.adSkipEnabled !== false;
    const adSkipAfterSec = config.adSkipAfterSec || 15;
    let totalAdTime = 0;
    let adsCount = 0;
    let adsSkipped = 0;

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const adInfo = await detectYouTubeAd(page).then((r) => ({
          hasAd: r.hasAd,
          adDurationSec: 0,
          hasSkipBtn: r.skipVisible,
          countdownText: '',
        }));
        if (adInfo.hasAd) {
          const fullAdInfo = await page.evaluate(() => {
            const video = document.querySelector('video');
            const adDurationSec = (video && video.duration && isFinite(video.duration))
              ? Math.round(video.duration)
              : 0;
            return { adDurationSec };
          }).catch(() => ({ adDurationSec: 0 }));
          adInfo.adDurationSec = fullAdInfo.adDurationSec;
        }

        if (!adInfo.hasAd) break;

        adsCount++;
        const adStartTime = Date.now();
        this.log('info', `📺 Ad #${adsCount} detected — duration: ${adInfo.adDurationSec}s, skippable: ${adInfo.hasSkipBtn}`);

        if (!adSkipEnabled) {
          const waitMs = adInfo.adDurationSec > 0
            ? (adInfo.adDurationSec * 1000 + 2000)
            : 60000;
          this.log('info', `Ad Skip OFF — watching full ad (${Math.round(waitMs / 1000)}s)`);
          await this._waitForAdToFinish(page, waitMs);
          totalAdTime += Date.now() - adStartTime;
          continue;
        }

        await ensureYouTubeAdSkipper(page, config);
        const skipDeadline = Date.now() + (adSkipAfterSec * 1000) + rd(300, 1000);
        while (Date.now() < skipDeadline) await sl(400);

        let skipped = false;
        for (let poll = 0; poll < 40; poll++) {
          const attempt = await attemptSkipYouTubeAd(page, config);
          if (attempt.skipped) {
            skipped = true;
            break;
          }
          const stillAd = await detectYouTubeAd(page);
          if (!stillAd.hasAd) break;
          await sl(450);
        }

        if (skipped) {
          adsSkipped++;
          this.log('info', `✓ Ad skipped after ${adSkipAfterSec}s`);
          totalAdTime += Date.now() - adStartTime;
          await sl(rd(1000, 2000));
          continue;
        }

        const seekAttempt = await attemptSkipYouTubeAd(page, config);
        if (seekAttempt.skipped && (seekAttempt.method === 'seek' || seekAttempt.method === 'speedup')) {
          adsSkipped++;
          this.log('info', `✓ Unskippable ad bypassed via ${seekAttempt.method}`);
          totalAdTime += Date.now() - adStartTime;
          await sl(rd(1000, 2000));
          continue;
        }
        this.log('info', `Unskippable ad — waiting for it to finish naturally (${adInfo.adDurationSec}s)`);
        const unskippableWait = adInfo.adDurationSec > 0
          ? (adInfo.adDurationSec * 1000 + 3000)
          : 120000;
        await this._waitForAdToFinish(page, unskippableWait);
        totalAdTime += Date.now() - adStartTime;
      } catch (err) {
        this.log('warn', `Ad handling error: ${err.message}`);
        break;
      }
    }

    if (adsCount > 0) {
      this.log('info', `Ads done — total: ${adsCount}, skipped: ${adsSkipped}, time: ${Math.round(totalAdTime / 1000)}s`);
      await trackEngagement(this.profileId, 'ads_total', adsCount).catch(() => {});
      await trackEngagement(this.profileId, 'ads_skipped', adsSkipped).catch(() => {});
      await trackEngagement(this.profileId, 'ads_watched_full', adsCount - adsSkipped).catch(() => {});
      await trackEngagement(this.profileId, 'ad_watch_time', Math.round(totalAdTime / 1000)).catch(() => {});
    }

    return { totalAdTime, adsCount, adsSkipped };
  },

  async _waitForAdToFinish(page, maxWaitMs) {
    const { sleep: sl } = bx();
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await sl(1000);
      try {
        const stillHasAd = await page.evaluate(() => {
          return !!(
            document.querySelector('.ytp-ad-player-overlay')
            || document.querySelector('.ad-showing')
            || document.querySelector('.ytp-ad-text')
          );
        });
        if (!stillHasAd) {
          this.log('info', `Ad finished after ${Math.round((Date.now() - startTime) / 1000)}s`);
          return;
        }
      } catch { break; }
    }
  },

  async watchVideo(page, durationMs, config = {}) {
    const {
      sleep: sl,
      randomDelay: rd,
      smoothScroll,
      humanMouseMove,
      expandDescriptionAndRead,
      hoverRelatedVideos,
      humanType,
      seekForwardKeyboard,
      trackEngagement,
    } = bx();

    await this.handleAds(page, config);

    if (durationMs <= 0) {
      this.log('info', '✅ Watch target already met — skipping timer (prevents replay)');
      return;
    }

    const startTime = Date.now();
    let totalAdTime = 0;
    let adPlaying = false;
    let adStartTime = 0;

    try {
      const isPaused = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? v.paused : true;
      }).catch(() => true);

      if (isPaused) {
        const bigPlayBtn = await page.$('.ytp-large-play-button, .ytp-play-button').catch(() => null);
        if (bigPlayBtn) {
          await bigPlayBtn.click();
          await sl(rd(1000, 2000));
        } else {
          const videoEl = await page.$('video').catch(() => null);
          if (videoEl) {
            const box = await videoEl.boundingBox().catch(() => null);
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              await sl(rd(1000, 2000));
            } else {
              await videoEl.click().catch(() => {});
              await sl(rd(1000, 2000));
            }
          } else {
            const player = await page.$('#movie_player, .html5-video-player, #player').catch(() => null);
            if (player) { await player.click().catch(() => {}); await sl(rd(1000, 2000)); }
          }
        }
      }
    } catch {}

    let playCheckCancelled = false;
    const playCheckTimers = new Set();
    const schedulePlayCheck = () => {
      if (playCheckCancelled) return;
      const nextDelay = rd(4000, 7000);
      const tid = setTimeout(async () => {
        playCheckTimers.delete(tid);
        if (playCheckCancelled) return;
        try {
          const adInfo = await detectYouTubeAd(page);
          const hasAd = adInfo.hasAd;

          if (hasAd) {
            if (!adPlaying) {
              adPlaying = true;
              adStartTime = Date.now();
              this.log('info', '📺 Mid-roll ad shuru — timer paused');
              this.adPlaying = true;
              this.adCount = (this.adCount || 0) + 1;
            }

            if (config?.adSkipEnabled !== false) {
              const midWait = config?.midRollAdWaitSec ?? config?.adSkipAfterSec ?? 15;
              const baseDelay = midWait * 1000;
              const jitter = rd(-1500, 2500);
              await sl(Math.max(2000, baseDelay + jitter));
              const attempt = await attemptSkipYouTubeAd(page, config);
              if (attempt.skipped) {
                this.log('info', `⏭ Mid-roll ad skipped after ${midWait}s (${attempt.method || 'auto'})`);
              }
            }

            await trackEngagement(this.profileId, 'ads_total', 1).catch(() => {});
            if (!playCheckCancelled) schedulePlayCheck();
            return;
          }

          if (adPlaying) {
            const adDuration = Date.now() - adStartTime;
            totalAdTime += adDuration;
            adPlaying = false;
            this.adPlaying = false;
            this.log('info', `📺 Ad khatam — ${Math.round(adDuration / 1000)}s tha. Total ad time: ${Math.round(totalAdTime / 1000)}s. Timer resume.`);
          }

          const vState = await getVideoPlaybackState(page);

          if (vState.ok && (vState.ended || vState.nearEnd)) {
            this.log('info', 'Video end detected — not clicking replay');
            playCheckCancelled = true;
            return;
          }

          if (vState.ok && vState.paused) {
            try {
              const replayBtn = await page.$('.ytp-play-button[aria-label*="Replay" i], .ytp-play-button[title*="Replay" i]').catch(() => null);
              if (replayBtn) {
                this.log('info', 'Replay button visible — watch done, not restarting');
                playCheckCancelled = true;
                return;
              }
              const playBtn = await page.$('.ytp-play-button[aria-label*="Play"], .ytp-play-button[title*="Play"]').catch(() => null);
              if (playBtn) {
                await playBtn.click();
              } else {
                const player = await page.$('#movie_player, .html5-video-player').catch(() => null);
                if (player) await player.click().catch(() => {});
              }
              this.log('info', 'Video paused tha — resume kiya');
            } catch (playErr) {
              this.log('warn', `[watchVideo] resume UI: ${playErr.message}`);
            }
          }
        } catch (loopErr) {
          this.log('warn', `[watchVideo] play-check: ${loopErr.message}`);
        }
        if (!playCheckCancelled) schedulePlayCheck();
      }, nextDelay);
      playCheckTimers.add(tid);
    };
    schedulePlayCheck();

    try {
      const pers = this._personality;
      const commentScrollChance = pers?.commentScrollChance ?? 0.4;
      const relatedPeekChance = pers?.relatedPeekChance ?? 0.2;
      const mouseMoveChance = pers?.mouseMoveChance ?? 0.3;
      const scrollAmount = pers ? pers.pickInt(180, 520) : rd(200, 500);
      const pauseDuration = pers ? pers.pickInt(1000, 4000) : rd(1000, 4000);

      const phase1End = pers?.phase1End ?? 0.08;
      const phase2End = pers?.phase2End ?? 0.22;
      const phase3End = pers?.phase3End ?? 0.48;
      const phase4End = pers?.phase4End ?? 0.68;
      const phase5End = pers?.phase5End ?? 0.85;

      while (true) {
        if (adPlaying) {
          await sl(1000);
          continue;
        }

        const atEnd = await page.evaluate(() => {
          const v = document.querySelector('video');
          return !!(v && (v.ended || (v.duration > 10 && v.currentTime >= v.duration - 2)));
        }).catch(() => false);
        if (atEnd) {
          this.log('info', '✅ Video reached end — watch complete (no replay)');
          break;
        }

        const totalElapsed = Date.now() - startTime;
        const actualWatched = totalElapsed - totalAdTime;
        const remaining = durationMs - actualWatched;

        if (remaining <= 0) {
          this.log('info', `✅ Video complete! Watched: ${Math.round(actualWatched / 1000)}s | Ad time: ${Math.round(totalAdTime / 1000)}s | Total elapsed: ${Math.round(totalElapsed / 1000)}s`);
          break;
        }

        const progress = actualWatched / durationMs;

        if (progress < phase1End) {
          await sl(Math.min(rd(8000, 20000), remaining));
          continue;
        }

        if (progress < phase2End) {
          if (config?.qaTestMode && !this._qaScrolledEarly) {
            this._qaScrolledEarly = true;
            await smoothScroll(page, pers.pickInt(200, 450), 'down', pers);
            await sl(rd(1500, 3000));
            await smoothScroll(page, pers.pickInt(150, 300), 'up', pers);
            this.log('info', '[QA] Early scroll on watch page');
          }
          if (pers.chance(mouseMoveChance)) {
            const x = rd(150, 900);
            const y = rd(100, 400);
            await page.mouse.move(x, y, { steps: rd(5, 15) }).catch(() => {});
            await sl(rd(500, 2000));
          }
          await sl(Math.min(rd(10000, 25000), remaining));
          continue;
        }

        if (progress < phase3End) {
          const humanOn = config?.humanEngagementEnabled !== false;
          if (humanOn && !this._descriptionOpened && progress >= 0.22 && progress < 0.42) {
            this._descriptionOpened = true;
            await expandDescriptionAndRead(page, (l, m) => this.log(l, m));
          }

          const scrollPlan = planWatchAction(progress, config, 3, pers);
          if (scrollPlan.scroll) {
            const px = scrollPlan.intensity || scrollAmount;
            await smoothScroll(page, px + (pers ? pers.pickInt(50, 200) : rd(50, 200)), 'down', pers);
            await sl(scrollPlan.pauseMs || rd(2000, 6000));
            if (humanOn && !this._relatedHovered && pers.chance(0.55)) {
              await hoverRelatedVideos(page, (l, m) => this.log(l, m));
              this._relatedHovered = true;
            }
            if (pers.chance(0.35)) {
              await smoothScroll(page, pers ? pers.pickInt(50, 150) : rd(50, 150), 'down', pers);
              await sl(pauseDuration);
            }
            await smoothScroll(page, px + (pers ? pers.pickInt(50, 200) : rd(50, 200)), 'up', pers);
            await sl(rd(500, 1500));
          } else if (config?.scrollDuringWatch !== false && pers.chance(commentScrollChance * 0.5)) {
            await smoothScroll(page, scrollAmount, 'down', pers);
            await sl(rd(1500, 4000));
            if (humanOn) await hoverRelatedVideos(page, (l, m) => this.log(l, m));
            await smoothScroll(page, scrollAmount, 'up', pers);
          }

          if (progress >= 0.4 && progress < 0.6 && config?.likeEnabled && !this._likedThisVideo) {
            const shouldLike = await this._shouldEngage('like', progress, this.currentVideo, config);
            if (shouldLike) {
              try {
                const likeBtn = await page.$('like-button-view-model button, ytd-toggle-button-renderer#top-level-buttons-computed button:first-child, button[aria-label*="like"]');
                if (likeBtn) {
                  const isLiked = await likeBtn.evaluate(el => el.getAttribute('aria-pressed') === 'true');
                  if (!isLiked) {
                    await humanMouseMove(page);
                    await sl(rd(500, 1500));
                    await likeBtn.click();
                    this._likedThisVideo = true;
                    this.log('info', '👍 Liked at ~50%');
                    await trackEngagement(this.profileId, 'like').catch(() => {});
                  }
                }
              } catch {}
            }
          }

          const seekMax = config?.seekForwardMax ?? 2;
          const seekCount = this._seekForwardCount || 0;
          if (
            seekCount < seekMax
            && progress >= 0.2
            && progress < 0.55
            && (config?.humanEngagementEnabled !== false || config?.qaTestMode)
            && (config?.qaTestMode || pers.chance(0.35))
          ) {
            const sec = config?.seekForwardSec || 10;
            try {
              await seekForwardKeyboard(page, sec, pers);
              this._seekForwardCount = seekCount + 1;
              this._seekedForward = true;
              this.log('info', `[Human] ⏩ Forward ~${sec}s via keyboard (${this._seekForwardCount}/${seekMax})`);
              await sl(pers ? pers.pickInt(1500, 2800) : rd(1500, 2800));
            } catch (seekErr) {
              this.log('warn', `[Human] Seek forward failed: ${seekErr.message}`);
            }
          }

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
                await sl(rd(500, 1200));
                await dislikeBtn.click();
                this._dislikedThisVideo = true;
                this.log('info', '👎 Dislike clicked (QA test)');
              }
            } catch {}
          }

          await sl(Math.min(rd(15000, 35000), remaining));
          continue;
        }

        if (progress < phase4End) {
          if (pers.chance(mouseMoveChance)) {
            const x = rd(200, 750);
            const y = rd(80, 300);
            await page.mouse.move(x, y, { steps: rd(8, 20) }).catch(() => {});
          }

          if (progress >= 0.7 && config?.subscribeEnabled && !this._subscribedThisSession) {
            const shouldSub = await this._shouldEngage('subscribe', progress, this.currentVideo, config);
            if (shouldSub) {
              try {
                const subBtn = await page.$('#subscribe-button button, ytd-subscribe-button-renderer button');
                if (subBtn) {
                  const text = await subBtn.textContent().catch(() => '');
                  if (text && !text.toLowerCase().includes('subscribed')) {
                    await humanMouseMove(page);
                    await sl(rd(1000, 3000));
                    await subBtn.click();
                    this._subscribedThisSession = true;
                    this.log('info', '🔔 Subscribed at ~70%');
                    await trackEngagement(this.profileId, 'subscribe').catch(() => {});
                  }
                }
              } catch {}
            }
          }

          await sl(Math.min(rd(12000, 28000), remaining));
          continue;
        }

        if (progress < phase5End) {
          const peekPlan = planWatchAction(progress, config, 5, pers);
          if (peekPlan.scroll || (config?.scrollDuringWatch !== false && pers.chance(relatedPeekChance))) {
            const peekPx = peekPlan.intensity || (pers ? pers.pickInt(100, 300) : rd(100, 300));
            await smoothScroll(page, peekPx, 'down', pers);
            await sl(peekPlan.pauseMs || rd(1500, 4000));
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
              await smoothScroll(page, pers ? pers.pickInt(400, 800) : rd(400, 800), 'down', pers);
              await sl(rd(2000, 4000));
              const commentBox = await page.$('#simplebox-placeholder, #placeholder-area');
              if (commentBox) {
                await commentBox.click();
                await sl(rd(1000, 2000));
                await humanType(page, config.commentText);
                await sl(rd(1000, 2000));
                const submitBtn = await page.$('#submit-button button, tp-yt-paper-button#submit-button');
                if (submitBtn) await submitBtn.click();
                this._commentedThisVideo = true;
                this.log('info', '💬 Comment posted at ~85%');
                await trackEngagement(this.profileId, 'comment').catch(() => {});
                await sl(rd(2000, 3000));
              }
              await smoothScroll(page, rd(400, 800), 'up');
            } catch {}
          }

          await sl(Math.min(rd(15000, 30000), remaining));
          continue;
        }

        await sl(Math.min(rd(10000, 25000), remaining));
      }
    } finally {
      playCheckCancelled = true;
      for (const t of playCheckTimers) clearTimeout(t);
      this.adPlaying = false;
    }
  },
};

function mixinProfileAgent(ProfileAgent) {
  Object.assign(ProfileAgent.prototype, videoWatcherPrototype);
}

function peekBehaviorInjectorStatus() {
  const b = bx();
  let ytExports = null;
  try {
    ytExports = require('./YoutubeUi.cjs');
  } catch {
    /* ignore */
  }
  return {
    helperKeys: Object.keys(b),
    expandDescriptionAndRead: typeof b.expandDescriptionAndRead === 'function',
    hoverRelatedVideos: typeof b.hoverRelatedVideos === 'function',
    humanType: typeof b.humanType === 'function',
    smoothScroll: typeof b.smoothScroll === 'function',
    expandSameRefAsYoutubeUiModule: ytExports
      ? b.expandDescriptionAndRead === ytExports.expandDescriptionAndRead
      : null,
    hoverSameRefAsYoutubeUiModule: ytExports
      ? b.hoverRelatedVideos === ytExports.hoverRelatedVideos
      : null,
  };
}

module.exports = {
  setBehaviorHelpers,
  mixinProfileAgent,
  detectYouTubeAd,
  ensureYouTubeAdSkipper,
  attemptSkipYouTubeAd,
  waitForAdsToClear,
  getVideoPlaybackState,
  /** Diagnostics: verify agent.cjs wired expand/hover + deps into VideoWatcher (scripts/tests only). */
  peekBehaviorInjectorStatus,
};
