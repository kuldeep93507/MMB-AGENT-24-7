import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
  Save, RefreshCw, Globe, Database, Server, Shield, Eye, EyeOff, Monitor, Layers, Key, Folder,
  Download, Upload, Zap, ExternalLink,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { BrowserProvider, ProviderSelection } from '../services/browserProviderApi';
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  loadSettingsLocal,
  saveSettingsLocal,
  fetchSettingsFromServer,
  saveSettingsToServer,
  fetchConcurrency,
  testMoreLoginConnection,
  testMultiloginConnection,
  exportSettingsJson,
  parseSettingsImport,
} from '../utils/settingsApi';
import { backendUrl, getAuthHeaders } from '../services/backendOrigin';

const PROVIDER_INFO: Record<BrowserProvider, { label: string; connection: string }> = {
  morelogin: { label: 'MoreLogin', connection: 'localhost:40000' },
  multilogin: { label: 'Multilogin', connection: 'api.multilogin.com' },
};

const PROXY_LIFE_OPTIONS = ['1hr', '2hr', '4hr', '8hr', '24hr'] as const;

export default function SettingsPage() {
  const { browserProvider, setBrowserProvider, setActiveTab } = useStore();
  const [settings, setSettings] = useState<AppSettings>(() => loadSettingsLocal());
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [concurrency, setConcurrency] = useState<{ limit: number; running: number; available: number } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showMlPassword, setShowMlPassword] = useState(false);
  const [showMlToken, setShowMlToken] = useState(false);
  const [testingMl, setTestingMl] = useState<'morelogin' | 'multilogin' | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const providerSynced = useRef(false);

  const refreshConcurrency = useCallback(async () => {
    const c = await fetchConcurrency();
    if (c) setConcurrency(c);
  }, []);

  useEffect(() => {
    (async () => {
      const remote = await fetchSettingsFromServer();
      if (remote) {
        setSettings(remote);
        saveSettingsLocal(remote);
        setBackendStatus('ok');
        if (!providerSynced.current && remote.browserProvider) {
          providerSynced.current = true;
          if (remote.browserProvider !== browserProvider) {
            await setBrowserProvider(remote.browserProvider);
          }
        }
      } else {
        setBackendStatus('error');
      }
      await refreshConcurrency();
    })();
    const t = setInterval(refreshConcurrency, 10000);
    return () => clearInterval(t);
  }, [browserProvider, setBrowserProvider, refreshConcurrency]);

  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const payload: AppSettings = {
      ...settings,
      browserProvider,
      moreloginPort: settings.moreloginBaseUrl?.split(':').pop() || settings.moreloginPort || '40000',
    };
    saveSettingsLocal(payload);

    const result = await saveSettingsToServer(payload);
    if (result.success) {
      setBackendStatus('ok');
      setSettings(payload);
    } else {
      setBackendStatus('error');
      setSaveError(result.error || 'Backend save failed — saved locally only');
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    await refreshConcurrency();
  };

  const runTest = async (which: 'morelogin' | 'multilogin') => {
    setTestingMl(which);
    setTestResult(null);
    const r =
      which === 'morelogin'
        ? await testMoreLoginConnection(settings)
        : await testMultiloginConnection(settings);
    setTestResult(r);
    setTestingMl(null);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseSettingsImport(String(reader.result));
        setSettings(imported);
        setSaveError(null);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Invalid settings file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              System config — saved to <span className="font-mono text-gray-400">user-settings.json</span> + browser backup
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {backendStatus === 'ok' && <span className="text-xs text-green-400">● Backend synced</span>}
            {backendStatus === 'error' && <span className="text-xs text-yellow-400">⚠ Backend offline</span>}
            {concurrency && (
              <span className="text-xs text-gray-500">
                Workers: {concurrency.running}/{concurrency.limit} ({concurrency.available} free)
              </span>
            )}
            <button
              type="button"
              onClick={() => exportSettingsJson({ ...settings, browserProvider })}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-gray-800 text-gray-300 text-xs"
            >
              <Download size={14} /> Export
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-gray-800 text-gray-300 text-xs"
            >
              <Upload size={14} /> Import
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 ${
                saved ? 'bg-green-600/30 border border-green-500/40 text-green-400' : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              {saving ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Saving…
                </>
              ) : saved ? (
                '✓ Saved!'
              ) : (
                <>
                  <Save size={15} /> Save Settings
                </>
              )}
            </button>
          </div>
        </div>
        {saveError && (
          <div className="flex items-center justify-between bg-red-900/30 border border-red-700/30 rounded-lg px-3 py-2 mt-2">
            <span className="text-xs text-red-400">⚠️ {saveError}</span>
            <button type="button" onClick={() => setSaveError(null)} className="text-red-400 text-xs">
              ✕
            </button>
          </div>
        )}
        {testResult && (
          <div
            className={`mt-2 text-xs px-3 py-2 rounded-lg border ${
              testResult.ok ? 'bg-green-900/20 border-green-700/40 text-green-400' : 'bg-red-900/20 border-red-700/40 text-red-400'
            }`}
          >
            {testResult.message}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Browser Provider */}
        <Section title="Browser Provider" icon={<Monitor size={15} className="text-cyan-400" />} note="Saved with Settings — controls which profiles load on Profiles page">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-gray-400 text-xs font-medium block mb-2">Active Provider</label>
              <select
                value={browserProvider}
                onChange={(e) => setBrowserProvider(e.target.value as ProviderSelection)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
              >
                <option value="all">🌐 All Providers (mixed)</option>
                <option value="morelogin">MoreLogin</option>
                <option value="multilogin">Multilogin</option>
              </select>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(['all', 'morelogin', 'multilogin'] as const).map((key) => {
              const isActive = browserProvider === key;
              const label = key === 'all' ? 'All Providers' : PROVIDER_INFO[key].label;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBrowserProvider(key)}
                  className={`rounded-xl border px-3 py-3 text-left transition-all ${
                    isActive ? 'bg-cyan-900/20 border-cyan-500/40' : 'bg-gray-800 border-gray-700'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">{label}</div>
                  {isActive && <div className="text-[10px] text-cyan-400 mt-1">Active</div>}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('profiles')}
            className="mt-3 text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
          >
            <ExternalLink size={12} /> Per-profile watch/traffic/engagement → Profiles → Settings on each card
          </button>
        </Section>

        {/* Run limits — kept from old automation (working fields only) */}
        <Section title="Run Limits" icon={<Zap size={15} className="text-yellow-400" />} note="Used by Scheduler, Shuffle, and Backlinks when starting runs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="Max concurrent profiles"
              value={settings.maxConcurrent}
              onChange={(v) => update('maxConcurrent', v)}
              type="number"
              desc="Global cap for /api/schedule/run"
            />
            <Field
              label="Multilogin wave size"
              value={settings.multiloginMaxConcurrent}
              onChange={(v) => update('multiloginMaxConcurrent', v)}
              type="number"
              desc="Profiles per Multilogin batch (plan limit)"
            />
            <Field
              label="Multilogin batch gap (ms)"
              value={settings.multiloginBatchGapMs}
              onChange={(v) => update('multiloginBatchGapMs', v)}
              type="number"
              desc="Delay between Multilogin waves"
            />
          </div>
        </Section>

        {/* MoreLogin */}
        <Section title="MoreLogin Local API" icon={<Globe size={15} className="text-blue-400" />}>
          <div className="grid grid-cols-1 gap-4">
            <Field
              label="Base URL"
              value={settings.moreloginBaseUrl}
              onChange={(v) => update('moreloginBaseUrl', v)}
              mono
              desc="Local API (MoreLogin desktop must be running)"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={testingMl === 'morelogin'}
              onClick={() => runTest('morelogin')}
              className="text-xs px-3 py-2 rounded-lg bg-blue-600/30 text-blue-300 border border-blue-600/40 disabled:opacity-50"
            >
              {testingMl === 'morelogin' ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          <div className="mt-4 bg-gray-800 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-yellow-400" />
                <span className="text-white text-sm font-semibold">Security verification</span>
              </div>
              <ToggleSwitch
                enabled={settings.moreloginSecurityEnabled}
                onChange={(v) => update('moreloginSecurityEnabled', v)}
              />
            </div>
            <div className="relative">
              <label className="text-gray-400 text-xs block mb-1.5">API Key</label>
              <div className="flex gap-2">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.moreloginApiKey}
                  onChange={(e) => update('moreloginApiKey', e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono"
                />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400">
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* Multilogin */}
        <Section title="Multilogin" icon={<Key size={15} className="text-purple-400" />}>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-gray-400 text-xs flex items-center gap-1 mb-1.5">
                <Folder size={11} /> Folder ID
              </label>
              <input
                value={settings.multiloginFolderId}
                onChange={(e) => update('multiloginFolderId', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono"
              />
            </div>
            <div className="bg-gray-800 border border-purple-900/40 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-2">Automation token (recommended)</p>
              <div className="flex gap-2">
                <input
                  type={showMlToken ? 'text' : 'password'}
                  value={settings.multiloginToken}
                  onChange={(e) => update('multiloginToken', e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-200"
                />
                <button type="button" onClick={() => setShowMlToken(!showMlToken)} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400">
                  {showMlToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-500 text-xs mb-1 block">Email</label>
                <input
                  type="email"
                  value={settings.multiloginEmail}
                  onChange={(e) => update('multiloginEmail', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs mb-1 block">Password</label>
                <div className="flex gap-2">
                  <input
                    type={showMlPassword ? 'text' : 'password'}
                    value={settings.multiloginPassword}
                    onChange={(e) => update('multiloginPassword', e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200"
                  />
                  <button type="button" onClick={() => setShowMlPassword(!showMlPassword)} className="p-2 bg-gray-800 border border-gray-700 rounded-xl text-gray-400">
                    {showMlPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={testingMl === 'multilogin'}
            onClick={() => runTest('multilogin')}
            className="mt-3 text-xs px-3 py-2 rounded-lg bg-purple-600/30 text-purple-300 border border-purple-600/40 disabled:opacity-50"
          >
            {testingMl === 'multilogin' ? 'Testing…' : 'Test Multilogin'}
          </button>
        </Section>

        {/* Smartproxy — editable, applied to server env on save */}
        <Section title="Smartproxy (new profiles & rotate)" icon={<Server size={15} className="text-green-400" />}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Server" value={settings.proxyServer} onChange={(v) => update('proxyServer', v)} />
            <Field label="Port" value={settings.proxyPort} onChange={(v) => update('proxyPort', v)} type="number" />
            <Field label="Password" value={settings.proxyPassword} onChange={(v) => update('proxyPassword', v)} mono />
            <Field label="Username prefix" value={settings.proxyPrefix} onChange={(v) => update('proxyPrefix', v)} mono />
            <div className="col-span-2">
              <label className="text-gray-400 text-xs block mb-2">Default proxy session life</label>
              <div className="flex flex-wrap gap-2">
                {PROXY_LIFE_OPTIONS.map((life) => (
                  <button
                    key={life}
                    type="button"
                    onClick={() => update('defaultProxyLife', life)}
                    className={`px-4 py-2 rounded-xl border text-sm ${
                      settings.defaultProxyLife === life
                        ? 'bg-green-600/20 border-green-500/40 text-green-400'
                        : 'bg-gray-800 border-gray-700 text-gray-500'
                    }`}
                  >
                    {life}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Applied to server proxy rotate + new profile generation after Save.</p>
        </Section>

        {/* Data storage */}
        <Section title="Data Storage" icon={<Database size={15} className="text-blue-400" />}>
          <div className="space-y-2 text-xs text-gray-400">
            {[
              ['Frontend', 'localStorage — profiles list cache, channels, logs, settings backup'],
              ['user-settings.json', 'Server — API keys, proxy, run limits'],
              ['analytics_data.json', 'Server — analytics'],
              ['watch_history.json', 'Server — shuffle watch history'],
              ['schedules_data.json', 'Server — saved schedules'],
              ['shuffle_data.json', 'Server — shuffle state'],
              ['backlinks_data.json', 'Server — backlink pool'],
            ].map(([name, desc]) => (
              <div key={name} className="bg-gray-800 rounded-xl px-3 py-2.5">
                <span className="text-blue-400 font-medium">{name}</span>
                <span className="text-gray-500"> — {desc}</span>
              </div>
            ))}
          </div>
        </Section>

        <GitPushSection />
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  note,
  children,
}: {
  title: string;
  icon: ReactNode;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-white font-semibold">{title}</h2>
      </div>
      {note && <p className="text-gray-600 text-xs mb-4">{note}</p>}
      {!note && <div className="mb-4" />}
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  desc,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  desc?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-gray-400 text-xs block mb-1.5">{label}</label>
      {desc && <p className="text-gray-600 text-xs mb-1">{desc}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-500 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function GitPushSection() {
  const [version, setVersion] = useState('');
  const [changelog, setChangelog] = useState('');
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch(backendUrl('/api/update/version'))
      .then((r) => r.json())
      .then((d) => setVersion(d.version || '1.0.0'))
      .catch(() => setVersion('1.0.0'));
  }, []);

  const handlePush = async () => {
    if (!version.trim() || !changelog.trim()) return;
    setPushing(true);
    setResult(null);
    try {
      const res = await fetch(backendUrl('/api/update/push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ version, changelog: changelog.split('\n').filter((l) => l.trim()) }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) setChangelog('');
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
    setPushing(false);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h2 className="text-white font-semibold mb-1">Push Update to GitHub</h2>
      <p className="text-gray-600 text-xs mb-4">Developer tool — bump version and push changelog</p>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-gray-400 text-xs block mb-1">Version</label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm font-mono text-gray-200"
          />
        </div>
      </div>
      <textarea
        value={changelog}
        onChange={(e) => setChangelog(e.target.value)}
        rows={3}
        placeholder="Changelog lines…"
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 mb-3 resize-none"
      />
      <button
        type="button"
        onClick={handlePush}
        disabled={pushing || !version.trim() || !changelog.trim()}
        className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-semibold"
      >
        {pushing ? 'Pushing…' : 'Push to GitHub'}
      </button>
      {result && <p className={`text-xs mt-2 ${result.success ? 'text-green-400' : 'text-red-400'}`}>{result.message}</p>}
    </div>
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative w-11 h-6 rounded-full ${enabled ? 'bg-red-600' : 'bg-gray-700'}`}
    >
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full ${enabled ? 'left-6' : 'left-1'}`} />
    </button>
  );
}
