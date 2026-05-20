export type OS = 'Windows' | 'Android' | 'macOS';
export type ProfileStatus = 'running' | 'stopped' | 'starting' | 'error' | 'recreating';
export type ProxyLife = '1hr' | '2hr' | '4hr' | '8hr' | '24hr';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';
export type TaskType = 'read_article' | 'comment' | 'search_google' | 'internal_nav' | 'backlink_visit' | 'idle';
export type TrafficSource = 'google' | 'direct' | 'internal' | 'backlink' | 'random';
export type ScrollSpeed = 'slow' | 'medium' | 'fast';
export type SyncInterval = '1hr' | '6hr' | '12hr' | 'daily' | 'manual';

export interface ProxyConfig {
  server: string;
  port: number;
  username: string;
  password: string;
  state: string;
  city: string;
  life: ProxyLife;
  sessionId: string;
  assignedAt: number;
  expiresAt: number;
}

export interface FingerprintConfig {
  userAgent: string;
  timezone: string;
  language: string;
  resolution: string;
  webGL: string;
  canvas: string;
  audioContext: string;
  cpu: number;
  ram: number;
  webRTC: string;
  geolocation: { lat: number; lng: number };
  battery: number;
  deviceModel?: string;
  androidVersion?: string;
  macOsVersion?: string;
}

export interface Profile {
  id: string;
  name: string;
  os: OS;
  status: ProfileStatus;
  proxy: ProxyConfig;
  ip?: string;
  fingerprint: FingerprintConfig;
  currentAction: string;
  createdAt: number;
  selected: boolean;
  envId?: string;
  /**
   * Which antidetect browser this profile lives in. Set when fetched from the
   * provider list so the UI can route start/stop/delete to the right backend.
   * Optional for backward compat with legacy local-only profiles.
   */
  browserType?: 'morelogin' | 'adspower' | 'multilogin';
}

export interface Article {
  id: string;
  siteId: string;
  title: string;
  url: string;
  publishedAt: string;
  category?: string;
  enabled: boolean;
}

export interface Site {
  id: string;
  name: string;
  url: string;
  feedUrl: string;
  feedType: 'sitemap';
  favicon?: string;
  totalArticles: number;
  enabledArticles: number;
  lastSyncAt: number;
  syncInterval: SyncInterval;
  status: 'active' | 'inactive';
  articles: Article[];
}

export interface ProfileSiteSettings {
  profileId: string;
  readTimeMin: number; // seconds
  readTimeMax: number; // seconds
  scrollSpeed: ScrollSpeed;
  trafficPreference: TrafficSource;
  commentEnabled: boolean;
  commentDailyCap: number;
  adPauseDurationMin: number; // seconds
  adPauseDurationMax: number; // seconds
  startDelayMin: number; // seconds
  startDelayMax: number; // seconds
  sessionLimit: number; // max articles per session
}

export interface ReadHistory {
  id: string;
  profileId: string;
  articleId: string;
  articleUrl: string;
  articleTitle: string;
  siteId: string;
  dwellTime: number; // seconds
  trafficSource: TrafficSource;
  readAt: number;
}

export interface BacklinkEntry {
  id: string;
  externalUrl: string;
  targetArticleUrl: string;
  platform: string; // linkedin, quora, reddit, twitter, etc.
  enabled: boolean;
  usedCount: number;
  lastUsedAt?: number;
}

export interface CommentTemplate {
  id: string;
  text: string;
  category: string;
  usedCount: number;
  lastUsedAt?: number;
}

export interface ScheduleEntry {
  id: string;
  profileId: string;
  profileName: string;
  enabled: boolean;
  type: 'manual' | 'scheduled';
  scheduledAt?: number;
  repeat?: '1hr' | '3hr' | '6hr' | '12hr' | 'daily';
  articleDelay: number; // seconds between articles
  lastRunAt?: number;
  status: 'idle' | 'running' | 'completed' | 'error';
}

export interface Job {
  id: string;
  profileId: string;
  profileName: string;
  taskType: TaskType;
  status: JobStatus;
  retryCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  details?: string;
}

export interface LogEntry {
  id: string;
  profileId?: string;
  profileName?: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: number;
}

export interface RateLimitConfig {
  profileId: string;
  dailyReadCap: number;
  dailyCommentCap: number;
  sessionCooldownMin: number; // minutes
  readsToday: number;
  commentsToday: number;
  lastResetAt: number;
}

export interface AnalyticsData {
  totalReads: number;
  totalDwellTime: number; // seconds
  totalSessions: number;
  adImpressions: number;
  trafficSources: { google: number; direct: number; internal: number; backlink: number };
  perSite: { siteId: string; siteName: string; reads: number; dwellTime: number }[];
  perProfile: { profileId: string; profileName: string; reads: number; dwellTime: number }[];
}
