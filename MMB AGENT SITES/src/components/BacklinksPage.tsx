import { useState, useEffect } from 'react';
import { Plus, Trash2, ExternalLink, Play, Globe, Link, AlertCircle } from 'lucide-react';
import type { Profile } from '../types';

interface Backlink {
  id: string;
  sourceUrl: string;
  sourceType: 'linkedin' | 'quora' | 'reddit' | 'blog' | 'twitter' | 'facebook' | 'other';
  targetArticleUrl: string;
  usedCount: number;
  lastUsed: number | null;
}

interface BacklinksPageProps {
  profiles: Profile[];
}

const SOURCE_TYPES = [
  { value: 'linkedin',  label: 'LinkedIn',      icon: '💼' },
  { value: 'quora',     label: 'Quora',         icon: '❓' },
  { value: 'reddit',    label: 'Reddit',        icon: '🟠' },
  { value: 'blog',      label: 'Blog/Website',  icon: '📝' },
  { value: 'twitter',   label: 'Twitter/X',     icon: '🐦' },
  { value: 'facebook',  label: 'Facebook',      icon: '📘' },
  { value: 'other',     label: 'Other',         icon: '🔗' },
];

function loadBacklinks(): Backlink[] {
  try { const d = localStorage.getItem('mmb_sites_backlinks'); return d ? JSON.parse(d) : []; } catch { return []; }
}
function saveBacklinks(links: Backlink[]) {
  try { localStorage.setItem('mmb_sites_backlinks', JSON.stringify(links)); } catch {}
}

