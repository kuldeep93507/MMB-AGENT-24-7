import { useState, useEffect } from 'react';
import { Settings, User, RotateCcw, Copy } from 'lucide-react';
import type { Profile, ProfileSiteSettings, ScrollSpeed, TrafficSource } from '../types';

interface ProfileSettingsPageProps {
  profiles: Profile[];
  profileSettings: ProfileSiteSettings[];
  updateProfileSettings: (profileId: string, updates: Partial<ProfileSiteSettings>) => void;
  initialProfileId?: string;
}

const DEFAULTS: Omit<ProfileSiteSettings, 'profileId'> = {
  readTimeMin: 30,
  readTimeMax: 180,
  scrollSpeed: 'medium',
  trafficPreference: 'random',
  commentEnabled: false,
  commentDailyCap: 3,
  adPauseDurationMin: 0.5,
  adPauseDurationMax: 2,
  startDelayMin: 5,
  startDelayMax: 30,
  sessionLimit: 10,
  multiPageSession: true,
  useNextPost: true,
  multiloginPort: undefined,
};

const TRAFFIC_OPTIONS: { value: TrafficSource; label: string; icon: string }[] = [
  { value: 'random',     label: 'Random (mixed)',  icon: '🎲' },
  { value: 'google',     label: 'Google Search',   icon: '🔍' },
  { value: 'bing',       label: 'Bing Search',     icon: '🔵' },
  { value: 'duckduckgo', label: 'DuckDuckGo',      icon: '🦆' },
  { value: 'yahoo',      label: 'Yahoo Search',    icon: '🟣' },
  { value: 'direct',     label: 'Direct URL',      icon: '🔗' },
  { value: 'internal',   label: 'Internal Link',   icon: '↩️' },
  { value: 'backlink',   label: 'Backlink',        icon: '🔙' },
];

function validate(s: ProfileSiteSettings): string[] {
  const errs: string[] = [];
  if (s.readTimeMin >= s.readTimeMax) errs.push('Read Time: Min must be less than Max');
  if (s.adPauseDurationMin > s.adPauseDurationMax) errs.push('Ad Pause: Min must be ≤ Max');
  if (s.startDelayMin > s.startDelayMax) errs.push('Start Delay: Min must be ≤ Max');
  return errs;
}

