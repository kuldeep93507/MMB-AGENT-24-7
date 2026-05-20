import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Site, Article, SyncInterval } from '../types';

function generateId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ─── Sitemap Parser ───────────────────────────────────────────────────────────
function parseSitemap(xml: string, siteId: string): Article[] {
  const articles: Article[] = [];

  const cleaned = xml
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/xmlns[^=]*="[^"]*"/g, '')
    .replace(/xmlns[^=]*='[^']*'/g, '')
    .replace(/<(\/?)\w+:/g, '<$1');

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const htmlDoc = parser.parseFromString(cleaned, 'text/html');
    const locs = htmlDoc.querySelectorAll('loc');
    locs.forEach(loc => extractFromLoc(loc.textContent?.trim() || '', '', articles, siteId));
    return articles;
  }

  const urlEntries = doc.querySelectorAll('url');
  urlEntries.forEach(urlEl => {
    const loc = urlEl.querySelector('loc')?.textContent?.trim() || '';
    const lastmod = urlEl.querySelector('lastmod')?.textContent?.trim() || '';
    extractFromLoc(loc, lastmod, articles, siteId);
  });

  if (articles.length === 0) {
    const locs = doc.querySelectorAll('loc');
    locs.forEach(loc => {
      const url = loc.textContent?.trim() || '';
      extractFromLoc(url, '', articles, siteId);
    });
  }

  return articles;
}

function extractFromLoc(loc: string, lastmod: string, articles: Article[], siteId: string) {
  if (!loc) return;
  if (loc.match(/\.(jpg|jpeg|png|gif|webp|svg|css|js|xml|json|pdf|zip|ico|woff|woff2|ttf|eot)(\?.*)?$/i)) return;
  try {
    const parsed = new URL(loc);
    const path = parsed.pathname;
    if (path === '/' || path === '') return;

    const slug = path.split('/').filter(Boolean).pop() || path;
    const title = slug
      .replace(/[-_]/g, ' ')
      .replace(/\.\w+$/, '')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || loc;

    articles.push({
      id: generateId(),
      siteId,
      title,
      url: loc,
      publishedAt: lastmod,
      enabled: true,
    });
  } catch {
    // invalid URL, skip
  }
}

