import { useState } from 'react';
import { Globe, Plus, RefreshCw, Trash2, ExternalLink, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Check, X, AlertCircle, FileText, Search } from 'lucide-react';
import type { Site, SyncInterval } from '../types';

interface SitesPageProps {
  sites: Site[];
  addSite: (url: string, sitemapUrl: string, syncInterval: SyncInterval) => Promise<Site | undefined>;
  deleteSite: (id: string) => void;
  syncSite: (id: string) => Promise<void>;
  syncAllSites: () => Promise<void>;
  toggleSite: (id: string) => void;
  toggleArticle: (siteId: string, articleId: string) => void;
  enableAllArticles: (siteId: string) => void;
  disableAllArticles: (siteId: string) => void;
}

function fmtDate(ts: number | string | null | undefined): string {
  if (!ts) return 'Never';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function SitesPage({ sites, addSite, deleteSite, syncSite, syncAllSites, toggleSite, toggleArticle, enableAllArticles, disableAllArticles }: SitesPageProps) {
  const [showAddModal, setShowAddModal]     = useState(false);
  const [expandedSite, setExpandedSite]     = useState<string | null>(null);
  const [syncing, setSyncing]               = useState<string | null>(null);
  const [articleSearch, setArticleSearch]   = useState<Record<string, string>>({});
  const [siteSearch, setSiteSearch]         = useState('');
  const [confirmDelete, setConfirmDelete]   = useState<string | null>(null);
  const [toast, setToast]                   = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  };

  const handleSync = async (id: string) => {
    setSyncing(id);
    await syncSite(id);
    setSyncing(null);
    showToast('Sync complete');
  };

  const handleSyncAll = async () => {
    setSyncing('all');
    await syncAllSites();
    setSyncing(null);
    showToast(`All ${sites.length} sites synced`);
  };

  const handleDelete = (id: string) => {
    deleteSite(id);
    setConfirmDelete(null);
    showToast('Site deleted');
  };

  const totalArticles   = sites.reduce((s, site) => s + site.totalArticles, 0);
  const enabledArticles = sites.reduce((s, site) => s + site.enabledArticles, 0);

  const filteredSites = siteSearch
    ? sites.filter(s => s.name.toLowerCase().includes(siteSearch.toLowerCase()) || s.url?.toLowerCase().includes(siteSearch.toLowerCase()))
    : sites;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-xl border
          ${toast.ok ? 'bg-green-900/90 border-green-600/40 text-green-300' : 'bg-red-900/90 border-red-600/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (() => {
        const site = sites.find(s => s.id === confirmDelete);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-red-700/50 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
              <h3 className="text-white font-semibold mb-2">Delete Site?</h3>
              <p className="text-gray-400 text-sm mb-1">
                <span className="text-white">{site?.name}</span> ko delete karna chahte ho?
              </p>
              <p className="text-gray-500 text-xs mb-5">Sare articles aur sync history remove ho jayenge.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2.5 rounded-xl text-sm transition-all">
                  Cancel
                </button>
                <button onClick={() => handleDelete(confirmDelete)}
                  className="flex-1 bg-red-700 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-all">
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe size={20} className="text-green-400" />
          <span className="text-white font-medium">Sites ({sites.length})</span>
          {totalArticles > 0 && (
            <span className="text-xs text-gray-500">
              {enabledArticles}/{totalArticles} articles enabled
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncAll}
            disabled={syncing === 'all' || sites.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-xs hover:bg-gray-700 disabled:opacity-50 transition-all">
            <RefreshCw size={12} className={syncing === 'all' ? 'animate-spin' : ''} />
            Sync All
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-green-600 rounded-lg text-white text-xs hover:bg-green-500 transition-all">
            <Plus size={12} />
            Add Site
          </button>
        </div>
      </div>

      {/* Site search */}
      {sites.length > 3 && (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={siteSearch}
            onChange={e => setSiteSearch(e.target.value)}
            placeholder="Filter sites..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-white text-xs outline-none focus:border-green-500"
          />
        </div>
      )}

      {/* Sites List */}
      {filteredSites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Globe size={48} className="mb-4 opacity-30" />
          {siteSearch ? (
            <p className="text-sm">No sites match "{siteSearch}"</p>
          ) : (
            <>
              <p className="text-sm">No sites added yet</p>
              <p className="text-xs mt-1">Add your blog/website to start generating traffic</p>
              <button onClick={() => setShowAddModal(true)}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-green-600 rounded-lg text-white text-xs hover:bg-green-500">
                <Plus size={12} /> Add First Site
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSites.map(site => {
            const search = articleSearch[site.id] || '';
            const filteredArticles = site.articles.filter(a =>
              !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.url.toLowerCase().includes(search.toLowerCase())
            );

            return (
              <div key={site.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                {/* Site Row */}
                <div className="flex items-center gap-3 p-4">
                  <button
                    onClick={() => setExpandedSite(expandedSite === site.id ? null : site.id)}
                    className="p-1 hover:bg-gray-800 rounded">
                    {expandedSite === site.id
                      ? <ChevronDown size={14} className="text-gray-400" />
                      : <ChevronRight size={14} className="text-gray-500" />}
                  </button>

                  <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Globe size={14} className="text-green-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{site.name}</div>
                    <div className="text-gray-500 text-xs truncate">{site.feedUrl}</div>
                  </div>

                  {/* Stats */}
                  <div className="hidden md:flex items-center gap-5 text-xs">
                    <div className="text-center">
                      <div className={`font-semibold ${site.totalArticles > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {site.enabledArticles}/{site.totalArticles}
                      </div>
                      <div className="text-gray-500">Articles</div>
                    </div>
                    <div className="text-center">
                      <div className="text-gray-300">{site.syncInterval}</div>
                      <div className="text-gray-500">Sync</div>
                    </div>
                    <div className="text-center">
                      <div className="text-gray-300 whitespace-nowrap">{fmtDate(site.lastSyncAt)}</div>
                      <div className="text-gray-500">Last Sync</div>
                    </div>
                  </div>

                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    site.status === 'active'
                      ? 'bg-green-600/20 text-green-400 border-green-600/30'
                      : 'bg-gray-700/50 text-gray-400 border-gray-600/30'
                  }`}>
                    {site.status}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggleSite(site.id)} title="Toggle active/inactive" className="p-1.5 hover:bg-gray-800 rounded-lg">
                      {site.status === 'active'
                        ? <ToggleRight size={18} className="text-green-400" />
                        : <ToggleLeft size={18} className="text-gray-500" />}
                    </button>
                    <button
                      onClick={() => handleSync(site.id)}
                      disabled={syncing === site.id}
                      title="Sync sitemap"
                      className="p-1.5 hover:bg-gray-800 rounded-lg disabled:opacity-50">
                      <RefreshCw size={14} className={`text-gray-400 ${syncing === site.id ? 'animate-spin' : ''}`} />
                    </button>
                    <a href={site.url} target="_blank" rel="noopener noreferrer" title="Open site" className="p-1.5 hover:bg-gray-800 rounded-lg">
                      <ExternalLink size={14} className="text-gray-500" />
                    </a>
                    <button onClick={() => setConfirmDelete(site.id)} title="Delete site" className="p-1.5 hover:bg-red-900/30 rounded-lg">
                      <Trash2 size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>

                {/* Expanded Articles Panel */}
                {expandedSite === site.id && (
                  <div className="border-t border-gray-800 p-4">
                    {site.totalArticles === 0 ? (
                      <div className="flex flex-col items-center py-6 text-gray-500">
                        <AlertCircle size={24} className="mb-2 opacity-40" />
                        <p className="text-xs">No articles found in sitemap</p>
                        <p className="text-xs mt-1">Check the sitemap URL or click Sync</p>
                        <button onClick={() => handleSync(site.id)}
                          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-green-600/20 border border-green-600/30 rounded-lg text-green-400 text-xs hover:bg-green-600/30">
                          <RefreshCw size={10} /> Sync Now
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Article Controls */}
                        <div className="flex items-center gap-3 mb-3">
                          <div className="relative flex-1 max-w-xs">
                            <input
                              type="text"
                              placeholder="Search articles..."
                              value={search}
                              onChange={e => setArticleSearch(prev => ({ ...prev, [site.id]: e.target.value }))}
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-green-500"
                            />
                          </div>
                          <span className="text-gray-500 text-xs">
                            {filteredArticles.filter(a => a.enabled).length}/{filteredArticles.length} enabled
                          </span>
                          <div className="flex gap-2 ml-auto">
                            <button onClick={() => enableAllArticles(site.id)} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                              <Check size={10} /> Enable All
                            </button>
                            <button onClick={() => disableAllArticles(site.id)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                              <X size={10} /> Disable All
                            </button>
                          </div>
                        </div>

                        {/* Article List */}
                        <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
                          {filteredArticles.map(article => (
                            <div
                              key={article.id}
                              className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-800/60 group">
                              <button
                                onClick={() => toggleArticle(site.id, article.id)}
                                className="flex-shrink-0">
                                {article.enabled
                                  ? <Check size={13} className="text-green-400" />
                                  : <X size={13} className="text-gray-600" />}
                              </button>
                              <FileText size={10} className="text-gray-600 flex-shrink-0" />
                              <span className={`text-xs flex-1 truncate ${article.enabled ? 'text-gray-300' : 'text-gray-600'}`}>
                                {article.title}
                              </span>
                              {article.publishedAt && (
                                <span className="text-xs text-gray-600 flex-shrink-0 hidden group-hover:block">
                                  {article.publishedAt.substring(0, 10)}
                                </span>
                              )}
                              <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-600 hover:text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ExternalLink size={10} />
                              </a>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Site Modal */}
      {showAddModal && (
        <AddSiteModal
          onClose={() => setShowAddModal(false)}
          onAdd={async (url, sitemapUrl, syncInterval) => {
            const site = await addSite(url, sitemapUrl, syncInterval);
            if (site) showToast(`Site added: ${site.name}`);
            return site;
          }}
        />
      )}
    </div>
  );
}

// ─── Add Site Modal ───────────────────────────────────────────────────────────
const COMMON_SITEMAPS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/post-sitemap.xml',
  '/page-sitemap.xml',
  '/wp-sitemap.xml',
];

function AddSiteModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (url: string, sitemapUrl: string, syncInterval: SyncInterval) => Promise<Site | undefined>;
}) {
  const [siteUrl, setSiteUrl]         = useState('');
  const [sitemapUrl, setSitemapUrl]   = useState('');
  const [syncInterval, setSyncInterval] = useState<SyncInterval>('12hr');
  const [loading, setLoading]         = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  const handleSiteUrlChange = (val: string) => {
    setSiteUrl(val);
    try {
      const parsed = new URL(val.startsWith('http') ? val : `https://${val}`);
      const base = `${parsed.protocol}//${parsed.hostname}`;
      setSitemapUrl(`${base}/sitemap.xml`);
      setAutoDetected(true);
    } catch {
      setAutoDetected(false);
    }
  };

  const handleSubmit = async () => {
    if (!siteUrl || !sitemapUrl) return;
    setLoading(true);
    const fullUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
    await onAdd(fullUrl, sitemapUrl, syncInterval);
    setLoading(false);
    onClose();
  };

  const base = (() => {
    try {
      const parsed = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch { return ''; }
  })();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold text-lg mb-1">Add Website</h2>
        <p className="text-gray-500 text-xs mb-5">Articles will be fetched from the sitemap XML</p>

        <div className="space-y-4">
          {/* Site URL */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Site URL</label>
            <input
              type="text"
              value={siteUrl}
              onChange={e => handleSiteUrlChange(e.target.value)}
              placeholder="https://myblog.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 outline-none"
            />
          </div>

          {/* Sitemap URL */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block flex items-center gap-2">
              Sitemap URL
              {autoDetected && <span className="text-green-400">(auto-detected)</span>}
            </label>
            <input
              type="text"
              value={sitemapUrl}
              onChange={e => { setSitemapUrl(e.target.value); setAutoDetected(false); }}
              placeholder="https://myblog.com/sitemap.xml"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 outline-none"
            />
            {/* Quick picks */}
            {base && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {COMMON_SITEMAPS.map(path => (
                  <button
                    key={path}
                    onClick={() => { setSitemapUrl(`${base}${path}`); setAutoDetected(false); }}
                    className={`text-xs px-2 py-0.5 rounded border transition-all ${
                      sitemapUrl === `${base}${path}`
                        ? 'bg-green-600/20 border-green-600/40 text-green-400'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}>
                    {path}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sync Interval */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Auto-Sync Interval</label>
            <select
              value={syncInterval}
              onChange={e => setSyncInterval(e.target.value as SyncInterval)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none">
              <option value="1hr">Every 1 hour</option>
              <option value="6hr">Every 6 hours</option>
              <option value="12hr">Every 12 hours</option>
              <option value="daily">Daily</option>
              <option value="manual">Manual only</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 text-sm hover:text-white">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={loading || !siteUrl || !sitemapUrl}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? <><RefreshCw size={12} className="animate-spin" /> Fetching...</> : 'Add Site'}
          </button>
        </div>
      </div>
    </div>
  );
}
