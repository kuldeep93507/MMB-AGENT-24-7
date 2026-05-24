'use strict';
const { chromium } = require('playwright-core');

async function test() {
  const port = 46653;
  console.log(`Connecting to CDP at http://127.0.0.1:${port}...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
    console.log('Connected! Browser version:', browser.version());

    const contexts = browser.contexts();
    console.log('Contexts:', contexts.length);

    const ctx = contexts[0] || await browser.newContext();
    console.log('Context OK');

    const page = await ctx.newPage();
    console.log('New page opened');

    console.log('Navigating to hamstercombocard.com...');
    await page.goto('https://hamstercombocard.com/veterans-mesothelioma-lawyer-asbestos-attorneys/', {
      timeout: 30000,
      waitUntil: 'domcontentloaded'
    });
    console.log('Page loaded! Title:', await page.title());

    await new Promise(r => setTimeout(r, 5000));
    await page.close();
    console.log('SUCCESS - CDP + navigation works!');
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

test().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
