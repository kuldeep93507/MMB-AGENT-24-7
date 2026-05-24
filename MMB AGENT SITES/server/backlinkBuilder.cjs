'use strict';

/**
 * Backlink Builder — WordPress Comment Backlinks
 *
 * Agent automatically:
 * 1. Searches Google for WordPress blogs in your niche
 * 2. Opens each blog post
 * 3. Finds the comment form
 * 4. Fills name/email/website/comment (AI-generated relevant text)
 * 5. Submits → creates real backlink if approved
 *
 * Per profile: 3-7 blogs per session
 * 10 profiles = 30-70 potential backlinks per run
 */

const { chromium } = require('playwright-core');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ── Realistic human names pool ──
const FIRST_NAMES = ['Michael','James','Robert','David','William','John','Richard','Thomas','Charles','Daniel','Matthew','Anthony','Mark','Donald','Steven','Paul','Andrew','Joshua','Kenneth','Kevin','Brian','George','Timothy','Ronald','Edward','Jason','Jeffrey','Ryan','Jacob','Gary','Nicholas','Eric','Stephen','Jonathan','Larry','Justin','Scott','Brandon','Benjamin','Samuel'];
const LAST_NAMES  = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores'];
const EMAIL_DOMAINS = ['gmail.com','yahoo.com','outlook.com','hotmail.com','protonmail.com','icloud.com'];

function randomName() {
  return `${FIRST_NAMES[rand(0, FIRST_NAMES.length-1)]} ${LAST_NAMES[rand(0, LAST_NAMES.length-1)]}`;
}
function randomEmail(name) {
  const parts = name.toLowerCase().split(' ');
  const sep   = ['.','_',''][rand(0,2)];
  const num   = rand(0,1) ? rand(70,99) : '';
  const domain = EMAIL_DOMAINS[rand(0, EMAIL_DOMAINS.length-1)];
  return `${parts[0]}${sep}${parts[1]}${num}@${domain}`;
}

// ── Niche-specific search queries to find target blogs ──
const NICHE_SEARCHES = [
  'mesothelioma lawsuit blog wordpress',
  'asbestos cancer legal advice blog',
  'mesothelioma compensation blog site:wordpress.com',
  'mesothelioma lawyer tips blog',
  'asbestos exposure symptoms blog',
  'mesothelioma settlement blog',
  'lung cancer asbestos legal blog',
  'mesothelioma attorney advice blog',
  'personal injury law blog mesothelioma',
  'mesothelioma trust fund claims blog',
  'cancer lawsuit compensation blog',
  'asbestos workers compensation blog',
];

// ── AI comment generator (uses Claude if API key set, else template) ──
async function generateComment(articleTitle, articleExcerpt, targetSiteUrl) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  if (apiKey) {
    const https = require('https');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: `You are a person who just read a blog post and want to leave a helpful, genuine comment. Write a natural, relevant comment (2-3 sentences). Do NOT mention any other website. Sound like a real reader, not a bot. No promotional language.`,
      messages: [{ role: 'user', content: `Article title: "${articleTitle}"\nFirst lines: "${(articleExcerpt||'').slice(0,200)}"\n\nWrite a genuine reader comment:` }],
    });
    const result = await new Promise(resolve => {
      const req = https.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body) },
        timeout: 8000,
      }, res => {
        let d = ''; res.on('data',c=>d+=c);
        res.on('end', () => { try { resolve(JSON.parse(d).content?.[0]?.text?.trim()||null); } catch { resolve(null); } });
      });
      req.on('error', ()=>resolve(null)); req.on('timeout', ()=>{ req.destroy(); resolve(null); });
      req.write(body); req.end();
    });
    if (result) return result;
  }

  // Fallback templates — relevant to mesothelioma/legal niche
  const TEMPLATES = [
    `Really informative post. I've been researching this topic for a while and your breakdown is one of the clearest I've found. Thank you for taking the time to write this.`,
    `This is exactly the kind of information people need when dealing with these situations. Very well written and easy to understand for non-lawyers.`,
    `Great article. The points about compensation and legal timelines are particularly helpful. Many people don't realize how important it is to act quickly in these cases.`,
    `Thank you for sharing this. A family member is going through something similar and this post helped clarify a lot of confusing legal points. Very appreciated.`,
    `Excellent breakdown of a complex topic. I shared this with my friend who is looking into their options. Clear and factual — exactly what people need.`,
    `Very useful read. The section about filing timelines was something I wasn't aware of. This kind of awareness is so important for affected families.`,
  ];
  return TEMPLATES[rand(0, TEMPLATES.length-1)];
}