// ─── Sitemap Index Fetcher ────────────────────────────────────────────────────
async function fetchSitemapWithIndex(sitemapUrl: string, siteId: string): Promise<Article[]> {
  const response = await fetch(`/sitemap-fetch?url=${encodeURIComponent(sitemapUrl)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();

  const cleaned = xml
    .replace(/xmlns[^=]*="[^"]*"/g, '')
    .replace(/xmlns[^=]*='[^']*'/g, '')
    .replace(/<(\/?)\w+:/g, '<$1');

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, 'text/xml');
  const childSitemaps = doc.querySelectorAll('sitemap loc');

  if (childSitemaps.length > 0) {
    const childUrls = Array.from(childSitemaps)
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean)
      .slice(0, 5);

    const allArticles: Article[] = [];
    for (const childUrl of childUrls) {
      try {
        const childRes = await fetch(`/sitemap-fetch?url=${encodeURIComponent(childUrl)}`);
        const childXml = await childRes.text();
        const childArticles = parseSitemap(childXml, siteId);
        allArticles.push(...childArticles);
      } catch {
        // skip failed child
      }
    }
    return allArticles;
  }

  return parseSitemap(xml, siteId);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ZUSTAND SITE STORE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ToastEntry {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// Default sites that are always pre-seeded on first load
const DEFAULT_SEED_SITES = [
  {
    url: 'https://hamstercombocard.com',
    sitemapUrl: 'https://hamstercombocard.com/sitemap.xml',
    syncInterval: 'daily' as SyncInterval,
  },
  {
    url: 'https://findplay.xyz',
    sitemapUrl: 'https://findplay.xyz/sitemap.xml',
    syncInterval: 'daily' as SyncInterval,
  },
];

interface SiteStoreState {
  sites: Site[];
  toasts: ToastEntry[];
  seeded: boolean;

  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
  dismissToast: (id: string) => void;
  addSite: (url: string, sitemapUrl: string, syncInterval: SyncInterval) => Promise<Site | undefined>;
  deleteSite: (id: string) => void;
  syncSite: (id: string) => Promise<void>;
  syncAllSites: () => Promise<void>;
  toggleSite: (id: string) => void;
  toggleArticle: (siteId: string, articleId: string) => void;
  enableAllArticles: (siteId: string) => void;
  disableAllArticles: (siteId: string) => void;
  getArticles: (siteId: string) => Article[];
  getEnabledArticles: () => Article[];
  seedDefaultSites: () => Promise<void>;
}

export const useSiteStore = create<SiteStoreState>()(
  persist(
    (set, get) => ({
      sites: [],
      toasts: [],
      seeded: false,

      addToast: (message, type) => {
        const id = generateId();
        set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
        setTimeout(() => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })), 5000);
      },

      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),

      addSite: async (url, sitemapUrl, syncInterval) => {
        const id = generateId();
        const siteName = new URL(url).hostname.replace('www.', '');

        get().addToast(`Fetching sitemap for ${siteName}...`, 'info');

        let articles: Article[] = [];
        try {
          articles = await fetchSitemapWithIndex(sitemapUrl, id);
          if (articles.length === 0) {
            get().addToast(`Sitemap fetched but 0 articles found.`, 'error');
          }
        } catch (err: any) {
          get().addToast(`Failed to fetch sitemap: ${err.message}`, 'error');
        }

        const site: Site = {
          id,
          name: siteName,
          url,
          feedUrl: sitemapUrl,
          feedType: 'sitemap',
          totalArticles: articles.length,
          enabledArticles: articles.length,
          lastSyncAt: Date.now(),
          syncInterval,
          status: 'active',
          articles,
        };

        set((state) => ({ sites: [...state.sites, site] }));
        get().addToast(`Site added: ${siteName} — ${articles.length} articles`, articles.length > 0 ? 'success' : 'info');
        return site;
      },

      deleteSite: (id) => {
        set((state) => ({ sites: state.sites.filter(s => s.id !== id) }));
        get().addToast('Site deleted', 'info');
      },

      syncSite: async (id) => {
        const site = get().sites.find(s => s.id === id);
        if (!site) return;

        get().addToast(`Syncing ${site.name}...`, 'info');
        try {
          const newArticles = await fetchSitemapWithIndex(site.feedUrl, id);

          const existingUrls = new Map(site.articles.map(a => [a.url, a]));
          const merged = [...site.articles];
          let added = 0;
          for (const a of newArticles) {
            if (!existingUrls.has(a.url)) {
              merged.push(a);
              added++;
            }
          }

          set((state) => ({
            sites: state.sites.map(s => s.id === id ? {
              ...s,
              articles: merged,
              totalArticles: merged.length,
              enabledArticles: merged.filter(a => a.enabled).length,
              lastSyncAt: Date.now(),
            } : s)
          }));
          get().addToast(`Synced: ${site.name} — ${merged.length} total (+${added} new)`, 'success');
        } catch (err: any) {
          get().addToast(`Sync failed: ${err.message}`, 'error');
        }
      },

      syncAllSites: async () => {
        const { sites, syncSite } = get();
        for (const site of sites) {
          await syncSite(site.id);
        }
      },

      toggleSite: (id) => set((state) => ({
        sites: state.sites.map(s => s.id === id ? { ...s, status: s.status === 'active' ? 'inactive' as const : 'active' as const } : s)
      })),

      toggleArticle: (siteId, articleId) => set((state) => ({
        sites: state.sites.map(s => {
          if (s.id !== siteId) return s;
          const articles = s.articles.map(a => a.id === articleId ? { ...a, enabled: !a.enabled } : a);
          return { ...s, articles, enabledArticles: articles.filter(a => a.enabled).length };
        })
      })),

      enableAllArticles: (siteId) => set((state) => ({
        sites: state.sites.map(s => {
          if (s.id !== siteId) return s;
          const articles = s.articles.map(a => ({ ...a, enabled: true }));
          return { ...s, articles, enabledArticles: articles.length };
        })
      })),

      disableAllArticles: (siteId) => set((state) => ({
        sites: state.sites.map(s => {
          if (s.id !== siteId) return s;
          const articles = s.articles.map(a => ({ ...a, enabled: false }));
          return { ...s, articles, enabledArticles: 0 };
        })
      })),

      getArticles: (siteId) => {
        return get().sites.find(s => s.id === siteId)?.articles || [];
      },

      getEnabledArticles: () => {
        return get().sites.filter(s => s.status === 'active').flatMap(s => s.articles.filter(a => a.enabled));
      },

      seedDefaultSites: async () => {
        if (get().seeded) return;
        // Mark as seeded immediately so concurrent calls don't double-add
        set({ seeded: true });

        const existing = get().sites;
        for (const seed of DEFAULT_SEED_SITES) {
          const hostname = new URL(seed.url).hostname.replace('www.', '');
          const alreadyAdded = existing.some(
            s => s.url.includes(hostname) || s.name === hostname
          );
          if (alreadyAdded) continue;

          try {
            // Try the primary sitemap URL; on failure try common alternatives
            let articles: Article[] = [];
            const candidates = [
              seed.sitemapUrl,
              seed.url.replace(/\/$/, '') + '/sitemap_index.xml',
              seed.url.replace(/\/$/, '') + '/post-sitemap.xml',
            ];

            for (const candidate of candidates) {
              try {
                articles = await fetchSitemapWithIndex(candidate, 'temp');
                if (articles.length > 0) {
                  // Re-fetch with correct id assigned inside fetchSitemapWithIndex
                  break;
                }
              } catch {
                // try next candidate
              }
            }

            const id = generateId();
            // Re-assign siteId correctly
            articles = articles.map(a => ({ ...a, id: generateId(), siteId: id }));

            const site: Site = {
              id,
              name: hostname,
              url: seed.url,
              feedUrl: seed.sitemapUrl,
              feedType: 'sitemap',
              totalArticles: articles.length,
              enabledArticles: articles.length,
              lastSyncAt: Date.now(),
              syncInterval: seed.syncInterval,
              status: 'active',
              articles,
            };

            set((state) => ({ sites: [...state.sites, site] }));
          } catch {
            // If seeding fails entirely, still mark as seeded (user can add manually)
          }
        }
      },
    }),
    {
      name: 'mmb-sites-sitestore',
      partialize: (state) => ({ sites: state.sites, seeded: state.seeded }),
    }
  )
);