export default function ProfileSettingsPage({ profiles, profileSettings, updateProfileSettings, initialProfileId }: ProfileSettingsPageProps) {
  const [selectedProfile, setSelectedProfile] = useState<string>(initialProfileId ?? '');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Pre-select initialProfileId when it changes, or fall back to first profile
  useEffect(() => {
    if (initialProfileId) {
      setSelectedProfile(initialProfileId);
    } else if (profiles.length > 0 && !selectedProfile) {
      setSelectedProfile(profiles[0].id);
    }
  }, [initialProfileId, profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const settings = profileSettings.find(s => s.profileId === selectedProfile);
  const profile  = profiles.find(p => p.id === selectedProfile);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  };

  const upd = (patch: Partial<ProfileSiteSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    const errs = validate(next);
    if (errs.length) { showToast(errs[0], false); return; }
    updateProfileSettings(selectedProfile, patch);
    showToast('Saved');
  };

  const resetToDefaults = () => {
    updateProfileSettings(selectedProfile, DEFAULTS);
    showToast('Reset to defaults');
  };

  const applyToAll = () => {
    if (!settings) return;
    const { profileId: _pid, ...rest } = settings;
    profiles.forEach(p => { if (p.id !== selectedProfile) updateProfileSettings(p.id, rest); });
    showToast(`Applied to all ${profiles.length} profiles`);
  };

  if (profiles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p className="text-sm">No profiles available. Create a profile first.</p>
      </div>
    );
  }

  if (!settings || !profile) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p className="text-sm">Select a profile to configure.</p>
      </div>
    );
  }

  const errors = validate(settings);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-xl
          ${toast.ok ? 'bg-green-900/90 border border-green-600/40 text-green-300' : 'bg-red-900/90 border border-red-600/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings size={20} className="text-indigo-400" />
          <span className="text-white font-medium">Profile Settings</span>
        </div>
        <div className="flex gap-2">
          <button onClick={resetToDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-400 hover:text-white text-xs transition-all">
            <RotateCcw size={11} /> Reset Defaults
          </button>
          <button onClick={applyToAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-700/50 bg-indigo-900/20 text-indigo-400 hover:bg-indigo-900/40 text-xs transition-all">
            <Copy size={11} /> Apply to All Profiles
          </button>
        </div>
      </div>

      {/* Profile Selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <label className="text-gray-400 text-xs mb-2 block">Select Profile</label>
        <div className="flex flex-wrap gap-2">
          {profiles.map(p => (
            <button key={p.id} onClick={() => setSelectedProfile(p.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                selectedProfile === p.id
                  ? 'bg-indigo-600/20 border-indigo-600/40 text-indigo-400'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}>
              <User size={10} />
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-3 space-y-1">
          {errors.map(e => <p key={e} className="text-red-400 text-xs">{e}</p>)}
        </div>
      )}

      {/* Settings Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
        <h3 className="text-white text-sm font-medium">{profile.name} — Reading Settings</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Read Time */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Read Time Min (sec)</label>
            <input type="number" value={settings.readTimeMin}
              onChange={e => upd({ readTimeMin: Number(e.target.value) })}
              min={10} max={600}
              className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm outline-none
                ${settings.readTimeMin >= settings.readTimeMax ? 'border-red-600' : 'border-gray-700'}`} />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Read Time Max (sec)</label>
            <input type="number" value={settings.readTimeMax}
              onChange={e => upd({ readTimeMax: Number(e.target.value) })}
              min={10} max={600}
              className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm outline-none
                ${settings.readTimeMin >= settings.readTimeMax ? 'border-red-600' : 'border-gray-700'}`} />
          </div>

          {/* Scroll Speed */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Scroll Speed</label>
            <select value={settings.scrollSpeed}
              onChange={e => upd({ scrollSpeed: e.target.value as ScrollSpeed })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none">
              <option value="slow">Natural — relaxed human scroll + random pauses</option>
              <option value="medium">Normal — steady reading pace</option>
              <option value="fast">Brisk — quick scan, fast reader</option>
            </select>
            <p className="text-gray-600 text-xs mt-1">All speeds add random micro-pauses and variable chunk sizes</p>
          </div>

          {/* Comment */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Comment Enabled</label>
            <select value={settings.commentEnabled ? 'yes' : 'no'}
              onChange={e => upd({ commentEnabled: e.target.value === 'yes' })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none">
              <option value="no">Disabled</option>
              <option value="yes">Enabled</option>
            </select>
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Comment Daily Cap</label>
            <input type="number" value={settings.commentDailyCap}
              onChange={e => upd({ commentDailyCap: Number(e.target.value) })}
              min={0} max={20}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none" />
          </div>

          {/* Ad Pause */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Ad Pause Min (sec)</label>
            <input type="number" value={settings.adPauseDurationMin} step={0.1}
              onChange={e => upd({ adPauseDurationMin: Number(e.target.value) })}
              min={0} max={5}
              className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm outline-none
                ${settings.adPauseDurationMin > settings.adPauseDurationMax ? 'border-red-600' : 'border-gray-700'}`} />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Ad Pause Max (sec)</label>
            <input type="number" value={settings.adPauseDurationMax} step={0.1}
              onChange={e => upd({ adPauseDurationMax: Number(e.target.value) })}
              min={0} max={5}
              className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm outline-none
                ${settings.adPauseDurationMin > settings.adPauseDurationMax ? 'border-red-600' : 'border-gray-700'}`} />
          </div>

          {/* Start Delay */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Start Delay Min (sec)</label>
            <input type="number" value={settings.startDelayMin}
              onChange={e => upd({ startDelayMin: Number(e.target.value) })}
              min={0} max={120}
              className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm outline-none
                ${settings.startDelayMin > settings.startDelayMax ? 'border-red-600' : 'border-gray-700'}`} />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Start Delay Max (sec)</label>
            <input type="number" value={settings.startDelayMax}
              onChange={e => upd({ startDelayMax: Number(e.target.value) })}
              min={0} max={120}
              className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm outline-none
                ${settings.startDelayMin > settings.startDelayMax ? 'border-red-600' : 'border-gray-700'}`} />
          </div>

          {/* Session Limit */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Session Limit (max articles)</label>
            <input type="number" value={settings.sessionLimit}
              onChange={e => upd({ sessionLimit: Number(e.target.value) })}
              min={1} max={30}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none" />
          </div>

          {/* Multi Page Session */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Multi-Page Session</label>
            <select value={settings.multiPageSession ? 'yes' : 'no'}
              onChange={e => upd({ multiPageSession: e.target.value === 'yes' })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none">
              <option value="yes">Enabled — read multiple articles per session</option>
              <option value="no">Disabled — one article then close</option>
            </select>
          </div>

          {/* Use Next Post */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Use Next-Post Links</label>
            <select value={settings.useNextPost ? 'yes' : 'no'}
              onChange={e => upd({ useNextPost: e.target.value === 'yes' })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none">
              <option value="yes">Enabled — navigate via next post button</option>
              <option value="no">Disabled — direct URL only</option>
            </select>
          </div>

          {/* Multilogin Port Override */}
          {profile.browserType === 'multilogin' && (
            <div>
              <label className="text-gray-400 text-xs mb-1 block">Multilogin CDP Port Override</label>
              <input type="number"
                value={settings.multiloginPort ?? ''}
                placeholder="Auto-detect (leave empty)"
                onChange={e => upd({ multiloginPort: e.target.value ? Number(e.target.value) : undefined })}
                min={1024} max={65535}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none font-mono" />
              <p className="text-gray-600 text-xs mt-1">Set if profile is already running (skip auto-start). E.g. 46653</p>
            </div>
          )}
        </div>

        {/* Traffic Preference — full 8 sources */}
        <div>
          <label className="text-gray-400 text-xs mb-2 block">Traffic Preference</label>
          <div className="grid grid-cols-4 gap-2">
            {TRAFFIC_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => upd({ trafficPreference: opt.value })}
                className={`p-2.5 rounded-xl border text-xs text-center flex flex-col items-center gap-1 transition-all
                  ${settings.trafficPreference === opt.value
                    ? 'border-indigo-500 bg-indigo-900/20 text-indigo-400'
                    : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'}`}>
                <span className="text-base">{opt.icon}</span>
                <span className="leading-tight">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