// ── Check if a page has a submittable WordPress comment form ──
async function hasCommentForm(page) {
  return await page.evaluate(() => {
    const form = document.querySelector('#commentform, form.comment-form, form[action*="comment"]');
    if (!form) return false;
    const hasName    = !!form.querySelector('input[name="author"], input[id="author"], input[name="name"]');
    const hasComment = !!form.querySelector('textarea[name="comment"], textarea[id="comment"]');
    return hasName && hasComment;
  }).catch(() => false);
}

// ── Submit a comment on the current page ──
async function submitComment(page, name, email, websiteUrl, commentText) {
  return await page.evaluate(({ name, email, website, comment }) => {
    try {
      const form = document.querySelector('#commentform, form.comment-form, form[action*="comment"]');
      if (!form) return { ok: false, reason: 'no form' };

      // Fill author/name
      const nameField = form.querySelector('input[name="author"], input[id="author"], input[name="name"]');
      if (nameField) { nameField.value = name; nameField.dispatchEvent(new Event('input', { bubbles: true })); }

      // Fill email
      const emailField = form.querySelector('input[name="email"], input[id="email"], input[type="email"]');
      if (emailField) { emailField.value = email; emailField.dispatchEvent(new Event('input', { bubbles: true })); }

      // Fill website/url — this becomes the actual backlink
      const urlField = form.querySelector('input[name="url"], input[id="url"], input[name="website"]');
      if (urlField) { urlField.value = website; urlField.dispatchEvent(new Event('input', { bubbles: true })); }

      // Fill comment text
      const commentField = form.querySelector('textarea[name="comment"], textarea[id="comment"]');
      if (commentField) { commentField.value = comment; commentField.dispatchEvent(new Event('input', { bubbles: true })); }

      // Check for honeypot fields (anti-spam) — don't fill them
      const allInputs = Array.from(form.querySelectorAll('input[type="text"], input[type="email"]'));
      const honeypots = allInputs.filter(el => {
        const style = window.getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden' || el.tabIndex === -1;
      });
      honeypots.forEach(hp => { hp.value = ''; }); // ensure honeypots are empty

      return { ok: true, hasUrl: !!urlField, hasEmail: !!emailField };
    } catch (e) { return { ok: false, reason: e.message }; }
  }, { name, email, website: websiteUrl, comment: commentText }).catch(() => ({ ok: false, reason: 'evaluate error' }));
}

// ── Human-like typing into a field ──
async function humanFill(page, selector, text) {
  try {
    const el = await page.$(selector).catch(() => null);
    if (!el) return;
    await el.click().catch(() => {});
    await sleep(rand(200, 500));
    await el.fill('').catch(() => {});
    await sleep(rand(100, 300));
    // Type character by character
    for (const char of text) {
      await page.keyboard.type(char, { delay: rand(60, 160) });
      if (Math.random() < 0.04) await sleep(rand(200, 600)); // occasional pause
    }
    await sleep(rand(300, 700));
  } catch {}
}

