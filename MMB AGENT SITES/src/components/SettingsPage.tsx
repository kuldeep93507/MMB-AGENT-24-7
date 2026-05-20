import { useState, useEffect, useCallback } from 'react';
import {
  Save, RefreshCw, Globe, Server, Clock, Shield, Eye, EyeOff,
  Monitor, Layers, Key, Folder, AlertCircle, CheckCircle,
  Loader, Lock, Unlock, RotateCcw, Zap, ChevronRight,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { BrowserProvider, ProviderSelection } from '../services/browserProviderApi';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppSettings {
  moreloginBaseUrl: string;
  moreloginApiKey: string;
  moreloginSecurityEnabled: boolean;
  multiloginEmail: string;
  multiloginPassword: string;
  multiloginToken: string;
  multiloginFolderId: string;
  adspowerApiKey: string;
  adspowerPort: string;
  proxyServer: string;
  proxyPort: string;
  proxyPassword: string;
  proxyPrefix: string;
  defaultProxyLife: string;
  startDelay: string;
  actionDelay: string;
  maxConcurrent: string;
  maxRetries: string;
  cronEnabled: boolean;
  cronSchedule: string;
  cronAction: string;
  backendPort: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  moreloginBaseUrl: 'http://127.0.0.1:40000',
  moreloginApiKey: 'dbc21d41137f29238f4679e71b7986decb0581115e34a84e',
  moreloginSecurityEnabled: true,
  multiloginEmail: '',
  multiloginPassword: '',
  multiloginToken: '',
  multiloginFolderId: 'fb5dbb2c-c1dc-45ee-9fa1-f34819d84bf2',
  adspowerApiKey: '',
  adspowerPort: '50325',
  proxyServer: 'us.smartproxy.net',
  proxyPort: '3120',
  proxyPassword: 'xEdCpOSFn3nd4ixu',
  proxyPrefix: 'smart-pwgbkxcy3lyi',
  defaultProxyLife: '4hr',
  startDelay: '5000',
  actionDelay: '2000',
  maxConcurrent: '5',
  maxRetries: '3',
  cronEnabled: false,
  cronSchedule: '0 9 * * *',
  cronAction: 'start_all',
  backendPort: '3200',
};

const PROVIDER_INFO: Record<BrowserProvider, { label: string; connection: string; color: string }> = {
  morelogin:  { label: 'MoreLogin',  connection: 'localhost:40000',          color: 'blue' },
  adspower:   { label: 'AdsPower',   connection: 'local.adspower.com:50325', color: 'green' },
  multilogin: { label: 'Multilogin', connection: 'api.multilogin.com',       color: 'purple' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPort(baseUrl: string): string {
  try { return new URL(baseUrl).port || '40000'; } catch {
    const m = baseUrl.match(/:(\d+)/); return m ? m[1] : '40000';
  }
}

function validateSettings(s: AppSettings): string[] {
  const errors: string[] = [];
  if (parseInt(s.startDelay) < 0)        errors.push('Start Delay cannot be negative');
  if (parseInt(s.actionDelay) < 0)       errors.push('Action Delay cannot be negative');
  const mc = parseInt(s.maxConcurrent);
  if (isNaN(mc) || mc < 1 || mc > 50)   errors.push('Max Concurrent must be 1–50');
  const mr = parseInt(s.maxRetries);
  if (isNaN(mr) || mr < 0 || mr > 20)   errors.push('Max Retries must be 0–20');
  const bp = parseInt(s.backendPort);
  if (isNaN(bp) || bp < 1024 || bp > 65535) errors.push('Backend Port must be 1024–65535');
  return errors;
}

type TestStatus = 'idle' | 'checking' | 'ok' | 'error';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { browserProvider, setBrowserProvider } = useStore();

  const [saved, setSaved]             = useState(false);
  const [saving, setSaving]           = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showApiKey, setShowApiKey]   = useState(false);
  const [showMlPassword, setShowMlPassword] = useState(false);
  const [showMlToken, setShowMlToken] = useState(false);
  const [showProxyPass, setShowProxyPass] = useState(false);
  const [proxyUnlocked, setProxyUnlocked] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [testStatus, setTestStatus]   = useState<Record<string, TestStatus>>({});
  const [testMsg, setTestMsg]         = useState<Record<string, string>>({});
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const d = localStorage.getItem('mmb-sites-settings-full');
      if (d) return { ...DEFAULT_SETTINGS, ...JSON.parse(d) };
    } catch {}
    return { ...DEFAULT_SETTINGS };
  });

  // Load from backend on mount
  useEffect(() => {
    fetch('/backend-api/api/settings')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.settings) {
          setSettings(prev => ({ ...prev, ...d.settings }));
          setBackendStatus('ok');
        } else {
          setBackendStatus('error');
        }
      })
      .catch(() => setBackendStatus('error'));
  }, []);

  const update = useCallback(<K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    setSettings(s => ({ ...s, [key]: val }));
  }, []);

  const handleSave = async () => {
    const errors = validateSettings(settings);
    if (errors.length > 0) { setValidationErrors(errors); return; }
    setValidationErrors([]);
    setSaving(true);

    try { localStorage.setItem('mmb-sites-settings-full', JSON.stringify(settings)); } catch {}

    try {
      const res = await fetch('/backend-api/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moreloginApiKey:          settings.moreloginApiKey,
          moreloginPort:            extractPort(settings.moreloginBaseUrl),
          moreloginSecurityEnabled: settings.moreloginSecurityEnabled,
          multiloginEmail:          settings.multiloginEmail,
          multiloginPassword:       settings.multiloginPassword,
          multiloginToken:          settings.multiloginToken,
          multiloginFolderId:       settings.multiloginFolderId,
          adspowerApiKey:           settings.adspowerApiKey,
          adspowerPort:             settings.adspowerPort,
          proxyServer:              settings.proxyServer,
          proxyPort:                settings.proxyPort,
          proxyPassword:            settings.proxyPassword,
          proxyPrefix:              settings.proxyPrefix,
          defaultProxyLife:         settings.defaultProxyLife,
          startDelay:               settings.startDelay,
          actionDelay:              settings.actionDelay,
          maxConcurrent:            settings.maxConcurrent,
          maxRetries:               settings.maxRetries,
          cronEnabled:              settings.cronEnabled,
          cronSchedule:             settings.cronSchedule,
          cronAction:               settings.cronAction,
          backendPort:              settings.backendPort,
        }),
      });
      const data = await res.json();
      setBackendStatus(data.success ? 'ok' : 'error');
    } catch {
      setBackendStatus('error');
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    setShowResetConfirm(false);
    try { localStorage.removeItem('mmb-sites-settings-full'); } catch {}
  };

  const testConnection = async (provider: string) => {
    setTestStatus(s => ({ ...s, [provider]: 'checking' }));
    setTestMsg(s => ({ ...s, [provider]: '' }));
    try {
      const res = await fetch('/backend-api/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      setTestStatus(s => ({ ...s, [provider]: data.success ? 'ok' : 'error' }));
      setTestMsg(s => ({ ...s, [provider]: data.message || '' }));
    } catch (err: unknown) {
      setTestStatus(s => ({ ...s, [provider]: 'error' }));
      setTestMsg(s => ({ ...s, [provider]: err instanceof Error ? err.message : 'Connection failed' }));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-gray-500 text-sm mt-0.5">System configuration for MMB Sites Tool</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Backend sync status */}
            {backendStatus === 'loading' && (
              <span className="text-xs text-gray-400 flex items-center gap-1.5">
                <Loader size={11} className="animate-spin" /> Syncing…
              </span>
            )}
            {backendStatus === 'ok' && (
              <span className="text-xs text-green-400 flex items-center gap-1.5">
                <CheckCircle size={11} /> Backend synced
              </span>
            )}
            {backendStatus === 'error' && (
              <span className="text-xs text-yellow-400 flex items-center gap-1.5">
                <AlertCircle size={11} /> Backend offline (local only)
              </span>
            )}

            {/* Reset */}
            {showResetConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Reset all settings?</span>
                <button onClick={handleReset}
                  className="px-3 py-1.5 rounded-lg text-xs bg-red-600 text-white hover:bg-red-500 transition-colors">
                  Yes, Reset
                </button>
                <button onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-red-400 transition-colors">
                <RotateCcw size={11} /> Reset Defaults
              </button>
            )}

            {/* Save */}
            <button onClick={handleSave} disabled={saving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60
                ${saved
                  ? 'bg-green-600/30 border border-green-500/40 text-green-400'
                  : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/30'}`}>
              {saving
                ? <><RefreshCw size={14} className="animate-spin" /> Saving…</>
                : saved
                  ? '✓ Saved!'
                  : <><Save size={15} /> Save Settings</>}
            </button>
          </div>
        </div>

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {validationErrors.map(e => (
              <span key={e} className="flex items-center gap-1 text-xs text-red-400 bg-red-900/20 border border-red-700/30 px-2 py-1 rounded-lg">
                <AlertCircle size={10} /> {e}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Browser Provider Selection */}
        <Section title="Browser Provider" icon={<Monitor size={15} className="text-cyan-400" />}
          note="Select your antidetect browser — 'All Providers' aggregates profiles from MoreLogin, AdsPower, and Multilogin">
          <div>
            <label className="text-gray-400 text-xs font-medium block mb-2">Active Provider</label>
            <select value={browserProvider} onChange={e => setBrowserProvider(e.target.value as ProviderSelection)}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500 transition-all">
              <option value="all">🌐 All Providers (mixed)</option>
              <option value="morelogin">MoreLogin</option>
              <option value="adspower">AdsPower</option>
              <option value="multilogin">Multilogin</option>
            </select>
          </div>

          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div onClick={() => setBrowserProvider('all')}
              className={`cursor-pointer rounded-xl border px-3 py-3 transition-all ${browserProvider === 'all' ? 'bg-cyan-900/20 border-cyan-500/40' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <Layers size={12} className={browserProvider === 'all' ? 'text-cyan-400' : 'text-gray-500'} />
                <span className={`text-xs font-semibold ${browserProvider === 'all' ? 'text-white' : 'text-gray-400'}`}>All Providers</span>
                {browserProvider === 'all' && <span className="ml-auto text-xs bg-cyan-800/50 text-cyan-300 px-2 py-0.5 rounded-full">Active</span>}
              </div>
              <div className="text-xs text-gray-500">Aggregate from all 3</div>
            </div>

            {(Object.entries(PROVIDER_INFO) as [BrowserProvider, typeof PROVIDER_INFO[BrowserProvider]][]).map(([key, info]) => {
              const isActive = browserProvider === key;
              return (
                <div key={key} onClick={() => setBrowserProvider(key)}
                  className={`cursor-pointer rounded-xl border px-3 py-3 transition-all ${isActive ? 'bg-cyan-900/20 border-cyan-500/40' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                    <span className={`text-xs font-semibold ${isActive ? 'text-white' : 'text-gray-400'}`}>{info.label}</span>
                    {isActive && <span className="ml-auto text-xs bg-green-800/50 text-green-300 px-2 py-0.5 rounded-full">Active</span>}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{info.connection}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 bg-cyan-900/15 border border-cyan-600/30 rounded-xl p-3 text-xs text-cyan-300">
            {browserProvider === 'all'
              ? <>🌐 <strong>All Providers</strong> — fetching profiles from all 3 providers in parallel.</>
              : <>🔗 Connected to <strong>{PROVIDER_INFO[browserProvider as BrowserProvider]?.label}</strong> via{' '}
                  <span className="font-mono">{PROVIDER_INFO[browserProvider as BrowserProvider]?.connection}</span></>}
          </div>
        </Section>

        {/* MoreLogin Config */}
        <Section title="MoreLogin Local API" icon={<Globe size={15} className="text-blue-400" />}
          note="Local API only — must run on same machine with MoreLogin desktop app">
          <Field label="Base URL" value={settings.moreloginBaseUrl}
            onChange={v => update('moreloginBaseUrl', v)} mono
            desc="MoreLogin Local API base address (default: http://127.0.0.1:40000)" />

          <div className="mt-4 bg-gray-800 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-yellow-400" />
                <span className="text-white text-sm font-semibold">Security Verification</span>
              </div>
              <ToggleSwitch enabled={settings.moreloginSecurityEnabled}
                onChange={v => update('moreloginSecurityEnabled', v)} />
            </div>
            <p className="text-gray-500 text-xs mb-3">Each request verified via API Key when enabled</p>
            <label className="text-gray-400 text-xs font-medium block mb-1.5">API Key</label>
            <div className="flex items-center gap-2">
              <input type={showApiKey ? 'text' : 'password'} value={settings.moreloginApiKey}
                onChange={e => update('moreloginApiKey', e.target.value)}
                placeholder="Enter your MoreLogin API Key"
                className="flex-1 bg-gray-900 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-green-600/50 transition-all" />
              <button onClick={() => setShowApiKey(!showApiKey)}
                className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-gray-200 transition-all">
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="mt-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-2.5 text-xs text-yellow-300">
              🔐 Header: <span className="font-mono">Authorization: Bearer {'<API_KEY>'}</span>
            </div>
          </div>

          {/* Test Connection */}
          <TestConnectionRow provider="morelogin" status={testStatus['morelogin']} message={testMsg['morelogin']} onTest={testConnection} />

          <div className="mt-3 bg-blue-900/20 border border-blue-600/30 rounded-xl p-3 text-xs text-blue-300">
            ⚠️ MoreLogin runs on <strong>localhost only</strong> — requires MoreLogin desktop app v2.15.0+.
          </div>

          <div className="mt-3 space-y-1 text-xs text-gray-600 font-mono">
            <div className="text-gray-500 text-xs font-sans font-medium mb-2">Available Endpoints:</div>
            {[
              ['POST', '/api/env/start',                   'text-green-500/60',  '— Start profile'],
              ['POST', '/api/env/close',                   'text-red-500/60',    '— Stop profile'],
              ['POST', '/api/env/create/quick',            'text-blue-500/60',   '— Quick create'],
              ['POST', '/api/env/update',                  'text-yellow-500/60', '— Modify profile'],
              ['POST', '/api/env/removeToRecycleBin/batch','text-red-500/60',    '— Delete profiles'],
              ['POST', '/api/env/page',                    'text-gray-500',      '— List profiles'],
            ].map(([method, path, color, desc]) => (
              <div key={path}>{method} {settings.moreloginBaseUrl}{path} <span className={color}>{desc}</span></div>
            ))}
          </div>
        </Section>

        {/* Multilogin Config */}
        <Section title="Multilogin Configuration" icon={<Key size={15} className="text-purple-400" />}
          note="Cloud API — no desktop app needed. Use automation token (recommended) or email+password.">
          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-xs font-medium block mb-1.5 flex items-center gap-1.5">
                <Folder size={11} /> Folder ID <span className="text-purple-400">(required)</span>
              </label>
              <input type="text" value={settings.multiloginFolderId}
                onChange={e => update('multiloginFolderId', e.target.value)}
                placeholder="fb5dbb2c-c1dc-45ee-9fa1-f34819d84bf2"
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-purple-500 transition-all" />
              <p className="text-gray-600 text-xs mt-1">Multilogin → Profile Groups → right-click folder → Copy ID</p>
            </div>

            {/* Automation Token */}
            <div className="bg-gray-800 border border-purple-900/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={13} className="text-purple-400" />
                <span className="text-white text-sm font-semibold">Automation Token</span>
                <span className="ml-auto text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded-full">Recommended</span>
              </div>
              <p className="text-gray-500 text-xs mb-3">Long-lived token (up to 30 days). Get it: Multilogin → Account → Automation Token</p>
              <div className="flex items-center gap-2">
                <input type={showMlToken ? 'text' : 'password'} value={settings.multiloginToken}
                  onChange={e => update('multiloginToken', e.target.value)}
                  placeholder="Paste your automation token here"
                  className="flex-1 bg-gray-900 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-purple-500 transition-all" />
                <button onClick={() => setShowMlToken(!showMlToken)}
                  className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-all">
                  {showMlToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {settings.multiloginToken && <p className="text-green-400 text-xs mt-2">✓ Token set — email/password not needed</p>}
            </div>

            {/* Email + Password */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-gray-400 text-sm font-semibold">Email + Password</span>
                <span className="ml-auto text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Fallback</span>
              </div>
              <p className="text-gray-600 text-xs mb-3">Used to generate a token if no automation token is set</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 text-xs mb-1 block">Email</label>
                  <input type="email" value={settings.multiloginEmail}
                    onChange={e => update('multiloginEmail', e.target.value)}
                    placeholder="your@email.com"
                    className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-500 transition-all" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs mb-1 block">Password</label>
                  <div className="flex gap-2">
                    <input type={showMlPassword ? 'text' : 'password'} value={settings.multiloginPassword}
                      onChange={e => update('multiloginPassword', e.target.value)}
                      placeholder="••••••••"
                      className="flex-1 bg-gray-900 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-500 transition-all" />
                    <button onClick={() => setShowMlPassword(!showMlPassword)}
                      className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-all">
                      {showMlPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Test Connection */}
          <TestConnectionRow provider="multilogin" status={testStatus['multilogin']} message={testMsg['multilogin']} onTest={testConnection} />

          <div className="mt-3 bg-purple-900/15 border border-purple-600/25 rounded-xl p-3 text-xs text-purple-300">
            🔗 Connects to <span className="font-mono">api.multilogin.com</span> (cloud) + <span className="font-mono">launcher.mlx.yt:45001</span> (local launcher)
          </div>
        </Section>

        {/* AdsPower Config */}
        <Section title="AdsPower Configuration" icon={<Monitor size={15} className="text-green-400" />}
          note="Local API — requires AdsPower desktop app running on the same machine.">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-gray-400 text-xs font-medium block mb-1.5">API Key</label>
                <input type="text" value={settings.adspowerApiKey}
                  onChange={e => update('adspowerApiKey', e.target.value)}
                  placeholder="Your AdsPower API key"
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-green-500 transition-all" />
                <p className="text-gray-600 text-xs mt-1">AdsPower → Settings → API</p>
              </div>
              <div>
                <label className="text-gray-400 text-xs font-medium block mb-1.5">Local Port</label>
                <input type="number" value={settings.adspowerPort}
                  onChange={e => update('adspowerPort', e.target.value)}
                  placeholder="50325" min="1024" max="65535"
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-green-500 transition-all" />
                <p className="text-gray-600 text-xs mt-1">Default: 50325</p>
              </div>
            </div>
          </div>

          {/* Test Connection */}
          <TestConnectionRow provider="adspower" status={testStatus['adspower']} message={testMsg['adspower']} onTest={testConnection} />

          <div className="mt-3 bg-green-900/15 border border-green-600/25 rounded-xl p-3 text-xs text-green-300">
            🔗 Connects to <span className="font-mono">local.adspower.com:{settings.adspowerPort}</span>
          </div>
        </Section>

        {/* Smartproxy Config */}
        <Section title="Smartproxy Configuration" icon={<Server size={15} className="text-green-400" />}
          note="Fixed values — only change if you have a different proxy provider.">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-500">Fields are locked by default to prevent accidental changes.</p>
            <button onClick={() => setProxyUnlocked(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${proxyUnlocked ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/40' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {proxyUnlocked ? <><Unlock size={11} /> Locked (click to lock)</> : <><Lock size={11} /> Unlock to Edit</>}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Server" value={settings.proxyServer} onChange={v => update('proxyServer', v)} disabled={!proxyUnlocked} />
            <Field label="Port" value={settings.proxyPort} onChange={v => update('proxyPort', v)} disabled={!proxyUnlocked} />
            <div>
              <label className="text-gray-400 text-xs font-medium block mb-1.5">Password</label>
              <div className="flex gap-2">
                <input type={showProxyPass ? 'text' : 'password'} value={settings.proxyPassword}
                  onChange={e => update('proxyPassword', e.target.value)}
                  disabled={!proxyUnlocked}
                  className={`flex-1 border rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none transition-all
                    ${!proxyUnlocked ? 'bg-gray-800/40 border-gray-800 text-gray-600 cursor-not-allowed' : 'bg-gray-800 border-gray-700 text-gray-200 focus:border-green-500'}`} />
                <button onClick={() => setShowProxyPass(!showProxyPass)}
                  className="p-2.5 bg-gray-800 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-all flex-shrink-0">
                  {showProxyPass ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            <Field label="Prefix" value={settings.proxyPrefix} onChange={v => update('proxyPrefix', v)} disabled={!proxyUnlocked} mono />

            <div className="col-span-2">
              <label className="text-gray-400 text-xs font-medium block mb-2">Default Proxy Life</label>
              <div className="flex gap-2">
                {['1hr', '2hr', '4hr', '8hr', '24hr'].map(life => (
                  <button key={life} onClick={() => update('defaultProxyLife', life)}
                    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all
                      ${settings.defaultProxyLife === life
                        ? 'bg-green-600/20 border-green-500/40 text-green-400'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                    {life}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Automation Settings */}
        <Section title="Automation Settings" icon={<Zap size={15} className="text-yellow-400" />}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Delay (ms)" value={settings.startDelay}
              onChange={v => update('startDelay', v)} type="number"
              desc="Wait between profile starts" min={0} />
            <Field label="Action Delay (ms)" value={settings.actionDelay}
              onChange={v => update('actionDelay', v)} type="number"
              desc="Delay between actions" min={0} />
            <Field label="Max Concurrent Profiles" value={settings.maxConcurrent}
              onChange={v => update('maxConcurrent', v)} type="number"
              desc="Run at most N profiles at once" min={1} max={50} />
            <Field label="Max Retries" value={settings.maxRetries}
              onChange={v => update('maxRetries', v)} type="number"
              desc="Job retry attempts before failed" min={0} max={20} />
          </div>
        </Section>

        {/* Backend Server */}
        <Section title="Sites Backend Server" icon={<Server size={15} className="text-emerald-400" />}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Backend Port" value={settings.backendPort}
              onChange={v => update('backendPort', v)} type="number"
              desc="Sites backend runs on this port (default: 3200)" min={1024} max={65535} />
          </div>
          <div className="mt-3 bg-yellow-900/20 border border-yellow-600/30 rounded-xl p-3 text-xs text-yellow-300 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Changing the port requires a <strong>server restart</strong> to take effect — saving this value alone won't switch the running server port.</span>
          </div>
          <div className="mt-3 bg-emerald-900/20 border border-emerald-600/30 rounded-xl p-3 text-xs text-emerald-300">
            Backend handles: Worker threads · Playwright CDP · Article reading · Scroll behavior
          </div>
          <div className="mt-3 space-y-1 text-xs font-mono text-gray-600">
            <div className="text-gray-500 font-sans font-medium mb-2">Backend API Endpoints:</div>
            {[
              ['POST', '/start',               'text-green-500/60',  '— Start reading session'],
              ['POST', '/stop',                'text-red-500/60',    '— Stop profile worker'],
              ['GET',  '/status',              'text-gray-500',      '— All worker statuses'],
              ['GET',  '/logs',                'text-gray-500',      '— Worker logs'],
              ['POST', '/api/scheduler/run',   'text-blue-500/60',   '— Run schedule'],
              ['POST', '/api/manual/start',    'text-green-500/60',  '— Start & connect profiles'],
              ['GET',  '/api/analytics',       'text-cyan-500/60',   '— Live analytics data'],
              ['POST', '/api/test-connection', 'text-purple-500/60', '— Ping a provider'],
            ].map(([method, path, color, desc]) => (
              <div key={path}>{method} {path} <span className={color}>{desc}</span></div>
            ))}
          </div>
        </Section>

        {/* Cron Scheduling */}
        <Section title="Cron Scheduling" icon={<Clock size={15} className="text-purple-400" />}>
          <div className="mb-4 bg-yellow-900/15 border border-yellow-600/25 rounded-xl p-3 text-xs text-yellow-300 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span><strong>Coming soon:</strong> Backend cron runner is not yet active. Settings saved here will be used once the cron module is enabled.</span>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <ToggleSwitch enabled={settings.cronEnabled} onChange={v => update('cronEnabled', v)} />
            <span className={`text-sm ${settings.cronEnabled ? 'text-white' : 'text-gray-500'}`}>
              {settings.cronEnabled ? 'Scheduled automation ENABLED' : 'Scheduled automation DISABLED'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Cron Expression" value={settings.cronSchedule}
              onChange={v => update('cronSchedule', v)}
              desc="e.g., '0 9 * * *' = 9am daily" mono />
            <div>
              <label className="text-gray-400 text-xs font-medium block mb-2">Scheduled Action</label>
              <select value={settings.cronAction} onChange={e => update('cronAction', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-500">
                <option value="start_all">Start All Profiles</option>
                <option value="stop_all">Stop All Profiles</option>
                <option value="renew_proxies">Renew All Proxies</option>
                <option value="run_schedule">Run Active Schedules</option>
              </select>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { expr: '0 9 * * *',   desc: 'Every day at 9am' },
              { expr: '0 */6 * * *', desc: 'Every 6 hours' },
              { expr: '*/30 * * * *',desc: 'Every 30 minutes' },
            ].map(({ expr, desc }) => (
              <button key={expr} onClick={() => update('cronSchedule', expr)}
                className="bg-gray-800 border border-gray-700 rounded-xl p-2.5 text-left hover:border-gray-600 transition-all">
                <div className="text-purple-400 font-mono text-xs">{expr}</div>
                <div className="text-gray-500 text-xs mt-1">{desc}</div>
              </button>
            ))}
          </div>
        </Section>

        {/* Git Push */}
        <GitPushSection />

        {/* Coming Soon */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <ChevronRight size={16} className="text-gray-500" />
            <h2 className="text-white font-semibold">Coming Soon</h2>
          </div>
          <p className="text-gray-600 text-xs mb-4">Upcoming integrations</p>
          <h3 className="text-gray-300 text-sm font-medium mb-2">CAPTCHA Solver</h3>
          <div className="grid grid-cols-2 gap-2">
            {['2Captcha', 'Anti-Captcha', 'CapSolver', 'hCaptcha Solver'].map(name => (
              <div key={name} className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-gray-400 text-xs font-medium">{name}</span>
                <span className="ml-auto text-xs bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded-full">Soon</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────────────────

function Section({ title, icon, note, children }: {
  title: string; icon: React.ReactNode; note?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-white font-semibold">{title}</h2>
      </div>
      {note && <p className="text-gray-600 text-xs mb-4">{note}</p>}
      <div className={note ? '' : 'mt-4'}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', disabled = false, desc, mono, min, max }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; disabled?: boolean; desc?: string; mono?: boolean;
  min?: number; max?: number;
}) {
  return (
    <div>
      <label className="text-gray-400 text-xs font-medium block mb-1.5">{label}</label>
      {desc && <p className="text-gray-600 text-xs mb-1.5">{desc}</p>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        disabled={disabled} min={min} max={max}
        className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-all
          ${mono ? 'font-mono' : ''}
          ${disabled
            ? 'bg-gray-800/40 border-gray-800 text-gray-600 cursor-not-allowed'
            : 'bg-gray-800 border-gray-700 text-gray-200 focus:border-green-500'}`} />
    </div>
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!enabled)}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0 ${enabled ? 'bg-green-600' : 'bg-gray-700'}`}>
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${enabled ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function TestConnectionRow({ provider, status, message, onTest }: {
  provider: string; status: TestStatus | undefined; message: string | undefined;
  onTest: (p: string) => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <button onClick={() => onTest(provider)} disabled={status === 'checking'}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-50 transition-all">
        {status === 'checking'
          ? <><Loader size={11} className="animate-spin" /> Testing…</>
          : <><Zap size={11} /> Test Connection</>}
      </button>
      {status === 'ok' && (
        <span className="flex items-center gap-1 text-xs text-green-400">
          <CheckCircle size={11} /> {message}
        </span>
      )}
      {status === 'error' && (
        <span className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle size={11} /> {message}
        </span>
      )}
    </div>
  );
}

function GitPushSection() {
  const [version, setVersion]     = useState('');
  const [changelog, setChangelog] = useState('');
  const [pushing, setPushing]     = useState(false);
  const [result, setResult]       = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch('/backend-api/api/update/version')
      .then(r => r.json())
      .then(d => setVersion(d.version || '1.0.0'))
      .catch(() => setVersion('1.0.0'));
  }, []);

  const handlePush = async () => {
    if (!version.trim() || !changelog.trim()) return;
    setPushing(true);
    setResult(null);
    try {
      const res = await fetch('/backend-api/api/update/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, changelog: changelog.split('\n').filter(l => l.trim()) }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) setChangelog('');
    } catch (err: unknown) {
      setResult({ success: false, message: 'Backend not running: ' + (err instanceof Error ? err.message : String(err)) });
    }
    setPushing(false);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Server size={15} className="text-blue-400" />
        <h2 className="text-white font-semibold">Push Update to GitHub</h2>
      </div>
      <p className="text-gray-600 text-xs mb-4">Push code changes to GitHub — other machines will see the update notification.</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-gray-400 text-xs font-medium block mb-1.5">Version Number</label>
          <input type="text" value={version} onChange={e => setVersion(e.target.value)}
            placeholder="1.0.1"
            className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-green-500" />
        </div>
        <div>
          <label className="text-gray-400 text-xs font-medium block mb-1.5">Current Status</label>
          <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-green-400 font-mono">
            v{version} — Ready
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="text-gray-400 text-xs font-medium block mb-1.5">Changelog (one entry per line)</label>
        <textarea value={changelog} onChange={e => setChangelog(e.target.value)}
          rows={3} placeholder="Fixed sitemap sync&#10;Added new feature&#10;Bug fix for scroll"
          className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 resize-none" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handlePush} disabled={pushing || !version.trim() || !changelog.trim()}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all">
          {pushing ? <><Loader size={13} className="animate-spin" /> Pushing…</> : 'Push to GitHub'}
        </button>
        {result && (
          <span className={`text-xs flex items-center gap-1 ${result.success ? 'text-green-400' : 'text-red-400'}`}>
            {result.success ? <CheckCircle size={11} /> : <AlertCircle size={11} />} {result.message}
          </span>
        )}
      </div>

      <div className="mt-4 bg-gray-800/50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
        <p className="text-gray-400 font-medium">How it works:</p>
        <p>1. Bump the version number (e.g., 1.0.0 → 1.0.1)</p>
        <p>2. Write a changelog describing what changed</p>
        <p>3. Click "Push to GitHub"</p>
        <p>4. On other machines — open the tool and an update notification will appear</p>
      </div>
    </div>
  );
}
