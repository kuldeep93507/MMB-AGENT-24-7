import {
  LayoutDashboard, Users, Settings, FileText, Globe, Calendar, Gamepad2,
  BarChart3, MessageSquare, Shield, Shuffle, Link, PanelLeftClose, PanelLeftOpen, Server
} from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'profiles', label: 'Profiles', icon: Users },
  { id: 'sites', label: 'Sites', icon: Globe },
  { id: 'article-shuffle', label: 'Article Shuffle', icon: Shuffle },
  { id: 'backlinks', label: 'Backlinks', icon: Link },
  { id: 'scheduler', label: 'Scheduler', icon: Calendar },
  { id: 'manual', label: 'Manual Control', icon: Gamepad2 },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'profile-settings', label: 'Profile Settings', icon: Users },
  { id: 'proxy-health', label: 'Proxy Health', icon: Shield },
  { id: 'logs', label: 'Activity Logs', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  runningCount: number;
  activeSites: number;
}

export default function Sidebar({ activeTab, setActiveTab, runningCount, activeSites }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} bg-gray-950 border-r border-gray-800 flex flex-col h-full transition-all duration-300`}>
      {/* Logo */}
      <div className={`${collapsed ? 'px-3' : 'px-6'} py-5 border-b border-gray-800`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 via-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-green-900/60 flex-shrink-0 relative overflow-hidden">
            <div className="absolute inset-0 rounded-xl border border-white/20 animate-pulse" />
            <span className="text-white font-black text-sm tracking-tight relative z-10">MMB</span>
          </div>
          {!collapsed && (
            <div className="flex-1">
              <div className="text-white font-bold text-sm leading-tight tracking-wide">MMB SITES</div>
              <div className="text-gray-500 text-xs">Co-founder Kuldeep</div>
            </div>
          )}
        </div>
      </div>

      {/* Toggle */}
      <button onClick={() => setCollapsed(!collapsed)}
        className={`${collapsed ? 'mx-auto' : 'mx-3'} mt-2 mb-1 flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-all`}>
        {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={14} /><span className="text-xs">Collapse</span></>}
      </button>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            title={collapsed ? label : undefined}
            className={`w-full flex items-center gap-3 ${collapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative group
              ${activeTab === id
                ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 border border-transparent'
              }`}
          >
            <Icon size={16} className={`flex-shrink-0 ${activeTab === id ? 'text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
            {!collapsed && <span>{label}</span>}
            {!collapsed && id === 'profiles' && runningCount > 0 && (
              <span className="ml-auto text-xs bg-green-600/30 text-green-400 border border-green-600/30 px-1.5 py-0.5 rounded-full">
                {runningCount}
              </span>
            )}
            {!collapsed && id === 'sites' && activeSites > 0 && (
              <span className="ml-auto text-xs bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 px-1.5 py-0.5 rounded-full">
                {activeSites}
              </span>
            )}
            {collapsed && (
              <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                {label}
              </div>
            )}
          </button>
        ))}
      </nav>

      {/* Bottom Status */}
      {!collapsed ? (
        <div className="px-4 py-4 border-t border-gray-800">
          <div className="bg-gray-900 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Server size={12} className="text-gray-500" />
              <span className="text-gray-500 text-xs">System Status</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-gray-400 text-xs">MoreLogin: Connected</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-gray-400 text-xs">Smartproxy: Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-gray-400 text-xs">Sites Backend: Running</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-2 py-3 border-t border-gray-800 flex flex-col items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="MoreLogin Connected" />
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Smartproxy Active" />
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Sites Backend Running" />
        </div>
      )}
    </aside>
  );
}