export default function BacklinksPage({ profiles }: BacklinksPageProps) {
  const [backlinks, setBacklinks]         = useState<Backlink[]>(() => loadBacklinks());
  const [showAdd, setShowAdd]             = useState(false);
  const [running, setRunning]             = useState(false);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [assignMode, setAssignMode]       = useState<'random' | 'manual'>('random');
  const [manualAssign, setManualAssign]   = useState<Record<string, string[]>>({});
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => { saveBacklinks(backlinks); }, [backlinks]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const addBacklink = (sourceUrl: string, sourceType: Backlink['sourceType'], targetArticleUrl: string) => {
    const link: Backlink = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sourceUrl, sourceType, targetArticleUrl,
      usedCount: 0, lastUsed: null,
    };
    setBacklinks(prev => [...prev, link]);
  };

  const deleteBacklink = (id: string) => setBacklinks(prev => prev.filter(b => b.id !== id));

  const toggleManualAssign = (profileId: string, backlinkId: string) => {
    setManualAssign(prev => {
      const current = prev[profileId] || [];
      const updated = current.includes(backlinkId) ? current.filter(x => x !== backlinkId) : [...current, backlinkId];
      return { ...prev, [profileId]: updated };
    });
  };

  const handleRun = async () => {
    if (backlinks.length === 0 || selectedProfiles.length === 0) return;
    setRunning(true);

    // Build per-profile assignments, track which backlink IDs were actually used
    const usedIds = new Set<string>();
    const perProfile = selectedProfiles.map(profileId => {
      let pickedBacklinks: Backlink[];
      if (assignMode === 'manual') {
        const assignedIds = manualAssign[profileId] || [];
        pickedBacklinks = backlinks.filter(b => assignedIds.includes(b.id));
        if (pickedBacklinks.length === 0) {
          pickedBacklinks = [backlinks[Math.floor(Math.random() * backlinks.length)]];
        }
      } else {
        const count = Math.floor(Math.random() * 3) + 1;
        pickedBacklinks = [...backlinks].sort(() => Math.random() - 0.5).slice(0, count);
      }
      pickedBacklinks.forEach(b => usedIds.add(b.id));
      return {
        profileId,
        backlinks: pickedBacklinks.map(b => ({
          sourceUrl: b.sourceUrl,
          sourceType: b.sourceType,
          targetArticleUrl: b.targetArticleUrl,
        })),
      };
    });

    try {
      const res = await fetch('/backend-api/api/schedule/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'backlink_' + Date.now(),
          name: 'Backlink Traffic Run',
          selectedProfiles,
          trafficType: 'backlink',
          perProfile,
          profileDelayMin: 5,
          profileDelayMax: 20,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      // Only increment usedCount for backlinks that were actually assigned
      const now = Date.now();
      setBacklinks(prev => prev.map(b =>
        usedIds.has(b.id) ? { ...b, usedCount: b.usedCount + 1, lastUsed: now } : b
      ));
      showToast(`Run started for ${selectedProfiles.length} profiles`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Run failed — backend unreachable', false);
    }

    setRunning(false);
  };

  const totalUsed = backlinks.reduce((sum, b) => sum + b.usedCount, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl border
          ${toast.ok ? 'bg-green-900/90 border-green-600/40 text-green-300' : 'bg-red-900/90 border-red-600/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Backlink Traffic</h1>
            <p className="text-gray-500 text-sm mt-0.5">External referral traffic — LinkedIn, Quora, Blogs → Your Site</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all">
              <Plus size={15} /> Add Backlink
            </button>
            <button onClick={handleRun} disabled={backlinks.length === 0 || selectedProfiles.length === 0 || running}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-bold transition-all">
              <Play size={15} /> {running ? 'Running...' : `Run (${selectedProfiles.length} profiles)`}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="border border-blue-700/30 bg-blue-900/10 rounded-xl p-3">
            <div className="text-xl font-bold text-blue-400">{backlinks.length}</div>
            <div className="text-xs text-gray-500">Total Backlinks</div>
          </div>
          <div className="border border-green-700/30 bg-green-900/10 rounded-xl p-3">
            <div className="text-xl font-bold text-green-400">{totalUsed}</div>
            <div className="text-xs text-gray-500">Times Used</div>
          </div>
          <div className="border border-purple-700/30 bg-purple-900/10 rounded-xl p-3">
            <div className="text-xl font-bold text-purple-400">{[...new Set(backlinks.map(b => b.sourceType))].length}</div>
            <div className="text-xs text-gray-500">Source Types</div>
          </div>
          <div className="border border-orange-700/30 bg-orange-900/10 rounded-xl p-3">
            <div className="text-xl font-bold text-orange-400">{selectedProfiles.length}</div>
            <div className="text-xs text-gray-500">Profiles Selected</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Profile Selection */}
        {profiles.length === 0 ? (
          <div className="flex items-center gap-3 bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-4">
            <AlertCircle size={16} className="text-yellow-400 flex-shrink-0" />
            <p className="text-yellow-400 text-sm">No profiles loaded. Go to Profiles tab and click Refresh.</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold text-sm">Select Profiles for Backlink Traffic</h3>
              <div className="flex gap-2">
                <button onClick={() => setSelectedProfiles(profiles.map(p => p.id))} className="text-xs text-green-400 hover:text-green-300">All</button>
                <button onClick={() => setSelectedProfiles([])} className="text-xs text-gray-400 hover:text-gray-300">None</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {profiles.map(p => (
                <button key={p.id} onClick={() => setSelectedProfiles(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${selectedProfiles.includes(p.id) ? 'border-green-500 bg-green-900/30 text-green-300' : 'border-gray-700 bg-gray-800 text-gray-400'}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Assign Mode */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Assign Mode</h3>
          <div className="flex gap-3 mb-4">
            <button onClick={() => setAssignMode('random')}
              className={`flex-1 p-3 rounded-xl border-2 transition-all ${assignMode === 'random' ? 'border-green-500 bg-green-900/20' : 'border-gray-700 bg-gray-800'}`}>
              <span className="text-lg">🎲</span>
              <p className="text-xs font-medium text-gray-300 mt-1">Random from Pool</p>
              <p className="text-xs text-gray-500">Har profile ko 1–3 random backlinks</p>
            </button>
            <button onClick={() => setAssignMode('manual')}
              className={`flex-1 p-3 rounded-xl border-2 transition-all ${assignMode === 'manual' ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700 bg-gray-800'}`}>
              <span className="text-lg">🎯</span>
              <p className="text-xs font-medium text-gray-300 mt-1">Manual Per Profile</p>
              <p className="text-xs text-gray-500">Tu decide kar kisko kya milega</p>
            </button>
          </div>

          {/* Manual Assignment Grid */}
          {assignMode === 'manual' && selectedProfiles.length > 0 && backlinks.length > 0 && (
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {selectedProfiles.map(pid => {
                const profile = profiles.find(p => p.id === pid);
                const assigned = manualAssign[pid] || [];
                return (
                  <div key={pid} className="bg-gray-800 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-white text-xs font-medium">{profile?.name || pid}</p>
                      {assigned.length === 0 && (
                        <span className="text-xs text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded-full">No backlinks — random fallback</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {backlinks.map(b => {
                        const isAssigned = assigned.includes(b.id);
                        const sourceInfo = SOURCE_TYPES.find(s => s.value === b.sourceType);
                        return (
                          <button key={b.id} onClick={() => toggleManualAssign(pid, b.id)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${isAssigned ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                            {sourceInfo?.icon} {b.sourceUrl.replace(/https?:\/\//, '').slice(0, 22)}…
                          </button>
                        );
                      })}
                    </div>
                    {assigned.length > 0 && <p className="text-xs text-purple-400 mt-1">{assigned.length} backlink(s) assigned</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Backlink Pool */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Backlink Pool</h3>
          {backlinks.length === 0 ? (
            <div className="text-center py-12 text-gray-600">
              <Link size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No backlinks yet</p>
              <p className="text-xs mt-1">Add external URLs that link to your blog articles</p>
            </div>
          ) : (
            <div className="space-y-2">
              {backlinks.map(b => {
                const sourceInfo = SOURCE_TYPES.find(s => s.value === b.sourceType);
                return (
                  <div key={b.id} className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 hover:border-gray-600 transition-all">
                    <span className="text-lg">{sourceInfo?.icon || '🔗'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium truncate">{b.sourceUrl}</span>
                        <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded capitalize flex-shrink-0">{b.sourceType}</span>
                      </div>
                      {b.targetArticleUrl && <p className="text-xs text-gray-500 mt-0.5 truncate">→ {b.targetArticleUrl}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-xs text-gray-500">Used: {b.usedCount}x</span>
                      {b.lastUsed && <p className="text-xs text-gray-600">{new Date(b.lastUsed).toLocaleDateString()}</p>}
                    </div>
                    <a href={b.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                      <ExternalLink size={12} />
                    </a>
                    <button onClick={() => deleteBacklink(b.id)} className="text-gray-500 hover:text-red-400 transition-all flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <h3 className="text-gray-300 text-sm font-medium mb-2">🔗 How Backlink Traffic Works:</h3>
          <div className="space-y-1 text-xs text-gray-500">
            <p>1. Profile external URL open karta hai (LinkedIn, Quora, Blog etc.)</p>
            <p>2. 5–15 sec page pe rukta hai (human behavior — page read karta hai)</p>
            <p>3. Page pe blog article ka link dhundhta hai</p>
            <p>4. Link click → Your blog pe redirect</p>
            <p>5. Normal article read shuru (butter smooth scroll)</p>
            <p className="text-green-400 mt-2">✅ Google Analytics me "Referral" traffic source dikhega — organic lagega!</p>
          </div>
        </div>
      </div>

      {/* Add Backlink Modal */}
      {showAdd && <AddBacklinkModal onClose={() => setShowAdd(false)} onAdd={addBacklink} />}
    </div>
  );
}

function AddBacklinkModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (sourceUrl: string, sourceType: Backlink['sourceType'], targetArticleUrl: string) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceType, setSourceType] = useState<Backlink['sourceType']>('blog');
  const [targetUrl, setTargetUrl]   = useState('');

  const handleSubmit = () => {
    if (!sourceUrl.trim()) return;
    onAdd(sourceUrl.trim(), sourceType, targetUrl.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-bold text-lg mb-4">Add Backlink</h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Source URL (external page with your blog link)</label>
            <input type="text" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
              placeholder="https://linkedin.com/posts/user_article-xyz..."
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-green-500" />
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Source Type</label>
            <div className="grid grid-cols-4 gap-2">
              {SOURCE_TYPES.map(s => (
                <button key={s.value} onClick={() => setSourceType(s.value as Backlink['sourceType'])}
                  className={`p-2 rounded-lg border text-center transition-all ${sourceType === s.value ? 'border-green-500 bg-green-900/30' : 'border-gray-700 bg-gray-800'}`}>
                  <div className="text-lg">{s.icon}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Target Article URL (your blog — optional)</label>
            <input type="text" value={targetUrl} onChange={e => setTargetUrl(e.target.value)}
              placeholder="https://myblog.com/best-article-2026"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-green-500" />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2.5 rounded-xl text-sm transition-all">Cancel</button>
          <button onClick={handleSubmit} disabled={!sourceUrl.trim()}
            className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-all">Add Backlink</button>
        </div>
      </div>
    </div>
  );
}
