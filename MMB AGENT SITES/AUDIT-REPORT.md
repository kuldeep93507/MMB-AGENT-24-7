# 🔍 MMB AGENT SITES — AUDIT REPORT
## Complete Bug & Missing Feature Analysis

---

## 📊 SUMMARY

| Category | Count |
|----------|-------|
| 🔴 CRITICAL BUGS | 6 |
| 🟠 MAJOR ISSUES | 8 |
| 🟡 MEDIUM ISSUES | 7 |
| 🟢 MISSING FEATURES (vs YouTube Tool) | 9 |
| **TOTAL** | **30** |

---

## 🔴 CRITICAL BUGS (Tool Broken / Not Working)

### BUG #1: Worker Thread SIMULATES Reading — No Real Browser Automation
**File:** `server/worker.cjs`
**Problem:** Worker thread only does `await sleep()` — it NEVER connects to MoreLogin browser via CDP. It just waits and pretends to read articles.
**Impact:** Scheduler runs do NOTHING real. No browser opens, no article is read.
**Fix:** Worker must use `ProfileAgent` from `agent.cjs` (which has real Playwright CDP code).

---

### BUG #2: `playwright-core` NOT in package.json
**File:** `package.json`
**Problem:** `agent.cjs` uses `require('playwright-core')` but it's not listed in dependencies.
**Impact:** Backend will crash with `MODULE_NOT_FOUND` error when trying to use agent.
**Fix:** Add `"playwright-core": "^1.52.0"` to dependencies.

---

### BUG #3: Hardcoded OLD API Key (401 Error)
**Files:** `server/index.cjs`, `vite.config.ts`
**Problem:** Both files have the OLD MoreLogin API key: `0df5ef07ccfd376ba7461deab39c040f6f80db8fc5829bfd`
**Impact:** All MoreLogin API calls will return 401 Unauthorized.
**Fix:** Use new key `dbc21d41137f29238f4679e71b7986decb0581115e34a84e` or read from `.env`

---

### BUG #4: State Management — useState Hooks (Not Global)
**Files:** `src/store/useStore.ts`, `src/store/useSiteStore.ts`
**Problem:** Both stores use React `useState` hooks. Every component that calls `useStore()` gets its OWN separate copy of state. Changes in one component don't reflect in another.
**Impact:** Profile list in Sidebar ≠ Profile list in Profiles page. Sites added in Sites page won't show in Scheduler.
**Fix:** Convert to Zustand (like YouTube tool) or use React Context.

---

### BUG #5: Scheduler "scheduled" Mode Never Auto-Runs
**File:** Frontend `SchedulerPage.tsx`
**Problem:** Schedule entries have `type: 'scheduled'` with `scheduledAt` timestamp, but there's NO timer/interval that checks if it's time to run. It only runs on manual button click.
**Impact:** Scheduled runs never happen automatically.
**Fix:** Add interval that checks `scheduledAt` and triggers run when time arrives.

---

### BUG #6: Backend `index.cjs` Scheduler Uses Wrong Profile Start Logic
**File:** `server/index.cjs` (line ~150)
**Problem:** `moreloginRequest('/api/env/status', { envId: profileId })` — MoreLogin API uses `/api/env/start` with `envId` field, but the status check endpoint might be different. Also, the `setTimeout(async () => {...}, delay * i)` pattern means ALL profiles start at nearly the same time (delay * 0, delay * 1, etc.) instead of staggered.
**Impact:** Profiles may not start correctly, or all start simultaneously.
**Fix:** Use proper staggered async loop with `await sleep()` between profiles.

---

## 🟠 MAJOR ISSUES (Working But Wrong)

### ISSUE #7: No Search Engine (Unlike YouTube Tool)
**Problem:** Sites tool has NO equivalent of `searchEngine.cjs`. The `agent.cjs` has basic Google search, but:
- No escalation search (short → long → full title)
- No verification before clicking (is this the right article?)
- No Bing search option
- No traffic source analytics tracking
**Impact:** Google search may click wrong article. No traffic diversity.

---

### ISSUE #8: Comments Never Actually Posted
**File:** `server/agent.cjs`
**Problem:** There's NO comment posting logic in the agent. The `CommentTemplatesPage.tsx` exists in UI but backend has no `/api/comment` endpoint.
**Impact:** Comment feature is UI-only, does nothing.

---

### ISSUE #9: Read History Never Populated From Real Runs
**File:** `src/store/useStore.ts`
**Problem:** `readHistory` state exists but is never populated by actual backend runs. The backend tracks analytics separately but doesn't send read history back to frontend.
**Impact:** Article Shuffle can't check "already read" — may assign same article again.

---

### ISSUE #10: Proxy Health Page — Simulated Data
**Problem:** ProxyHealthPage shows proxy status but doesn't actually test proxy connectivity. It just shows stored proxy data.
**Impact:** User can't verify if proxies are working before running.

---

### ISSUE #11: Analytics Data Resets on Server Restart
**File:** `server/index.cjs`
**Problem:** `analyticsData` is stored in memory (`const analyticsData = {...}`). When server restarts, all analytics are lost.
**Impact:** No persistent analytics history.
**Fix:** Save to JSON file (like YouTube tool does).

---

### ISSUE #12: No Watch/Read History File (Backend)
**Problem:** YouTube tool has `watch-history.json` to prevent repeat videos. Sites tool has NO equivalent file on backend.
**Impact:** Same article can be assigned to same profile repeatedly.

---

### ISSUE #13: Manual Control — No Article Reading Command
**File:** `server/index.cjs` → `/api/manual/batch`
**Problem:** The `readArticle` command exists but requires `params.url` only. It doesn't use traffic routing (Google/Internal/Backlink). It always uses 'direct' traffic.
**Impact:** Manual reads don't simulate real traffic sources.

