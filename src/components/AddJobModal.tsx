import { useState } from 'react';
import { X, Zap } from 'lucide-react';
import type { Profile, TaskType } from '../types';

interface AddJobModalProps {
  profiles: Profile[];
  onClose: () => void;
  onAddJob: (profileId: string, taskType: TaskType, details?: string) => void;
}

const TASK_OPTIONS: { type: TaskType; label: string; desc: string; icon: string }[] = [
  { type: 'watch_video', label: 'Watch Video', desc: 'Watch a YouTube video for a specified duration', icon: '▶️' },
  { type: 'like_video', label: 'Like Video', desc: 'Like a YouTube video', icon: '👍' },
  { type: 'subscribe', label: 'Subscribe', desc: 'Subscribe to a YouTube channel', icon: '🔔' },
  { type: 'comment', label: 'Post Comment', desc: 'Post a comment on a video', icon: '💬' },
  { type: 'search', label: 'Search', desc: 'Search for content on YouTube', icon: '🔍' },
  { type: 'idle', label: 'Idle', desc: 'Keep profile active but do nothing', icon: '💤' },
];

export default function AddJobModal({ profiles, onClose, onAddJob }: AddJobModalProps) {
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<TaskType | null>(null);
  const [details, setDetails] = useState('');
  const [bulkMode, setBulkMode] = useState(false);

  const runningProfiles = profiles.filter(p => p.status === 'running');

  const handleAdd = () => {
    if (!selectedTask) return;
    if (bulkMode) {
      runningProfiles.forEach(p => onAddJob(p.id, selectedTask, details));
    } else if (selectedProfile) {
      onAddJob(selectedProfile, selectedTask, details);
    }
    onClose();
  };

  const canSubmit = selectedTask && (bulkMode ? runningProfiles.length > 0 : !!selectedProfile);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-bold text-lg">Add Job to Queue</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Profile Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-gray-400 text-sm font-medium">Target Profile</label>
              <button
                onClick={() => setBulkMode(!bulkMode)}
                className={`text-xs px-3 py-1 rounded-lg border transition-all
                  ${bulkMode ? 'bg-red-600/20 border-red-500/40 text-red-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300'}`}>
                {bulkMode ? '✦ Bulk Mode ON' : 'Enable Bulk Mode'}
              </button>
            </div>
            {bulkMode ? (
              <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-3 text-sm text-red-300">
                🎯 Bulk Mode: This job will be added to ALL {runningProfiles.length} running profiles
              </div>
            ) : (
              <select
                value={selectedProfile}
                onChange={e => setSelectedProfile(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-500"
              >
                <option value="">Select a profile...</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id} disabled={p.status !== 'running'}>
                    {p.name} ({p.os}) {p.status !== 'running' ? '— Not Running' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Task Selection */}
          <div>
            <label className="text-gray-400 text-sm font-medium block mb-2">Task Type</label>
            <div className="grid grid-cols-2 gap-2">
              {TASK_OPTIONS.map(({ type, label, desc, icon }) => (
                <button
                  key={type}
                  onClick={() => setSelectedTask(type)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all
                    ${selectedTask === type
                      ? 'border-red-500/50 bg-red-900/20 text-white'
                      : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600'}`}>
                  <span className="text-lg flex-shrink-0">{icon}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-200">{label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Details */}
          <div>
            <label className="text-gray-400 text-sm font-medium block mb-2">Details (Optional)</label>
            <input
              type="text"
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="e.g., video URL, channel name, search query..."
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-500 placeholder-gray-600"
            />
          </div>

          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 transition-all text-sm font-medium">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!canSubmit}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-all text-sm font-semibold flex items-center justify-center gap-2">
              <Zap size={16} />
              {bulkMode ? `Add to ${runningProfiles.length} Profiles` : 'Add Job'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
