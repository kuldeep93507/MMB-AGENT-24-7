# MMB AGENT — Sites Tool Plan
## Website/Blog Traffic Automation Tool
### Co-Founder: Kuldeep Parhapati

---

## 📋 Overview

| YouTube Tool | Sites Tool |
|-------------|-----------|
| Channels | Websites/Sites |
| Videos | Articles/Pages |
| YouTube InnerTube | RSS Feed / Sitemap XML |
| Video Watch | Article Read (scroll + dwell) |
| Like/Subscribe | Comment (optional) |
| Watch Time | Read Time (dwell time) |
| Search on YouTube | Search on Google / Direct URL |

**Goal:** Apni blog sites pe organic-looking traffic generate karna — SEO improve, AdSense revenue badhana, real user jaise behavior.

---

## 🏗️ Architecture (Same as YouTube Tool)

```
Frontend (React + TypeScript + Tailwind + Vite)
    ↓
Vite Proxy (RSS fetch, Backend API)
    ↓
Backend (Node.js + Express + Worker Threads)
    ↓
Orchestrator → Worker Pool (1 per profile)
    ↓
Each Worker → Playwright CDP → MoreLogin Browser
    ↓
Open Site → Read Article → Scroll → Dwell → Next
```

---

## 📄 Pages (13 Pages)

| # | Page | Description |
|---|------|-------------|
| 1 | Dashboard | Stats — total reads, dwell time, sessions, per-profile |
| 2 | Profiles | MoreLogin profiles (same as YouTube tool — shared) |
| 3 | Sites | Add websites — fetch articles via RSS/Sitemap |
| 4 | Article Shuffle | Auto-assign articles to profiles (no overlap, history) |
| 5 | Backlinks | External referral traffic (social media → site) |
| 6 | Scheduler | Timer + manual run — per-profile agents |
| 7 | Manual Control | Batch scroll/navigate on selected profiles |
| 8 | Analytics | Live reads, dwell time, per-site, per-profile |
| 9 | Comment Templates | Pre-saved comments for blog posts |
| 10 | Profile Settings | Per-profile: read speed, traffic type, dwell time |
| 11 | Activity Logs | All actions logged |
| 12 | Settings | MoreLogin API, Git Push, configs |
| 13 | Rate Limits | Daily caps per profile |

---

## 🌐 Sites Page — How It Works

### Add Site:
```
Input: Site URL (e.g., https://myblog.com)
    ↓
Auto-detect: RSS feed URL (myblog.com/feed, myblog.com/rss.xml)
    OR
Manual: Sitemap URL (myblog.com/sitemap.xml)
    ↓
Fetch all articles: title, URL, date, category
    ↓
Display in UI — enable/disable per article
```

### Site Card Shows:
- Site name + favicon
- Total articles
- Enabled articles
- Last sync time
- Auto-sync interval (1hr/6hr/12hr/daily)
- Status (active/inactive)

---

## 📖 Article Read — Human Behavior (DEEPLY THOUGHT)

### How Real Human Reads a Blog:

```
Step 1: Page loads → wait 1-2 sec (page render)
Step 2: Read title area (2-3 sec — eyes on top)
Step 3: Start scrolling DOWN — SLOWLY
        - Butter smooth scroll (no jumps)
        - Curve style (speed varies — fast in middle, slow at start/end)
        - Each profile scrolls DIFFERENTLY
Step 4: When AD appears in viewport → PAUSE 1-1.5 sec
        - Don't click ad — just pause (natural eye catch)
        - Resume scrolling after pause
Step 5: Continue scrolling — random speed variations
        - Sometimes fast (skimming)
        - Sometimes slow (reading paragraph)
        - Sometimes stop 2-3 sec (reading carefully)
Step 6: Reach bottom → maybe scroll up slightly (re-read something)
Step 7: Dwell time complete → close tab or navigate away

NEVER DO:
❌ Click any ad (invalid click = AdSense ban)
❌ Straight line scroll (bot pattern)
❌ Same speed throughout (unnatural)
❌ Same pattern on all profiles
❌ Jump scroll (teleport to bottom)
```

### Scroll Behavior — Technical:

```javascript
// Butter smooth scroll — curve style
// Speed varies like sine wave: slow → fast → slow → fast → slow

Phase 1 (0-10%): Very slow — reading title + intro
Phase 2 (10-30%): Medium speed — skimming first paragraphs
Phase 3 (30-50%): Faster — scanning content
Phase 4 (50-70%): Medium — reading middle content
Phase 5 (70-85%): Slow — reading conclusion
Phase 6 (85-100%): Very slow — bottom area, maybe comments

AD DETECTION:
- Detect ad iframes/divs in viewport
- When ad enters viewport → pause scroll 1-1.5 sec
- Resume after pause (natural ad impression)
- NEVER click

UNIQUE PER PROFILE:
- Scroll speed: random multiplier (0.7x to 1.5x)
- Pause duration: random (0.5s to 3s)
- Scroll curve: different sine wave frequency
- Total read time: random within min-max
```

---

## 🔀 Article Shuffle — Same Logic as Video Shuffle

### Rules:
1. Same profile ko already-read article dobara nahi (24h history)
2. Ek run me same article 2 profiles ko nahi (overlap protection)
3. Profile recreate → history reset
4. Pool exhausted → repeat oldest with notice
5. Per-channel (site) min/max articles configurable

