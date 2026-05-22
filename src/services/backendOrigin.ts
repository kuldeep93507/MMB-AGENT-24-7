/**
 * Resolves backend base URL for fetch().
 * Local dev (`localhost` / `127.0.0.1`): use direct `http://127.0.0.1:<port>`
 * so any Vite port works and we never rely on `/backend-api` proxy (SPA HTML fallback).
 *
 * LAN / production behind same origin: `/backend-api` (Vite or nginx proxy).
 *
 * Override: `.env` → `VITE_BACKEND_URL=http://127.0.0.1:3100` or `VITE_BACKEND_PORT`.
 */

function normalizeBackendPort(): string {
  const raw =
    typeof import.meta.env.VITE_BACKEND_PORT === "string" ? import.meta.env.VITE_BACKEND_PORT.trim() : "";
  const n = raw.replace(/\D/g, "") === "" ? 3100 : Number.parseInt(raw.replace(/\D/g, ""), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return "3100";
  return String(n);
}

/** Base only (no path). Ends with hostname:port without trailing slash, or `/backend-api`. */
export function getBackendBaseUrl(): string {
  const explicit =
    typeof import.meta.env.VITE_BACKEND_URL === "string" ? import.meta.env.VITE_BACKEND_URL.trim() : "";
  if (explicit) return explicit.replace(/\/+$/, "");

  const port = normalizeBackendPort();

  if (typeof window === "undefined") return "/backend-api";

  const { protocol, hostname } = window.location;
  if (protocol === "file:" || protocol === "app:") {
    return `http://127.0.0.1:${port}`;
  }
  if (
    (protocol === "http:" || protocol === "https:") &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  ) {
    return `http://127.0.0.1:${port}`;
  }

  return "/backend-api";
}

/** Full URL: `backendUrl('/api/health')` → base + `/api/health`. */
export function backendUrl(apiPath: string): string {
  const base = getBackendBaseUrl();
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `${base}${path}`;
}

const API_TOKEN_KEY = 'mmb_api_token';

/** Auth header for protected server routes (update/push, clear logs, etc.) */
export function getAuthHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(API_TOKEN_KEY);
    if (token) return { 'X-MMB-Token': token };
  } catch { /* ignore */ }
  return {};
}

export function storeApiToken(token: string): void {
  try {
    if (token) localStorage.setItem(API_TOKEN_KEY, token);
  } catch { /* ignore */ }
}
