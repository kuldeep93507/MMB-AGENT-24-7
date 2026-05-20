import { useState } from 'react';
import { X, Monitor, Smartphone, Apple, Zap, ChevronRight } from 'lucide-react';
import type { OS } from '../types';

interface NewProfileModalProps {
  onClose: () => void;
  onCreate: (os: OS) => void;
}

export default function NewProfileModal({ onClose, onCreate }: NewProfileModalProps) {
  const [selectedOS, setSelectedOS] = useState<OS | null>(null);
  const [creating, setCreating] = useState(false);
  const [stepLogs, setStepLogs] = useState<string[]>([]);

  const OS_OPTIONS: { os: OS; icon: React.ReactNode; desc: string; color: string }[] = [
    { os: 'Windows', icon: <Monitor size={28} />, desc: 'Desktop fingerprint — Chrome on Windows 10/11. Best for blog reading.', color: 'blue' },
    { os: 'Android', icon: <Smartphone size={28} />, desc: 'Mobile fingerprint — Random Android device. Natural mobile behavior.', color: 'green' },
    { os: 'macOS', icon: <Apple size={28} />, desc: 'macOS fingerprint — Chrome/Safari on MacBook. Premium profile.', color: 'purple' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
    green: 'border-green-500/50 bg-green-500/10 text-green-400',
    purple: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
  };
  const colorSelected: Record<string, string> = {
    blue: 'border-blue-400 bg-blue-500/20 ring-2 ring-blue-500/40',
    green: 'border-green-400 bg-green-500/20 ring-2 ring-green-500/40',
    purple: 'border-purple-400 bg-purple-500/20 ring-2 ring-purple-500/40',
  };

  const handleCreate = () => {
    if (!selectedOS) return;
    setCreating(true);
    const steps = [
      { delay: 300, msg: '✅ Step 1: OS Selected — ' + selectedOS },
      { delay: 700, msg: '⚙️  Step 2: Generating US state + city + session ID...' },
      { delay: 1200, msg: '🔗  Step 3: Building proxy username (smart-pwgbkxcy3lyi_area-US_state-XX_city-YYY_life-4hr_session-xxxxx)' },
      { delay: 1800, msg: '📡  Step 4: MoreLogin API — POST /api/env/create/quick...' },
      { delay: 2400, msg: '🚀  Step 5: Assigning unique IP + fingerprint...' },
      { delay: 3000, msg: '💾  Step 6: Profile saved — ready for article reading' },
      { delay: 3500, msg: '✅  Profile created successfully!' },
    ];
    steps.forEach(({ delay, msg }) => {
      setTimeout(() => {
        setStepLogs(prev => [...prev, msg]);
        if (delay === 3500) {
          setTimeout(() => { onCreate(selectedOS); onClose(); }, 400);
        }
      }, delay);
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-white font-bold text-lg">Create New Profile</h2>
            <p className="text-gray-500 text-xs mt-0.5">
              {!creating ? 'Choose OS — rest is automatic via MoreLogin API' : 'Auto-creating profile...'}
            </p>
          </div>
          {!creating && <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={20} /></button>}
        </div>

        <div className="p-6">
          {!creating ? (
            <>
              <p className="text-gray-400 text-sm mb-4 bg-gray-800/60 border border-gray-700 rounded-xl p-3">
                <span className="text-yellow-400 font-medium">👤 Your only task:</span> Choose an OS below.
                Proxy, fingerprint, MoreLogin setup — all automatic.
              </p>
              <div className="space-y-3">
                {OS_OPTIONS.map(({ os, icon, desc, color }) => {
                  const isSelected = selectedOS === os;
                  return (
                    <button key={os} onClick={() => setSelectedOS(os)}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200
                        ${isSelected ? colorSelected[color] : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}>
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0
                        ${isSelected ? colorMap[color] : 'bg-gray-800 text-gray-500'}`}>{icon}</div>
                      <div className="text-left flex-1">
                        <div className={`font-semibold ${isSelected ? 'text-white' : 'text-gray-300'}`}>{os}</div>
                        <div className="text-gray-500 text-xs mt-0.5">{desc}</div>
                      </div>
                      {isSelected && <ChevronRight size={18} className="text-gray-400 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-6 flex gap-3">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 text-sm font-medium">Cancel</button>
                <button onClick={handleCreate} disabled={!selectedOS}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold flex items-center justify-center gap-2">
                  <Zap size={16} /> Create Profile
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {stepLogs.map((log, i) => (
                <div key={i} className="text-sm text-gray-300 font-mono animate-pulse-once">{log}</div>
              ))}
              {stepLogs.length < 7 && (
                <div className="flex items-center gap-2 mt-4">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-gray-500 text-sm">Processing...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
