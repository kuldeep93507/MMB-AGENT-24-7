import type { Video } from '../store/useChannelStore';

interface VideoRowProps {
  video: Video;
  onToggle: () => void;
}

// Duration format: seconds < 3600 → "MM:SS", >= 3600 → "H:MM:SS"
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Views format: < 1000 → exact, >= 1000 → "45K", >= 1000000 → "2.3M"
function formatViews(views: number): string {
  if (views >= 1000000) return (views / 1000000).toFixed(1) + 'M';
  if (views >= 1000) return Math.floor(views / 1000) + 'K';
  return views.toString();
}

// Relative date
function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

// Badge config based on video state
function getStatusBadge(video: Video): { label: string; classes: string } {
  if (video.is_enabled === 0) {
    return { label: 'DISABLED', classes: 'bg-gray-800 text-gray-500 border-gray-700' };
  }
  if (video.is_new === 1) {
    return { label: 'NEW', classes: 'bg-green-900/50 text-green-400 border-green-600/40' };
  }
  if (video.status === 'queued') {
    return { label: 'QUEUED', classes: 'bg-yellow-900/50 text-yellow-400 border-yellow-600/40' };
  }
  if (video.status === 'running') {
    return { label: 'RUNNING', classes: 'bg-purple-900/50 text-purple-400 border-purple-600/40' };
  }
  if (video.status === 'done') {
    return { label: 'DONE', classes: 'bg-emerald-900/40 text-emerald-400 border-emerald-600/30' };
  }
  // Normal / available
  return { label: '', classes: 'bg-blue-900/40 text-blue-400 border-blue-600/30' };
}

export default function VideoRow({ video, onToggle }: VideoRowProps) {
  const badge = getStatusBadge(video);
  const isEnabled = video.is_enabled === 1;

  return (
    <div className="px-5 py-3 flex items-start gap-3 hover:bg-gray-800/30 transition-colors">
      {/* Toggle Switch */}
      <button
        onClick={onToggle}
        className={`relative w-9 h-5 rounded-full transition-all duration-200 flex-shrink-0 mt-0.5
          ${isEnabled ? 'bg-green-600' : 'bg-gray-600'}`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200
            ${isEnabled ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>

      {/* Status Badge */}
      {badge.label && (
        <span className={`px-2 py-0.5 rounded-md border text-xs font-semibold flex-shrink-0 mt-0.5 ${badge.classes}`}>
          {badge.label}
        </span>
      )}

      {/* Video Info */}
      <div className="flex-1 min-w-0">
        {/* Title + Duration + Views */}
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${isEnabled ? 'text-white' : 'text-gray-500'}`}>
            {video.title}
          </span>
          <span className="text-gray-500 text-xs flex-shrink-0">
            {formatDuration(video.duration)}
          </span>
          <span className="text-gray-600 text-xs flex-shrink-0">
            &bull;
          </span>
          <span className="text-gray-500 text-xs flex-shrink-0">
            {formatViews(video.views)}
          </span>
        </div>

        {/* URL */}
        <div className="text-gray-600 text-xs truncate font-mono mt-0.5">
          youtube.com/watch?v={video.video_id}
        </div>

        {/* Upload date + Watch count */}
        <div className="flex items-center gap-3 mt-1">
          <span className="text-gray-500 text-xs">
            📅 {formatRelativeDate(video.upload_date)}
          </span>
          {video.watch_count === 0 ? (
            <span className="text-gray-600 text-xs">
              👁️ Not watched yet
            </span>
          ) : (
            <span className="text-green-400 text-xs">
              ✔️ Watched {video.watch_count} times
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
