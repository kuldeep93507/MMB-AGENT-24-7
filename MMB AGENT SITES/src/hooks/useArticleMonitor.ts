/**
 * useArticleMonitor.ts
 * Background hook — polls backend analytics for active article sessions.
 * Returns unread session count to show a badge in TopBar.
 *
 * Usage: call once at App level, pass { unreadCount, ... } to TopBar.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseArticleMonitorReturn {
  unreadCount: number;
  totalReads: number;
  activeSessions: number;
  clearUnread: () => void;
  lastChecked: number | null;
}

const SEEN_KEY = 'mmb_sites_last_seen_reads';

function getLastSeenReads(): number {
  try { return parseInt(localStorage.getItem(SEEN_KEY) || '0', 10) || 0; }
  catch { return 0; }
}

function setLastSeenReads(n: number) {
  try { localStorage.setItem(SEEN_KEY, String(n)); } catch {}
}

export function useArticleMonitor(): UseArticleMonitorReturn {
  const [totalReads, setTotalReads]       = useState(0);
  const [activeSessions, setActiveSessions] = useState(0);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [lastChecked, setLastChecked]     = useState<number | null>(null);
  const lastSeenRef = useRef(getLastSeenReads());
  const checkingRef = useRef(false);

  const checkAnalytics = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const [analyticsRes, statusRes] = await Promise.all([
        fetch('/backend-api/api/analytics').catch(() => null),
        fetch('/backend-api/status').catch(() => null),
      ]);
      if (analyticsRes?.ok) {
        const data = await analyticsRes.json().catch(() => ({}));
        const reads: number = data.totalReads ?? 0;
        setTotalReads(reads);
        const newUnread = Math.max(0, reads - lastSeenRef.current);
        setUnreadCount(newUnread);
      }
      if (statusRes?.ok) {
        const statusMap = await statusRes.json().catch(() => ({}));
        setActiveSessions(Object.keys(statusMap).length);
      }
      setLastChecked(Date.now());
    } catch {
      // backend offline — silent
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkAnalytics();
    const interval = setInterval(() => void checkAnalytics(), 30_000); // every 30s
    return () => clearInterval(interval);
  }, [checkAnalytics]);

  const clearUnread = useCallback(() => {
    lastSeenRef.current = totalReads;
    setLastSeenReads(totalReads);
    setUnreadCount(0);
  }, [totalReads]);

  return { unreadCount, totalReads, activeSessions, clearUnread, lastChecked };
}