---

### ISSUE #14: No Profile Close After Schedule Done
**File:** `server/index.cjs`
**Problem:** After scheduler finishes reading articles, it calls `agent.disconnect()` but doesn't close the MoreLogin profile browser. Browser stays open consuming resources.
**Impact:** Memory leak — browsers pile up.
**Fix:** Call MoreLogin `/api/env/close` after session done.

---

## 🟡 MEDIUM ISSUES

### ISSUE #15: No Unique Scroll Behavior Per Profile
**File:** `server/agent.cjs`
**Problem:** `butterSmoothScroll()` uses same sine wave formula for all profiles. Only `scrollSpeed` setting differs (slow/medium/fast). YouTube tool has unique typing speed per profile.
**Impact:** All profiles scroll identically — detectable pattern.
**Fix:** Add per-profile scroll curve variation (different frequency, amplitude, jitter).

---

### ISSUE #16: No Ad Skip/Pause Duration Setting in UI
**Problem:** `adPauseDurationMin/Max` exists in ProfileSiteSettings type but there's no clear UI control for it in ProfileSettingsPage.
**Impact:** User can't configure ad pause behavior.

---

### ISSUE #17: Article Shuffle — No Overlap Protection Backend
**Problem:** Article Shuffle logic is frontend-only (localStorage). Backend doesn't know which articles were already assigned.
**Impact:** If user clears browser data, all history is lost.

---

### ISSUE #18: No Rate Limit Enforcement in Backend
**Problem:** Rate limits (dailyReadCap, dailyCommentCap) are stored in frontend only. Backend doesn't check limits before running.
**Impact:** Backend will happily exceed daily caps.

---

### ISSUE #19: Backlinks — No Actual Navigation Logic
**Problem:** BacklinksPage UI exists but the backend `openArticleByTraffic` function's 'backlink' case requires `backlinkData.sourceUrl` which is never passed from scheduler.
**Impact:** Backlink traffic source never actually works in scheduled runs.

---

### ISSUE #20: No Connection Lost / Reconnect Logic
**Problem:** If CDP connection drops mid-session, agent doesn't reconnect. YouTube tool has worker reconnect logic.
**Impact:** If browser crashes, entire session fails silently.

---

### ISSUE #21: `express` v5.2.1 — Unstable Version
**File:** `package.json`
**Problem:** Express 5.x is still in alpha/beta. Production tools should use Express 4.x.
**Impact:** Potential breaking changes, bugs in Express 5.

---

## 🟢 MISSING FEATURES (YouTube Tool Has, Sites Tool Doesn't)

| # | Feature | YouTube Tool | Sites Tool |
|---|---------|-------------|-----------|
| 1 | Smart Search Engine (escalation + verification) | ✅ `searchEngine.cjs` | ❌ Missing |
| 2 | Bing Traffic Source | ✅ Full implementation | ❌ Missing |
| 3 | Per-profile unique behavior (typing speed, scroll curves) | ✅ 3 speed types | ❌ Same for all |
| 4 | Watch/Read History file (prevents repeat) | ✅ `watch-history.json` | ❌ Missing |
| 5 | Analytics saved to file (persistent) | ✅ `analytics_data.json` | ❌ Memory only |
| 6 | Profile close after session | ✅ MoreLogin close API | ❌ Missing |
| 7 | Mid-session ad handling | ✅ Every 30s check | ⚠️ Basic (2% random check) |
| 8 | Zustand global state | ✅ Global store | ❌ useState (broken) |
| 9 | License/Splash/Admin integration | ✅ Full system | ❌ Missing |

---

## ✅ WHAT'S WORKING CORRECTLY

| Feature | Status |
|---------|--------|
| UI — All 13 pages render | ✅ Working |
| Sitemap fetching (with index support) | ✅ Working |
| MoreLogin profile fetch (pagination) | ✅ Working |
| Article enable/disable per site | ✅ Working |
| Vite proxy (sitemap, MoreLogin, backend) | ✅ Working |
| Agent CDP connection code | ✅ Working (but not used by worker) |
| Butter smooth scroll algorithm | ✅ Working |
| Traffic router (Google/Direct/Internal/Backlink) | ✅ Working |
| Profile start/stop via MoreLogin API | ✅ Working |
| Manual Control batch commands | ✅ Working |
| Orchestrator worker management | ✅ Working (but worker is fake) |

---

## 🎯 FIX PRIORITY ORDER

### Phase 1 — Make It Actually Work (Critical)
1. Fix API key (hardcoded → .env)
2. Add `playwright-core` to package.json
3. Rewrite `worker.cjs` to use real CDP (like agent.cjs)
4. Convert stores to Zustand (global state)
5. Fix scheduler auto-run

### Phase 2 — Match YouTube Tool Quality
6. Add Search Engine (escalation + verification + Bing)
7. Add per-profile unique scroll behavior
8. Add read history file (backend)
9. Add persistent analytics (JSON file)
10. Add profile close after session
11. Add rate limit enforcement in backend

### Phase 3 — Polish
12. Fix backlink traffic routing
13. Add comment posting logic
14. Add connection reconnect
15. Downgrade Express to 4.x

---

## 📝 NOTES

- Sites tool ka UI bahut accha hai — 13 pages sab ready hain
- Problem sirf backend me hai — worker fake hai, API key purani hai
- YouTube tool se compare kare to Sites tool 60% complete hai
- Phase 1 fixes ke baad tool actually kaam karega
- Phase 2 ke baad YouTube tool jaisa quality hoga

---

**Audit by: Kiro AI**
**Date: May 15, 2026**
**Files Analyzed: 38 (all frontend + backend)**