### UI:
- Site settings (min 2, max 5 articles per profile per site)
- "Shuffle All" button
- "Shuffle Selected" button
- Profile grid with assigned articles
- Run button (single profile / selected / all)
- Watch progress (% articles read from pool)

---

## 🔍 Traffic Sources (How to Reach the Article)

| Source | How |
|--------|-----|
| Google Search | Google.com → search article title → click result |
| Direct URL | Type site URL directly in address bar |
| Backlink | External site (social media) → find link → click |
| Internal Link | Go to site homepage → click article from there |
| Random | Randomly pick from above |

### Google Search Flow:
```
1. Open google.com
2. Human-like type: "article title site:myblog.com"
3. Wait for results (3-5 sec)
4. Browse results (scroll down, scroll up — 5-7 sec)
5. Find our article in results
6. Click → article opens
7. Read (scroll behavior as described above)
```

### Internal Link Flow:
```
1. Open myblog.com (homepage)
2. Scroll down — browse articles (5-10 sec)
3. Find target article
4. Click → article opens
5. Read
```

---

## ⚙️ Profile Settings (Per Profile)

| Setting | Options |
|---------|---------|
| Read Time (min-max) | 30sec — 5min (random between) |
| Scroll Speed | Slow / Medium / Fast (multiplier) |
| Traffic Preference | Google / Direct / Internal / Backlink / Random |
| Comment Enabled | ON/OFF + daily cap |
| Ad Pause Duration | 0.5s — 2s (how long to pause on ads) |
| Start Delay | 5-30 sec (random before starting) |
| Session Limit | Max articles per session (e.g., 5-10) |

---

## 🤖 Agent Worker Thread — Steps

```
Step 1: Profile start → MoreLogin API → debugPort
Step 2: Playwright CDP connect
Step 3: Get assigned articles from queue
Step 4: Traffic type decide (Google/Direct/Internal/Backlink)
Step 5: Navigate to article
Step 6: Read article (scroll behavior — butter smooth, curve, ad pause)
Step 7: Dwell time complete
Step 8: Save to history (article_url, dwell_time, traffic_type)
Step 9: Next article → delay between articles
Step 10: Session done → disconnect

Auto-recovery:
- Page load fail → retry 3x
- Timeout → skip article
- Worker crash → restart (max 3)
```

---

## 📊 Analytics (Live)

| Metric | Description |
|--------|-------------|
| Total Reads | Articles actually opened + scrolled |
| Total Dwell Time | Minutes spent on articles |
| Sessions | How many times profiles ran |
| Per-Site Stats | Which site got how many reads |
| Per-Profile Stats | Which profile read how many |
| Ad Impressions | How many times ad was in viewport (paused) |
| Traffic Sources | % Google / Direct / Internal / Backlink |

---

## 🔗 Backlink Traffic (Same as YouTube)

- Add external URLs (LinkedIn posts, Quora answers, Reddit, Twitter)
- Profile opens external page → finds blog link → clicks → reads article
- YouTube Analytics equivalent: "Referral traffic" in Google Analytics

---

## 📅 Scheduler

- Manual run (click button)
- Scheduled (date/time + repeat: 1hr/3hr/6hr/12hr/daily)
- Per-profile delay (staggered start)
- Article delay (gap between articles)

---

## 🛡️ Important Rules (AdSense Safe)

```
❌ NEVER click any ad — instant AdSense ban
❌ NEVER same IP on same article repeatedly
❌ NEVER same scroll pattern
❌ NEVER too fast read (< 10 sec = bounce)
❌ NEVER too many reads from same source

✅ Unique proxy per profile (Smartproxy)
✅ Random dwell time (30s - 5min)
✅ Different scroll speed per profile
✅ Mix traffic sources (Google + Direct + Backlink)
✅ Natural ad impression (pause, don't click)
✅ Session limits (max 5-10 articles per session)
✅ Cooldown between sessions (4-6 hours)
```

---

## 🗂️ Data Flow

```
Sites Page:
  Add site URL → fetch RSS/Sitemap → articles list → enable/disable

Article Shuffle:
  Select profiles → set min/max per site → Shuffle → assign unique articles

Run:
  Scheduler/Manual → Backend → Worker Threads → Playwright CDP
  → Open article → Scroll (butter smooth) → Pause on ads → Dwell → Next

History:
  Track per-profile: which articles read, when, how long
  24h window — auto-clear old history
  Pool exhausted → repeat oldest
```

---

## 📱 Tech Stack (Same as YouTube Tool)

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Tailwind + Vite |
| Backend | Node.js + Express + Worker Threads |
| Automation | Playwright CDP |
| Browser | MoreLogin Anti-detect |
| Proxy | Smartproxy Residential |
| Data | localStorage + in-memory |
| Articles | RSS Feed / Sitemap XML |

---

## 🚀 Development Order

| Phase | What to Build |
|-------|--------------|
| 1 | Project setup + Sites page (RSS fetch) |
| 2 | Article Shuffle + History |
| 3 | Backend Agent (scroll behavior — butter smooth) |
| 4 | Scheduler + Manual Control |
| 5 | Analytics + Profile Settings |
| 6 | Backlinks + Traffic Router |
| 7 | Comments + Rate Limits |
| 8 | Testing + Polish |

---

## ⭐ MMB AGENT SITES — Co-Founder & Made by Kuldeep Parjapati ⭐
