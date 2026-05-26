import { useEffect, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Dashboard from './components/Dashboard';
import ProfilesPage from './components/ProfilesPage';
import SitesPage from './components/SitesPage';
import ArticleShufflePage from './components/ArticleShufflePage';
import BacklinksPage from './components/BacklinksPage';
import SchedulerPage from './components/SchedulerPage';
import ManualControlPage from './components/ManualControlPage';
import AnalyticsPage from './components/AnalyticsPage';
import CommentTemplatesPage from './components/CommentTemplatesPage';
import ProfileSettingsPage from './components/ProfileSettingsPage';
import ProxyHealthPage from './components/ProxyHealthPage';
import LogsPage from './components/LogsPage';
import SettingsPage from './components/SettingsPage';
import MonitorPage from './components/MonitorPage';
import EngagementPage from './components/EngagementPage';
import SplashScreen from './components/SplashScreen';
import ErrorBoundary from './components/ErrorBoundary';
import { useStore } from './store/useStore';
import { useSiteStore } from './store/useSiteStore';
import { useArticleMonitor } from './hooks/useArticleMonitor';
import { isMultiloginProxyHost } from './utils/profileAdapter';

export default function App() {
  // Splash screen — show only once per session
  const [showSplash, setShowSplash] = useState(() => {
    const shown = sessionStorage.getItem('mmb_sites_splash_shown');
    return !shown;
  });

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
    sessionStorage.setItem('mmb_sites_splash_shown', '1');
  }, []);

  const store = useStore();
  const siteStore = useSiteStore();
  const articleMonitor = useArticleMonitor();
  const [settingsProfileId, setSettingsProfileId] = useState<string | undefined>(undefined);

  // Auto-seed default sites on first launch + fetch profiles on mount
  useEffect(() => {
    if (!siteStore.seeded) siteStore.seedDefaultSites();
    store.fetchProfiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh profiles every 30s to keep status current
  useEffect(() => {
    const t = setInterval(() => store.fetchProfiles(), 30000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check proxy expiry every 10 minutes — auto-renew expired SmartProxy sessions
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      store.profiles.forEach(p => {
        if (isMultiloginProxyHost(p.proxy.server)) return; // skip multilogin built-in proxy
        if (p.status === 'stopped' && p.proxy.expiresAt > 0 && p.proxy.expiresAt < now) {
          store.renewProxy(p.id);
        }
      });
    }, 600_000); // every 10 minutes
    return () => clearInterval(interval);
  }, [store.profiles, store.renewProxy]); // eslint-disable-line react-hooks/exhaustive-deps

  const runningCount = store.profiles.filter(p => p.status === 'running').length;
  const activeSites = siteStore.sites.filter(s => s.status === 'active').length;

  const renderPage = () => {
    switch (store.activeTab) {
      case 'dashboard':
        return <Dashboard profiles={store.profiles} sites={siteStore.sites} readHistory={store.readHistory} setActiveTab={store.setActiveTab} />;
      case 'profiles':
        return (
          <ProfilesPage
            profiles={store.profiles}
            loading={store.loading}
            onFetchProfiles={store.fetchProfiles}
            onCreateProfile={store.createProfile}
            onStartProfile={store.startProfile}
            onStopProfile={store.stopProfile}
            onDeleteProfile={store.deleteProfile}
            onRecreateProfile={store.recreateProfile}
            onToggleSelect={store.toggleSelect}
            onSelectAll={store.selectAll}
            onDeselectAll={store.deselectAll}
            onStartSelected={store.startSelected}
            onStopSelected={store.stopSelected}
            onRenewProxy={store.renewProxy}
            onOpenSettings={(id) => { setSettingsProfileId(id); store.setActiveTab('profile-settings'); }}
            onDeleteSelected={() => {
              const selected = store.profiles.filter(p => p.selected);
              selected.forEach(p => store.deleteProfile(p.id));
            }}
          />
        );
      case 'sites':
        return (
          <SitesPage
            sites={siteStore.sites}
            addSite={siteStore.addSite}
            deleteSite={siteStore.deleteSite}
            syncSite={siteStore.syncSite}
            syncAllSites={siteStore.syncAllSites}
            toggleSite={siteStore.toggleSite}
            toggleArticle={siteStore.toggleArticle}
            enableAllArticles={siteStore.enableAllArticles}
            disableAllArticles={siteStore.disableAllArticles}
          />
        );
      case 'monitor':
        return <MonitorPage profiles={store.profiles} onRefreshProfiles={store.fetchProfiles} />;
      case 'article-shuffle':
        return <ArticleShufflePage profiles={store.profiles} sites={siteStore.sites} readHistory={store.readHistory} />;
      case 'engagement':
        return <EngagementPage profiles={store.profiles} sites={siteStore.sites} setActiveTab={store.setActiveTab} />;
      case 'backlinks':
        return <BacklinksPage profiles={store.profiles} />;
      case 'scheduler':
        return <SchedulerPage profiles={store.profiles} sites={siteStore.sites} />;
      case 'manual':
        return <ManualControlPage profiles={store.profiles} />;
      case 'analytics':
        return <AnalyticsPage profiles={store.profiles} sites={siteStore.sites} readHistory={store.readHistory} rateLimits={store.rateLimits} />;
      case 'comments':
        return <CommentTemplatesPage />;
      case 'profile-settings':
        return <ProfileSettingsPage profiles={store.profiles} profileSettings={store.profileSettings} updateProfileSettings={store.updateProfileSettings} initialProfileId={settingsProfileId} />;
      case 'proxy-health':
        return <ProxyHealthPage profiles={store.profiles} onRenewProxy={store.renewProxy} />;
      case 'logs':
        return <LogsPage logs={store.logs} onClear={store.clearLogs} onClearByLevel={store.clearLogsByLevel} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard profiles={store.profiles} sites={siteStore.sites} readHistory={store.readHistory} setActiveTab={store.setActiveTab} />;
    }
  };

  return (
    <ErrorBoundary>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      <div className={`flex h-screen bg-gray-950 text-white overflow-hidden ${showSplash ? 'hidden' : ''}`}>
        <Sidebar
          activeTab={store.activeTab}
          setActiveTab={store.setActiveTab}
          runningCount={runningCount}
          activeSites={activeSites}
        />
        <main className="flex-1 overflow-hidden flex flex-col">
          <TopBar
            profiles={store.profiles}
            logs={store.logs}
            activeTab={store.activeTab}
            newArticleCount={articleMonitor.unreadCount}
            onClearArticleCount={articleMonitor.clearUnread}
          />
          <div className="flex-1 overflow-hidden flex flex-col">
            {renderPage()}
          </div>
        </main>

        {/* Toast Notifications */}
        {siteStore.toasts.length > 0 && (
          <div className="fixed bottom-4 right-4 z-50 space-y-2">
            {siteStore.toasts.map(toast => (
              <div key={toast.id}
                onClick={() => siteStore.dismissToast(toast.id)}
                className={`px-4 py-3 rounded-xl border text-sm cursor-pointer animate-pulse-once ${
                  toast.type === 'success' ? 'bg-green-900/80 border-green-600/40 text-green-300' :
                  toast.type === 'error' ? 'bg-red-900/80 border-red-600/40 text-red-300' :
                  'bg-gray-800/80 border-gray-600/40 text-gray-300'
                }`}>
                {toast.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
