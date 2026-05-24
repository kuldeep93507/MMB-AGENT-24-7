/**
 * Human-like Playwright gestures: typing, mouse, wheel scroll, keyboard seek on watch pages.
 */

'use strict';

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seek forward via YouTube-ish keyboard shortcuts (+10s `l`, +5s ArrowRight). */
async function seekForwardKeyboard(page, secondsTotal, personality) {
  let remaining = Math.max(0, Math.floor(Number(secondsTotal) || 0));
  const jitter = () => (personality?.pickInt(90, 340) ?? randomDelay(90, 340));
  while (remaining >= 10) {
    await page.keyboard.press('l');
    remaining -= 10;
    await sleep(jitter());
  }
  while (remaining >= 5) {
    await page.keyboard.press('ArrowRight');
    remaining -= 5;
    await sleep(jitter());
  }
}

async function humanType(page, text, profileSpeed) {
  const baseMin = profileSpeed?.min || randomDelay(40, 120);
  const baseMax = profileSpeed?.max || randomDelay(150, 300);
  const pauseChance = profileSpeed?.pauseChance || (0.05 + Math.random() * 0.1);

  for (const char of text) {
    const charDelay = randomDelay(baseMin, baseMax) + randomDelay(-15, 15);
    await page.keyboard.type(char, { delay: Math.max(30, charDelay) });

    if (Math.random() < pauseChance) await sleep(randomDelay(150, 800));

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

module.exports = {
  seekForwardKeyboard,
  humanType,
  humanMouseMove,
  smoothScroll,
};