// ── Main: run backlink builder for one profile ──
async function runBacklinkBuilder(profileId, debugPort, targetSiteUrl, options = {}) {
  const maxBlogs      = options.maxBlogs      || 5;
  const submitEnabled = options.submitEnabled !== false; // default: submit
  const results = [];

  let browser, context;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 30000 });
    context = browser.contexts()[0] || await browser.newContext();
  } catch (e) {
    return { ok: false, error: `CDP connect failed: ${e.message}`, results: [] };
  }

  const name    = randomName();
  const email   = randomEmail(name);
  const website = targetSiteUrl.startsWith('http') ? targetSiteUrl : `https://${targetSiteUrl}`;

  console.log(`[BacklinkBuilder] Profile ${profileId.slice(-4)} | Name: ${name} | Site: ${website}`);

  // Pick a random search query
  const query = NICHE_SEARCHES[rand(0, NICHE_SEARCHES.length-1)];
  let blogUrls = [];

  // ── Step 1: Search Google for blog posts ──
  const searchPage = await context.newPage().catch(() => null);
  if (searchPage) {
    try {
      await searchPage.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await sleep(rand(2000, 4000));
      await searchPage.mouse.wheel(0, rand(150, 400)).catch(() => {});
      await sleep(rand(1000, 2500));

      // Extract result URLs — filter to likely WordPress blogs
      blogUrls = await searchPage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        return links
          .map(a => a.href)
          .filter(h => h.startsWith('http') && !h.includes('google.com') && !h.includes('youtube.com') && !h.includes('amazon.com') && !h.includes('facebook.com') && !h.includes('twitter.com') && !h.includes('linkedin.com') && h.includes('.'))
          .slice(0, 15);
      }).catch(() => []);

      await searchPage.close().catch(() => {});
    } catch { await searchPage.close().catch(() => {}); }
  }

  if (blogUrls.length === 0) {
    browser.close().catch(() => {});
    return { ok: false, error: 'No blog URLs found in search', results: [] };
  }

  // ── Step 2: Visit each blog and submit comment ──
  let submitted = 0;
  for (const blogUrl of blogUrls.slice(0, maxBlogs + 3)) {
    if (submitted >= maxBlogs) break;

    const page = await context.newPage().catch(() => null);
    if (!page) continue;

    try {
      await page.goto(blogUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await sleep(rand(2000, 4000));

      // Check if has comment form
      const hasCF = await hasCommentForm(page);
      if (!hasCF) {
        results.push({ url: blogUrl, status: 'no_comment_form' });
        await page.close().catch(() => {});
        continue;
      }

      // Scroll down to comment section (human behavior)
      await page.evaluate(() => {
        const el = document.querySelector('#comments, .comments-area, #respond, #comment-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else window.scrollBy(0, window.innerHeight * 2);
      }).catch(() => {});
      await sleep(rand(1500, 3500));

      // Get page title and excerpt for comment generation
      const pageInfo = await page.evaluate(() => ({
        title: document.title || document.querySelector('h1')?.textContent || '',
        excerpt: document.querySelector('article p, .entry-content p, p')?.textContent || '',
      })).catch(() => ({ title: '', excerpt: '' }));

      // Generate relevant comment
      const commentText = await generateComment(pageInfo.title, pageInfo.excerpt, targetSiteUrl);

      if (submitEnabled) {
        // Human-like: fill form field by field
        await humanFill(page, 'input[name="author"], input[id="author"]', name);
        await humanFill(page, 'input[name="email"], input[id="email"]', email);
        await humanFill(page, 'input[name="url"], input[id="url"]', website);

        // Comment textarea — type it out
        const commentSel = 'textarea[name="comment"], textarea[id="comment"]';
        const ta = await page.$(commentSel).catch(() => null);
        if (ta) {
          await ta.click().catch(() => {});
          await sleep(rand(300, 700));
          for (const char of commentText) {
            await page.keyboard.type(char, { delay: rand(50, 130) });
            if (Math.random() < 0.03) await sleep(rand(200, 500));
          }
          await sleep(rand(800, 2000));
        }

        // Random pause before submit (human reads it over)
        await sleep(rand(1500, 4000));
        await page.mouse.wheel(0, rand(-100, -50)).catch(() => {}); // scroll up slightly to check
        await sleep(rand(800, 1500));
        await page.mouse.wheel(0, rand(80, 150)).catch(() => {}); // scroll back down

        // Submit
        const submitBtn = await page.$('input[type="submit"][name="submit"], button[type="submit"], #submit').catch(() => null);
        if (submitBtn) {
          await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
          await sleep(rand(500, 1200));
          await submitBtn.click().catch(() => {});
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await sleep(rand(2000, 4000));

          // Check if submission succeeded (no error message)
          const errorMsg = await page.$('.comment-error, .error, [class*="error"]').catch(() => null);
          const successMsg = await page.$('.comment-awaiting, .comment-approved, [class*="success"]').catch(() => null);
          const status = errorMsg ? 'error' : successMsg ? 'approved' : 'submitted';

          results.push({ url: blogUrl, status, name, commentPreview: commentText.slice(0, 80) });
          submitted++;
          console.log(`[BacklinkBuilder] ${profileId.slice(-4)} → ${status}: ${blogUrl.slice(0,60)}`);
        } else {
          results.push({ url: blogUrl, status: 'no_submit_btn' });
        }
      } else {
        // Dry run — just report
        results.push({ url: blogUrl, status: 'dry_run_ok', name, commentPreview: commentText.slice(0, 80) });
        submitted++;
      }

    } catch (e) {
      results.push({ url: blogUrl, status: 'error', error: e.message });
    } finally {
      await page.close().catch(() => {});
    }

    // Gap between blogs (human behavior)
    if (submitted < maxBlogs) await sleep(rand(5000, 12000));
  }

  try { browser.close().catch(() => {}); } catch {}

  const successCount = results.filter(r => ['submitted','approved','dry_run_ok'].includes(r.status)).length;
  console.log(`[BacklinkBuilder] Profile ${profileId.slice(-4)} done: ${successCount}/${results.length} submitted`);
  return { ok: true, submitted: successCount, results };
}

module.exports = { runBacklinkBuilder };
