/**
 * MultiloginProvider — Concrete BrowserProvider for Multilogin X antidetect browser
 * 
 * Multilogin uses TWO different API endpoints:
 *   1. Cloud API: https://api.multilogin.com (for CRUD — create, delete, list, search)
 *   2. Local Launcher: https://launcher.mlx.yt:45001 (for start/stop — must be running locally)
 * 
 * Token management:
 *   - Bearer token obtained via POST /user/signin with email + password
 *   - Token expires in 30 minutes
 *   - Proactively refresh at 25 minutes
 *   - On 401 response: refresh once, retry original request
 *   - If refresh fails: return code -4 error
 * 
 * Configuration (via environment variables):
 *   MULTILOGIN_EMAIL — Account email for signin
 *   MULTILOGIN_PASSWORD — Account password for signin
 *   MULTILOGIN_FOLDER_ID — Folder ID for profile organization (required)
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 10.2
 */

'use strict';

const { BrowserProvider } = require('./BrowserProvider.cjs');
const https = require('https');
const crypto = require('crypto');

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

// API endpoints
const CLOUD_API_BASE = 'https://api.multilogin.com';
const LAUNCHER_BASE = 'https://launcher.mlx.yt:45001';
const PROXY_API_BASE = 'https://profile-proxy.multilogin.com'; // Multilogin residential proxy service

// Token timing
const TOKEN_EXPIRY_MS = 30 * 60 * 1000;       // 30 minutes actual expiry
const TOKEN_REFRESH_MS = 25 * 60 * 1000;       // Refresh proactively at 25 minutes

// Timeout configuration
const DEFAULT_TIMEOUT = 25000;  // 25s for standard requests (proxy gen can be slow)
const START_TIMEOUT = 30000;    // 30s for browser start operations
const STOP_TIMEOUT = 15000;     // 15s for browser stop operations

class MultiloginProvider extends BrowserProvider {
  constructor() {
    super('multilogin');

    // Read config from environment
    this.email = process.env.MULTILOGIN_EMAIL || '';
    this.password = process.env.MULTILOGIN_PASSWORD || '';
    this.folderId = process.env.MULTILOGIN_FOLDER_ID || '';

    // AUTOMATION TOKEN — permanent long-lived token (up to 1 month).
    // If MULTILOGIN_TOKEN is set in .env, use it directly — no email/password signin needed.
    // Get it from: GET https://api.multilogin.com/workspace/automation_token?expiration_period=720h
    // Set it in .env: MULTILOGIN_TOKEN=your_token_here
    const staticToken = process.env.MULTILOGIN_TOKEN || '';
    if (staticToken) {
      this.token = staticToken;
      // Set expiry far in future — static tokens don't expire via code (managed manually in .env)
      this.tokenExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
      console.log('[multilogin] Using MULTILOGIN_TOKEN from .env (static automation token)');
    } else {
      this.token = null;
      this.tokenExpiresAt = 0;
    }

    // Validate MULTILOGIN_FOLDER_ID at construction time
    if (!this.folderId) {
      console.error('[multilogin] MULTILOGIN_FOLDER_ID environment variable is not set');
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TOKEN MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Authenticate with Multilogin Cloud API.
   * POST https://api.multilogin.com/user/signin with {email, password}
   * Skipped if MULTILOGIN_TOKEN is set in .env (static automation token preferred).
   *
   * @returns {Promise<{code: number, message: string, data: object|null}>}
   */
  async authenticate() {
    // If static automation token is set, return success immediately — no signin needed
    if (process.env.MULTILOGIN_TOKEN) {
      this.token = process.env.MULTILOGIN_TOKEN;
      this.tokenExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
      return this._successResponse('Using static automation token', { token: this.token });
    }

    if (!this.email || !this.password) {
      return this._errorResponse(-2, 'Multilogin credentials not configured: MULTILOGIN_EMAIL and MULTILOGIN_PASSWORD required');
    }

    // ── Retry loop — 501 is intermittent on Multilogin's cloud API ──
    // Retry up to 3 times with backoff before giving up
    const maxAttempts = 3;
    const backoff = [0, 3000, 6000]; // ms between retries

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        console.log(`[multilogin] Signin retry ${attempt}/${maxAttempts - 1} in ${backoff[attempt] / 1000}s...`);
        await new Promise(r => setTimeout(r, backoff[attempt]));
      }

      try {
        const url = `${CLOUD_API_BASE}/user/signin`;
        const response = await this._makeCloudRequest(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { email: this.email, password: md5(this.password) },
          timeout: DEFAULT_TIMEOUT,
        });

        if (response.statusCode === 200 && response.body) {
          // Multilogin returns { status: {...}, data: { token: "...", refresh_token: "..." } }
          const token = (response.body.data && response.body.data.token)
            ? response.body.data.token
            : response.body.token || null;

          if (token) {
            this.token = token;
            this.tokenExpiresAt = Date.now() + TOKEN_REFRESH_MS; // Refresh at 25 min
            console.log('[multilogin] Authenticated successfully — fetching permanent automation token...');

            // ── AUTO-FETCH PERMANENT TOKEN ──
            // Now that we have a short-lived token, immediately fetch a 30-day
            // automation token and save it to .env so future restarts skip signin entirely.
            try {
              const autoRes = await this._makeCloudRequest(
                `${CLOUD_API_BASE}/workspace/automation_token?expiration_period=720h`,
                {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  timeout: DEFAULT_TIMEOUT,
                }
              );
              const autoToken = autoRes.body && autoRes.body.data && autoRes.body.data.token
                ? autoRes.body.data.token
                : null;

              if (autoToken) {
                // Switch to permanent token immediately
                this.token = autoToken;
                this.tokenExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

                // Save to .env file so future server restarts skip signin
                this._saveTokenToEnv(autoToken);
                console.log('[multilogin] ✅ Permanent automation token saved to .env (valid 30 days) — no more signin needed!');
              }
            } catch (autoErr) {
              // Non-critical — short-lived token still works for this session
              console.warn(`[multilogin] Could not fetch automation token: ${autoErr.message}`);
            }

            return this._successResponse('Authenticated successfully', { token: this.token });
          }

          return this._errorResponse(-2, 'Multilogin signin response did not contain a token');
        }

        // 501 — server intermittently rejects POST /user/signin — retry
        if (response.statusCode === 501) {
          console.warn(`[multilogin] Signin returned 501 (attempt ${attempt + 1}/${maxAttempts}) — Multilogin cloud API glitch, will retry`);
          continue; // next attempt
        }

        // Other non-200 response — don't retry
        const msg = response.body && response.body.message
          ? response.body.message
          : `Signin failed with status ${response.statusCode}`;
        return this._errorResponse(-2, `Multilogin authentication failed: ${msg}`);

      } catch (error) {
        if (attempt < maxAttempts - 1) {
          console.warn(`[multilogin] Signin attempt ${attempt + 1} error: ${error.message} — retrying...`);
          continue;
        }
        return this._handleMultiloginError(error, 'authenticate');
      }
    }

    return this._errorResponse(-2, 'Multilogin authentication failed after 3 attempts (status 501 — server-side issue). Add MULTILOGIN_TOKEN to .env to bypass signin permanently.');
  }

  /**
   * Save MULTILOGIN_TOKEN to .env file — called after successfully fetching automation token.
   * Updates the existing MULTILOGIN_TOKEN= line (or adds it if missing).
   * @private
   */
  _saveTokenToEnv(token) {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.resolve(__dirname, '..', '..', '.env');
      let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

      if (content.match(/^MULTILOGIN_TOKEN=.*/m)) {
        // Update existing line
        content = content.replace(/^MULTILOGIN_TOKEN=.*/m, `MULTILOGIN_TOKEN=${token}`);
      } else {
        // Append new line
        content += `\nMULTILOGIN_TOKEN=${token}\n`;
      }

      fs.writeFileSync(envPath, content, 'utf8');
      // Also update process.env so current process uses it immediately
      process.env.MULTILOGIN_TOKEN = token;
      console.log('[multilogin] MULTILOGIN_TOKEN saved to .env');
    } catch (err) {
      console.warn(`[multilogin] Could not save token to .env: ${err.message}`);
    }
  }

  /**
   * Refresh the Bearer token by re-authenticating.
   * Called on 401 response — retries signin once.
   * Returns code -4 if refresh fails.
   * 
   * @returns {Promise<{code: number, message: string, data: object|null}>}
   */
  async refreshToken() {
    console.log('[multilogin] Token expired or invalid, attempting refresh...');

    // Clear current token
    this.token = null;
    this.tokenExpiresAt = 0;

    // Attempt re-authentication
    const result = await this.authenticate();

    if (result.code !== 0) {
      // Refresh failed — return code -4
      console.error('[multilogin] Token refresh failed');
      return this._errorResponse(-4, 'Multilogin token refresh failed: re-authentication required');
    }

    return result;
  }

  /**
   * Get authorization headers for Multilogin API requests.
   * Auto-authenticates on first call or when token is expired/about to expire.
   * 
   * @returns {Promise<{headers: object|null, error: {code: number, message: string, data: null}|null}>}
   */
  async getAuthHeaders() {
    // Validate folder_id first
    if (!this.folderId) {
      return {
        headers: null,
        error: this._errorResponse(-5, 'MULTILOGIN_FOLDER_ID environment variable is not set'),
      };
    }

    // Check if token needs refresh (expired or about to expire)
    if (!this.token || Date.now() >= this.tokenExpiresAt) {
      const authResult = await this.authenticate();
      if (authResult.code !== 0) {
        return { headers: null, error: authResult };
      }
    }

    return {
      headers: { Authorization: `Bearer ${this.token}` },
      error: null,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CLOUD API HELPERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Make an authenticated request to the Multilogin Cloud API.
   * Handles 401 responses by refreshing the token and retrying once.
   * 
   * @param {string} endpoint - API endpoint path (e.g., '/profile/search')
   * @param {object} [options={}] - Request options
   * @param {string} [options.method='POST'] - HTTP method
   * @param {object} [options.body=null] - Request body
   * @param {number} [options.timeout=DEFAULT_TIMEOUT] - Request timeout in ms
   * @returns {Promise<{code: number, message: string, data: any}>} Standardized response
   */
  async _authenticatedCloudRequest(endpoint, options = {}) {
    const { method = 'POST', body = null, timeout = DEFAULT_TIMEOUT } = options;

    // Get auth headers (auto-authenticates if needed)
    const auth = await this.getAuthHeaders();
    if (auth.error) return auth.error;

    const url = `${CLOUD_API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...auth.headers,
    };

    try {
      const response = await this._makeCloudRequest(url, { method, headers, body, timeout });

      // Handle 401 — token expired, refresh and retry once
      if (response.statusCode === 401) {
        const refreshResult = await this.refreshToken();
        if (refreshResult.code !== 0) {
          return this._errorResponse(-4, 'Multilogin token refresh failed: re-authentication required');
        }

        // Retry with new token
        const retryHeaders = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        };

        const retryResponse = await this._makeCloudRequest(url, {
          method, headers: retryHeaders, body, timeout,
        });

        return this._parseCloudResponse(retryResponse);
      }

      return this._parseCloudResponse(response);
    } catch (error) {
      return this._handleMultiloginError(error, 'cloud');
    }
  }

  /**
   * Make an authenticated request to the Multilogin Launcher (local).
   * Uses HTTPS with rejectUnauthorized: false for self-signed cert.
   * 
   * @param {string} endpoint - Full launcher URL path
   * @param {object} [options={}] - Request options
   * @param {string} [options.method='GET'] - HTTP method
   * @param {number} [options.timeout=START_TIMEOUT] - Request timeout in ms
   * @returns {Promise<{code: number, message: string, data: any}>} Standardized response
   */
  async _launcherRequest(endpoint, options = {}) {
    const { method = 'GET', body = null, timeout = START_TIMEOUT } = options;

    const url = `${LAUNCHER_BASE}${endpoint}`;

    // STRATEGY: Try launcher WITHOUT auth first (Multilogin launcher manages its own
    // session internally when the app is running & logged in — cloud token not required).
    // Only fall back to cloud auth if launcher explicitly returns 401.
    try {
      const noAuthHeaders = { 'Content-Type': 'application/json' };

      // If we already have a valid token, include it — but don't block on re-auth
      if (this.token && Date.now() < this.tokenExpiresAt) {
        noAuthHeaders['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await this._makeLauncherRequest(url, {
        method, headers: noAuthHeaders, body, timeout,
      });

      // Launcher returned 401 — try cloud auth once
      if (response.statusCode === 401) {
        console.log('[multilogin] Launcher returned 401 — attempting cloud auth...');
        const authResult = await this.authenticate();
        if (authResult.code !== 0) {
          return this._errorResponse(-4, `Launcher requires auth but cloud signin failed: ${authResult.message}`);
        }
        const authHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        };
        const retryResponse = await this._makeLauncherRequest(url, {
          method, headers: authHeaders, body, timeout,
        });
        return this._parseLauncherResponse(retryResponse);
      }

      return this._parseLauncherResponse(response);
    } catch (error) {
      // Launcher-specific connection error
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNRESET' || error.code === 'TIMEOUT' ||
          error.code === 'ENOTFOUND') {
        return this._errorResponse(-1, 'Multilogin launcher must be connected');
      }
      return this._handleMultiloginError(error, 'launcher');
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MULTILOGIN RESIDENTIAL PROXY GENERATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Generate Multilogin residential proxy credentials.
   * Calls https://profile-proxy.multilogin.com/v1/proxy/connection_url
   * Returns host:port:username:password parsed into object.
   *
   * @param {string} [country='us'] - Country code (us, gb, de, etc.)
   * @param {string} [city=''] - City name (optional)
   * @param {string} [region=''] - Region/state name (optional)
   * @returns {Promise<{success: boolean, proxy?: object, error?: string}>}
   */
  async _generateMultiloginProxy(country = 'us', city = '', region = '') {
    const auth = await this.getAuthHeaders();
    if (auth.error) {
      return { success: false, error: auth.error.message || 'Auth failed' };
    }

    const url = `${PROXY_API_BASE}/v1/proxy/connection_url`;
    const payload = {
      country,
      region: region || '',
      city: city || '',
      protocol: 'socks5',   // socks5 handles all traffic types
      sessionType: 'sticky', // sticky = same IP for session duration
      IPTTL: 0,              // 0 = keep as long as possible (up to 24h)
      quality: 'medium',     // medium = balance of speed and quality
    };

    try {
      const response = await this._makeCloudRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...auth.headers,
        },
        body: payload,
        timeout: DEFAULT_TIMEOUT,
      });

      // Response: { data: "host:port:username:password" }
      if (response.statusCode === 201 && response.body && response.body.data) {
        const parts = String(response.body.data).split(':');
        if (parts.length >= 4) {
          const proxy = {
            host: parts[0],
            port: parseInt(parts[1], 10),
            username: parts[2],
            password: parts.slice(3).join(':'), // password may contain colons
            type: 'socks5',
            protocol: 'socks5',
            server: parts[0], // alias for compatibility
          };
          console.log(`[multilogin] Generated residential proxy: ${proxy.host}:${proxy.port} (${country})`);
          return { success: true, proxy };
        }
      }

      const errMsg = (response.body && response.body.message)
        || `Proxy generation failed (status ${response.statusCode})`;
      console.error(`[multilogin] Proxy generation failed: ${errMsg}`);
      return { success: false, error: errMsg };
    } catch (err) {
      console.error(`[multilogin] Proxy generation error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FINGERPRINT PAYLOAD MAPPING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Build Multilogin-specific fingerprint payload from ExtendedFingerprintConfig.
   * Maps unified config fields to Multilogin's nested fingerprint object structure.
   * Omits undefined/empty fields from the payload so the provider applies its own defaults.
   * 
   * Validates: Requirements 4.3, 4.4, 4.6
   * 
   * @param {import('../services/fingerprintData.cjs').ExtendedFingerprintConfig} config - Unified fingerprint config
   * @returns {object} Multilogin fingerprint payload object
   */
  /**
   * BUG FIX: Build Multilogin X flags from fingerprintConfig
   * Determines what values are real vs masked
   * @param {object} fpConfig - Fingerprint configuration (canvas, webrtc, timezone, screen, navigator)
   * @returns {object} Multilogin X flags for the profile
   */
  buildFlagsFromConfig(fpConfig) {
    // Complete flags set — sourced from official Multilogin GitHub example
    // Values: 'mask' = spoofed/hidden, 'natural' = real noise, 'custom' = our value, 'disabled' = off
    const isReal = !fpConfig || (
      fpConfig.canvas === 'real' &&
      fpConfig.webrtc === 'real' &&
      fpConfig.timezone === 'real' &&
      fpConfig.screen === 'real' &&
      fpConfig.navigator === 'real'
    );

    if (isReal) {
      // "Real" mode — YouTube-friendly: natural noise, custom timezone/location
      return {
        audio_masking: 'natural',        // Real audio with natural noise
        fonts_masking: 'natural',        // Real fonts
        geolocation_masking: 'custom',   // Use our geo coordinates
        geolocation_popup: 'allow',      // Don't block geo prompts
        graphics_masking: 'natural',     // Real GPU info with natural noise
        graphics_noise: 'natural',       // Natural WebGL noise
        localization_masking: 'custom',  // Use our language/locale
        media_devices_masking: 'natural',// Real media devices
        navigator_masking: 'custom',     // Use our user agent
        ports_masking: 'mask',           // Hide open ports (security)
        screen_masking: 'natural',       // Real screen resolution
        timezone_masking: 'custom',      // Use proxy state timezone
        webrtc_masking: 'natural',       // Natural WebRTC (real IP via proxy)
        proxy_masking: 'custom',         // Show proxy info normally
        canvas_noise: 'natural',         // Natural canvas noise (was: disabled)
      };
    }

    // Custom config — apply per-field settings
    return {
      audio_masking: 'natural',
      fonts_masking: fpConfig.navigator === 'real' ? 'natural' : 'mask',
      geolocation_masking: 'custom',
      geolocation_popup: 'allow',
      graphics_masking: fpConfig.canvas === 'real' ? 'natural' : 'mask',
      graphics_noise: fpConfig.canvas === 'real' ? 'natural' : 'mask',
      localization_masking: fpConfig.timezone === 'real' ? 'custom' : 'mask',
      media_devices_masking: 'natural',
      navigator_masking: fpConfig.navigator === 'real' ? 'custom' : 'mask',
      ports_masking: 'mask',
      screen_masking: fpConfig.screen === 'real' ? 'natural' : 'mask',
      timezone_masking: fpConfig.timezone === 'real' ? 'custom' : 'mask',
      webrtc_masking: fpConfig.webrtc === 'real' ? 'natural' : 'mask',
      proxy_masking: 'custom',
      canvas_noise: fpConfig.canvas === 'real' ? 'natural' : 'mask',
    };
  }

  buildFingerprintPayload(config) {
    if (!config) return {};

    const fingerprint = {};

    // timezone.zone — Multilogin X requires { zone: "..." } not { value: "..." }
    if (config.timezone) {
      fingerprint.timezone = { zone: config.timezone };
    }

    // language.list — Multilogin X uses array format
    if (config.language) {
      fingerprint.language = { list: [config.language] };
    }

    // geolocation — skipped intentionally; proxy provides geographic routing.
    // Multilogin X geolocation fingerprint requires many fields (public_ip, etc.)
    // and causes validation errors. The proxy's exit IP already sets location.

    // webrtc — ANY webrtc field requires public_ip which we can't know for residential proxies
    // Skip entirely; Multilogin uses its own default webrtc handling

    // canvas (mode + seed)
    if (config.canvasNoise && config.canvasNoise.seed) {
      fingerprint.canvas = { mode: 'noise', seed: config.canvasNoise.seed };
    }

    // webgl (mode + seed)
    if (config.webGLNoise && config.webGLNoise.seed) {
      fingerprint.webgl = { mode: 'noise', seed: config.webGLNoise.seed };
    }

    // audio (mode + seed)
    if (config.audioContextNoise && config.audioContextNoise.seed) {
      fingerprint.audio = { mode: 'noise', seed: config.audioContextNoise.seed };
    }

    // navigator — user_agent, hardware_concurrency, platform, device_memory (RAM)
    if (config.userAgent) {
      const platformMap = { Windows: 'Win32', macOS: 'MacIntel', Android: 'Linux armv8l', Linux: 'Linux x86_64' };
      const osKey = config.os || (config.userAgent.includes('Windows') ? 'Windows' : config.userAgent.includes('Mac') ? 'macOS' : config.userAgent.includes('Android') ? 'Android' : 'Windows');
      // device_memory must be a power of 2: 2, 4, 8 (browsers report limited values)
      const rawRam = config.ram || 8;
      const deviceMemory = rawRam >= 16 ? 8 : rawRam >= 8 ? 8 : rawRam >= 4 ? 4 : 2;
      fingerprint.navigator = {
        user_agent: config.userAgent,
        hardware_concurrency: config.cpu || 4,
        platform: platformMap[osKey] || 'Win32',
        device_memory: deviceMemory,
      };
    }

    // battery — unique per profile (level 0.0–1.0 float, charging bool)
    if (config.battery != null) {
      fingerprint.battery = {
        charging: config.batteryCharging !== undefined ? config.batteryCharging : false,
        level: parseFloat((config.battery / 100).toFixed(2)),
      };
    }

    // screen — requires width, height, AND pixel_ratio
    if (config.resolution) {
      const parts = String(config.resolution).split('x');
      if (parts.length === 2) {
        fingerprint.screen = {
          width: parseInt(parts[0], 10),
          height: parseInt(parts[1], 10),
          pixel_ratio: config.pixelRatio || 1,
        };
      }
    }

    // fonts — Multilogin X expects a flat array, not { families: [...] }
    if (config.fonts && Array.isArray(config.fonts) && config.fonts.length > 0) {
      fingerprint.fonts = config.fonts;
    }

    return fingerprint;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PROXY BUILDER HELPER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Build a normalized proxy object ready for Multilogin API.
   * Handles both SmartProxy (pre-filled credentials) and Multilogin residential
   * (type = 'multilogin_residential' — must generate credentials first).
   *
   * @param {object} proxyOptions - options.proxy from createProfile/createQuickProfile
   * @param {string} [apiFormat='cloud'] - 'cloud' (HTTP type uppercase) or 'quick' (socks5 lowercase)
   * @returns {Promise<{success: boolean, proxy?: object, error?: string}>}
   */
  async _resolveProxy(proxyOptions, apiFormat = 'cloud') {
    if (!proxyOptions) return { success: true, proxy: null };

    // SmartProxy — read credentials from .env (PROXY_SERVER, PROXY_PORT, PROXY_PREFIX, PROXY_PASSWORD)
    if (proxyOptions.type === 'smartproxy') {
      const server   = process.env.PROXY_SERVER   || 'us.smartproxy.net';
      const port     = parseInt(process.env.PROXY_PORT || '3120', 10);
      const prefix   = process.env.PROXY_PREFIX   || '';
      const password = process.env.PROXY_PASSWORD  || '';
      const sessionId = Math.random().toString(36).slice(2, 12);
      const country  = proxyOptions.country || 'us';
      const username = `${prefix}_country-${country}_session-${sessionId}`;
      console.log(`[multilogin] Using SmartProxy: ${server}:${port}`);
      if (apiFormat === 'quick') {
        return { success: true, proxy: { host: server, port, username, password, type: 'http' } };
      }
      return { success: true, proxy: { host: server, port, username, password, type: 'HTTP' } };
    }

    // Multilogin residential proxy — generate credentials first
    if (proxyOptions.type === 'multilogin_residential') {
      console.log('[multilogin] Generating Multilogin residential proxy...');
      const country = proxyOptions.country || 'us';
      const city    = proxyOptions.city    || '';
      const region  = proxyOptions.region  || '';
      const result  = await this._generateMultiloginProxy(country, city, region);
      if (!result.success) {
        return { success: false, error: `Multilogin proxy generation failed: ${result.error}` };
      }
      const p = result.proxy;
      if (apiFormat === 'quick') {
        // Quick Profile API uses lowercase socks5 at root level
        return { success: true, proxy: { host: p.host, port: p.port, username: p.username, password: p.password, type: 'socks5' } };
      }
      // Cloud API uses uppercase type inside parameters.proxy
      return { success: true, proxy: { host: p.host, port: p.port, username: p.username, password: p.password, type: 'SOCKS5' } };
    }

    // SmartProxy or external proxy — use provided credentials directly
    const rawType = (proxyOptions.protocol || proxyOptions.type || 'http').toLowerCase();
    if (apiFormat === 'quick') {
      return {
        success: true,
        proxy: {
          host: proxyOptions.server || proxyOptions.host,
          port: Number(proxyOptions.port),
          username: proxyOptions.username || '',
          password: proxyOptions.password || '',
          type: rawType, // lowercase for Quick Profile API
        },
      };
    }
    // Cloud API: uppercase type
    const typeMap = { http: 'HTTP', https: 'HTTPS', socks5: 'SOCKS5', socks4: 'SOCKS4' };
    return {
      success: true,
      proxy: {
        host: proxyOptions.server || proxyOptions.host,
        port: Number(proxyOptions.port),
        username: proxyOptions.username || '',
        password: proxyOptions.password || '',
        type: typeMap[rawType] || 'HTTP',
      },
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Create a PERSISTENT profile via Multilogin Cloud API.
   * POST https://api.multilogin.com/profile/create
   *
   * Supports both SmartProxy AND Multilogin residential proxy.
   * NOTE: Cloud API does not support fingerprint flags — profile persists after close.
   *
   * @param {object} options - Profile creation options
   * @returns {Promise<{code: number, message: string, data: object|null}>}
   */
  async createProfile(options) {
    // Validate folder_id
    if (!this.folderId) {
      return this._errorResponse(-5, 'MULTILOGIN_FOLDER_ID environment variable is not set');
    }

    // Resolve proxy — handles SmartProxy AND Multilogin residential
    const proxyResult = await this._resolveProxy(options && options.proxy, 'cloud');
    if (!proxyResult.success) {
      return this._errorResponse(-6, proxyResult.error);
    }

    // Map os string to Multilogin os_type (must be lowercase)
    const osMap = { Windows: 'windows', macOS: 'macos', Android: 'android', Linux: 'linux' };
    const osType = (options && options.os && osMap[options.os]) || 'windows';

    // browser_type must be 'mimic' (Chromium) or 'stealthfox' (Firefox)
    const browserType = (options && options.browserType === 'stealthfox') ? 'stealthfox' : 'mimic';

    const body = {
      folder_id: this.folderId,
      browser_type: browserType,
      os_type: osType,
      name: (options && options.name) || `Profile ${Date.now()}`,
      parameters: {},
    };

    // Add resolved proxy
    if (proxyResult.proxy) {
      body.parameters.proxy = proxyResult.proxy;
    }

    // ── Navigator: user agent + hardware concurrency + device memory ──
    // Set for ALL OS types so every Cloud profile gets a unique, OS-correct UA.
    if (options && options.fingerprint && options.fingerprint.userAgent) {
      const fp = options.fingerprint;
      const platformMap = { windows: 'Win32', macos: 'MacIntel', android: 'Linux armv8l' };
      const rawRam   = fp.ram || 8;
      const devMemory = rawRam >= 16 ? 8 : rawRam >= 8 ? 8 : rawRam >= 4 ? 4 : 2;
      body.parameters.navigator = {
        user_agent:           fp.userAgent,
        hardware_concurrency: fp.cpu  || 4,
        device_memory:        devMemory,
        platform:             platformMap[osType] || 'Win32',
      };
      console.log(`[multilogin] createProfile (Cloud) → UA: ${fp.userAgent.slice(0, 70)}...`);
    }

    // ── Screen: required for Android (Multilogin rejects pixel_ratio=1 for mobile) ──
    if (options && options.fingerprint && options.fingerprint.resolution) {
      const fp    = options.fingerprint;
      const parts = String(fp.resolution).split('x');
      if (parts.length === 2) {
        // For Android always use the device's real DPR. For desktop default to 1.
        const dpr = fp.pixelRatio || (osType === 'android' ? 2.625 : 1);
        body.parameters.screen = {
          width:       parseInt(parts[0], 10),
          height:      parseInt(parts[1], 10),
          pixel_ratio: dpr,
        };
        console.log(`[multilogin] createProfile (Cloud) → screen: ${fp.resolution} @ ${dpr}x`);
      }
    }

    console.log(`[multilogin] createProfile (Cloud) → proxy: ${proxyResult.proxy ? proxyResult.proxy.host + ':' + proxyResult.proxy.port : 'none'}`);

    const result = await this._authenticatedCloudRequest('/profile/create', { body });

    if (result.code === 0 && result.data) {
      const newId = (result.data.ids && result.data.ids[0])
        || result.data.profile_id
        || result.data.uuid
        || '';
      console.log(`[multilogin] Cloud profile created: ${newId}`);
      return this._successResponse('Profile created successfully', { id: newId });
    }

    return result;
  }

  /**
   * Create a QUICK profile via Local Launcher API.
   * POST https://launcher.mlx.yt:45001/api/v2/profile/quick
   *
   * Supports full fingerprint flags + both SmartProxy AND Multilogin residential proxy.
   * NOTE: Quick profiles are session-based — they disappear when closed.
   * Returns CDP port for automation.
   *
   * @param {object} options - Profile creation options
   * @returns {Promise<{code: number, message: string, data: object|null}>}
   */
  async createQuickProfile(options) {
    // Resolve proxy — handles SmartProxy AND Multilogin residential
    const proxyResult = await this._resolveProxy(options && options.proxy, 'quick');
    if (!proxyResult.success) {
      return this._errorResponse(-6, proxyResult.error);
    }

    // Map os string
    const osMap = { Windows: 'windows', macOS: 'macos', Android: 'android', Linux: 'linux' };
    const osType = (options && options.os && osMap[options.os]) || 'windows';

    // Build fingerprint payload
    let fingerprintPayload = {};
    if (options && options.fingerprint) {
      const fpConfig = { ...options.fingerprint, os: options.os };
      fingerprintPayload = this.buildFingerprintPayload(fpConfig);
    }

    // Quick Profile body structure (proxy at ROOT level, not inside parameters)
    const body = {
      browser_type: 'mimic',
      os_type: osType,
      is_headless: false,
      parameters: {
        flags: this.buildFlagsFromConfig(options && options.fingerprintConfig),
        fingerprint: fingerprintPayload,
      },
    };

    // Proxy goes at ROOT level for Quick Profile API
    if (proxyResult.proxy) {
      body.proxy = proxyResult.proxy;
    }

    console.log(`[multilogin] createQuickProfile (Local) → proxy: ${proxyResult.proxy ? proxyResult.proxy.host + ':' + proxyResult.proxy.port : 'none'}`);
    console.log(`[multilogin] Quick profile flags: canvas_noise=${body.parameters.flags.canvas_noise}, timezone=${body.parameters.flags.timezone_masking}`);

    const result = await this._launcherRequest('/api/v2/profile/quick', {
      method: 'POST',
      body,
      timeout: START_TIMEOUT,
    });

    if (result.code === 0 && result.data) {
      const cdpPort = result.data.port || result.data.cdp_port || result.data.cdpPort;
      const profileId = result.data.uuid || result.data.profile_id || result.data.id || '';
      console.log(`[multilogin] Quick profile created: uuid=${profileId}, cdpPort=${cdpPort}`);
      return this._successResponse('Quick profile created successfully', {
        id: profileId,
        cdpPort: parseInt(cdpPort, 10),
        isQuick: true,
      });
    }

    return result;
  }

  /**
   * Start a browser profile via Multilogin Launcher
   * GET https://launcher.mlx.yt:45001/api/v2/profile/f/{folder_id}/p/{profile_id}/start?automation_type=playwright
   *
   * @param {string} profileId - Multilogin profile_id
   * @returns {Promise<{code: number, message: string, data: {profileId: string, cdpPort: number}|null}>}
   */
  /**
   * Parse CDP port / URL from Multilogin launcher start response (shape varies by MLX version).
   * @private
   */
  _extractCdpFromLauncherData(data) {
    if (!data || typeof data !== 'object') {
      return { cdpPort: 0, cdpEndpoint: null };
    }

    const tryPort = (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    let cdpPort =
      tryPort(data.port)
      || tryPort(data.cdp_port)
      || tryPort(data.cdpPort)
      || tryPort(data.debug_port)
      || tryPort(data.debugPort);

    if (data.automation && typeof data.automation === 'object') {
      cdpPort = cdpPort || tryPort(data.automation.port) || tryPort(data.automation.cdp_port);
    }

    const wsRaw = data.web_socket_url
      || data.webSocketDebuggerUrl
      || data.ws_endpoint
      || data.wsEndpoint
      || data.browser_wse
      || data.browserWSE;

    let cdpEndpoint = null;
    if (typeof wsRaw === 'string' && wsRaw.length > 0) {
      if (wsRaw.startsWith('ws://') || wsRaw.startsWith('wss://')) {
        const m = wsRaw.match(/:(\d+)(?:\/|$)/);
        if (m) cdpPort = cdpPort || parseInt(m[1], 10);
        cdpEndpoint = `http://127.0.0.1:${cdpPort || m[1]}`;
      } else if (wsRaw.startsWith('http')) {
        cdpEndpoint = wsRaw;
        const m = wsRaw.match(/:(\d+)/);
        if (m) cdpPort = cdpPort || parseInt(m[1], 10);
      }
    }

    if (!cdpEndpoint && cdpPort > 0) {
      cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
    }

    return { cdpPort, cdpEndpoint };
  }

  async startProfile(profileId) {
    // Validate folder_id
    if (!this.folderId) {
      return this._errorResponse(-5, 'MULTILOGIN_FOLDER_ID environment variable is not set');
    }

    const endpoint = `/api/v2/profile/f/${this.folderId}/p/${profileId}/start?automation_type=playwright`;
    const result = await this._launcherRequest(endpoint, { timeout: START_TIMEOUT });

    if (result.code === 0 && result.data) {
      const { cdpPort, cdpEndpoint } = this._extractCdpFromLauncherData(result.data);
      if (!cdpPort || !cdpEndpoint) {
        console.error('[MultiloginProvider] Launcher response missing CDP port field. data:', JSON.stringify(result.data));
        return this._errorResponse(-1, 'Profile started but no CDP port in launcher response. Automation cannot attach — close profile in MLX and retry.');
      }
      return this._successResponse('Profile started successfully', {
        profileId: profileId,
        cdpPort,
        cdpEndpoint,
      });
    }

    // Profile already open (code -6 or "browser process is running" message)
    const alreadyRunning = result.code === -6 ||
      (result.message && /browser process is running|already running|already open/i.test(result.message));

    if (alreadyRunning) {
      console.log(`[MultiloginProvider] Profile ${profileId.slice(-4)} already open — trying direct CDP port via status...`);

      // Strategy 1: Try launcher status endpoint to get running profile's CDP port
      try {
        const statusResult = await this._launcherRequest(
          `/api/v2/profile/f/${this.folderId}/p/${profileId}`,
          { method: 'GET', timeout: DEFAULT_TIMEOUT }
        );
        if (statusResult.code === 0 && statusResult.data) {
          const { cdpPort, cdpEndpoint } = this._extractCdpFromLauncherData(statusResult.data);
          if (cdpPort && cdpEndpoint) {
            console.log(`[MultiloginProvider] Got CDP port ${cdpPort} from status for already-running profile`);
            return this._successResponse('Profile already running — attached to existing CDP', { profileId, cdpPort, cdpEndpoint });
          }
        }
      } catch {}

      // Strategy 2: Stop then restart after short wait
      console.log(`[MultiloginProvider] Status failed — stopping profile ${profileId.slice(-4)} and restarting...`);
      await this.stopProfile(profileId);
      await new Promise((r) => setTimeout(r, 4000));
      const retry = await this._launcherRequest(endpoint, { timeout: START_TIMEOUT });
      if (retry.code === 0 && retry.data) {
        const { cdpPort, cdpEndpoint } = this._extractCdpFromLauncherData(retry.data);
        if (cdpPort && cdpEndpoint) {
          return this._successResponse('Profile started successfully (after stop+retry)', { profileId, cdpPort, cdpEndpoint });
        }
      }

      return this._errorResponse(-6, 'Profile is open in Multilogin but CDP port could not be determined. Close it manually in Multilogin app and retry.');
    }

    return result;
  }

  /**
   * Stop a running browser profile via Multilogin Launcher
   * GET https://launcher.mlx.yt:45001/api/v1/profile/stop?profile_id={profileId}
   * 
   * @param {string} profileId - Multilogin profile_id
   * @returns {Promise<{code: number, message: string, data: object|null}>}
   */
  async stopProfile(profileId) {
    // Playwright's browser.close() (called in agent.disconnect()) already sends
    // Browser.close via CDP which terminates the Chrome process. The launcher stop
    // endpoint (/api/v1/profile/stop) returns 404 in current Multilogin versions —
    // treat any non-0 / 404 response as success since the process is already gone.
    try {
      const endpoint = `/api/v1/profile/stop?profile_id=${encodeURIComponent(profileId)}`;
      const result = await this._launcherRequest(endpoint, { method: 'GET', timeout: STOP_TIMEOUT });
      if (result.code === 0) {
        return this._successResponse('Profile stopped successfully', { profileId });
      }
      // 404 or "not found" = profile already closed by browser.close() — treat as success
      return this._successResponse('Profile closed (browser.close handled termination)', { profileId });
    } catch (err) {
      return this._successResponse('Profile closed (browser.close handled termination)', { profileId });
    }
  }

  /**
   * Delete a browser profile via Multilogin Cloud API
   * POST https://api.multilogin.com/profile/remove
   * 
   * @param {string} profileId - Multilogin profile_id
   * @returns {Promise<{code: number, message: string, data: object|null}>}
   */
  async deleteProfile(profileId) {
    const body = { ids: [profileId] };
    const result = await this._authenticatedCloudRequest('/profile/remove', { body });

    if (result.code === 0) {
      return this._successResponse('Profile deleted successfully', { profileId });
    }

    return result;
  }

  /**
   * List browser profiles with pagination via Multilogin Cloud API
   * POST https://api.multilogin.com/profile/search
   * 
   * @param {number} [pageNo=1] - Page number
   * @param {number} [pageSize=50] - Items per page (1-100)
   * @returns {Promise<{code: number, message: string, data: {profiles: Array}|null}>}
   */
  async listProfiles(pageNo = 1, pageSize = 50) {
    // Validate folder_id
    if (!this.folderId) {
      return this._errorResponse(-5, 'MULTILOGIN_FOLDER_ID environment variable is not set');
    }

    // Clamp pageSize to 1-100 range
    const limit = Math.max(1, Math.min(100, pageSize));
    const offset = (pageNo - 1) * limit;

    const body = {
      folder_id: this.folderId,
      search_text: '',
      offset: offset,
      limit: limit,
    };

    const result = await this._authenticatedCloudRequest('/profile/search', { body });

    if (result.code === 0 && result.data) {
      // Map Multilogin profiles to standardized format
      // API returns: { profiles: [...], total_count: N }
      const profileList = result.data.profiles || [];
      const profiles = (Array.isArray(profileList) ? profileList : []).map((item) => {
        const osHint = item.os_type || item.os || null;
        return {
          id: item.id || item.profile_id || item.uuid || '',
          name: item.name || '',
          status: item.in_use_by ? 'running' : 'stopped',
          debugPort: null,
          browserType: 'multilogin',
          osName: osHint,
          os: osHint,
        };
      });

      const total = result.data.total_count || result.data.total || profiles.length;
      return this._successResponse('Profiles retrieved successfully', {
        profiles,
        total,
        pages: Math.ceil(total / limit) || 1,
        current: pageNo,
      });
    }

    return result;
  }

  /**
   * Get the status of a specific profile
   * @param {string} profileId - Multilogin profile_id
   * @returns {Promise<{code: number, message: string, data: object|null}>}
   */
  async getProfileStatus(profileId) {
    // Use profile search with specific ID to get status
    const body = {
      folder_id: this.folderId,
      search_text: '',
      profile_ids: [profileId],
      offset: 0,
      limit: 1,
    };

    const result = await this._authenticatedCloudRequest('/profile/search', { body });

    if (result.code === 0 && result.data) {
      const profileList = result.data.profiles || result.data || [];
      const profile = Array.isArray(profileList) && profileList.length > 0 ? profileList[0] : null;

      if (profile) {
        return this._successResponse('Profile status retrieved', {
          id: profile.id || profile.profile_id || profile.uuid || profileId,
          name: profile.name || '',
          status: profile.in_use_by ? 'running' : 'stopped',
          debugPort: null,
          browserType: 'multilogin',
        });
      }

      return this._errorResponse(-1, `Profile ${profileId} not found`);
    }

    return result;
  }

  /**
   * Update proxy on a cloud profile without full recreate.
   * POST https://api.multilogin.com/profile/update
   */
  async updateProfileProxy(profileId, proxy) {
    if (!proxy || !proxy.server || !proxy.port) {
      return this._errorResponse(-5, 'Invalid proxy: server and port required');
    }
    const body = {
      profile_id: profileId,
      parameters: {
        flags: { proxy_masking: 'custom' },
        proxy: {
          host: proxy.server,
          port: Number(proxy.port),
          username: proxy.username || '',
          password: proxy.password || '',
          type: 'http',
        },
      },
    };
    const result = await this._authenticatedCloudRequest('/profile/update', { body });
    if (result.code === 0) {
      console.log(`[multilogin] Proxy updated for profile ${profileId}`);
    }
    return result;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INTERNAL HELPERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Make an HTTPS request to the Multilogin Cloud API.
   * Uses standard HTTPS (valid cert on api.multilogin.com).
   * 
   * @param {string} url - Full URL
   * @param {object} options - Request options
   * @returns {Promise<{statusCode: number, headers: object, body: any}>}
   * @private
   */
  async _makeCloudRequest(url, options) {
    return this.makeRequest(url, options);
  }

  /**
   * Make an HTTPS request to the Multilogin Launcher.
   * Uses rejectUnauthorized: false for self-signed certificate.
   * 
   * @param {string} url - Full launcher URL
   * @param {object} options - Request options
   * @returns {Promise<{statusCode: number, headers: object, body: any}>}
   * @private
   */
  _makeLauncherRequest(url, options) {
    return new Promise((resolve, reject) => {
      const { URL } = require('url');
      const parsedUrl = new URL(url);

      const payload = options.body
        ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
        : null;

      const requestHeaders = { ...options.headers };
      if (payload) {
        if (!requestHeaders['Content-Type']) {
          requestHeaders['Content-Type'] = 'application/json';
        }
        requestHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: requestHeaders,
        timeout: options.timeout || START_TIMEOUT,
        rejectUnauthorized: false, // Self-signed cert on launcher
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let body;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const err = new Error(`Launcher request timeout after ${options.timeout || START_TIMEOUT}ms: ${url}`);
        err.code = 'TIMEOUT';
        reject(err);
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Parse Multilogin Cloud API response into standardized format.
   * 
   * @param {object} response - Raw HTTP response
   * @returns {{code: number, message: string, data: any}}
   * @private
   */
  _parseCloudResponse(response) {
    const result = response.body;

    // Log only on errors to avoid leaking credentials/profile data in production logs
    if (response.statusCode >= 400) {
      console.warn('[multilogin] Cloud API error:', response.statusCode, result?.status?.message || '');
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (result && typeof result === 'object') {
        // Multilogin format: { status: { http_code, message, error_code }, data: {...} }
        const httpCode = result.status && result.status.http_code
          ? result.status.http_code
          : response.statusCode;
        const msg = (result.status && result.status.message) || result.message || 'OK';
        if (httpCode >= 200 && httpCode < 300) {
          return {
            code: 0,
            message: msg.slice(0, 256),
            data: result.data !== undefined ? result.data : result,
          };
        }
        return this._errorResponse(-1, msg.slice(0, 256));
      }
      return this._successResponse('OK', result);
    }

    // Error response
    const msg = (result && result.status && result.status.message)
      || (result && result.message)
      || `Multilogin API error (HTTP ${response.statusCode})`;
    return this._errorResponse(-1, msg);
  }

  /**
   * Parse Multilogin Launcher response into standardized format.
   * 
   * @param {object} response - Raw HTTP response
   * @returns {{code: number, message: string, data: any}}
   * @private
   */
  _parseLauncherResponse(response) {
    const result = response.body;

    // Log launcher errors only (not full body — avoids leaking proxy credentials)
    if (response.statusCode >= 400 || (result && result.status && result.status.http_code >= 400)) {
      console.warn('[multilogin] Launcher error:', response.statusCode, result?.status?.message || result?.status?.error_code || '');
    }

    // Multilogin launcher returns { status: { error_code, http_code, message }, data: {...} }
    const httpCode = (result && result.status && result.status.http_code)
      ? result.status.http_code
      : response.statusCode;
    const errorCode = (result && result.status && result.status.error_code) || '';
    const msg = (result && result.status && result.status.message)
      || (result && result.message)
      || (response.statusCode >= 200 && response.statusCode < 300 ? 'OK' : `Launcher error HTTP ${response.statusCode}`);

    if (httpCode >= 200 && httpCode < 300) {
      return {
        code: 0,
        message: msg.slice(0, 256),
        data: (result && result.data) ? result.data : result,
      };
    }

    // Special error codes
    return this._errorResponse(errorCode === 'PROFILE_ALREADY_RUNNING' ? -6 : -1, msg);
  }

  /**
   * Handle Multilogin-specific errors with appropriate messaging.
   * 
   * @param {Error} error - The error to handle
   * @param {string} context - Context string ('cloud', 'launcher', 'authenticate')
   * @returns {{code: number, message: string, data: null}}
   * @private
   */
  _handleMultiloginError(error, context) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' || error.code === 'TIMEOUT' ||
        error.code === 'ENOTFOUND') {
      if (context === 'launcher') {
        return this._errorResponse(-1, 'Multilogin launcher must be connected');
      }
      return this._errorResponse(-1, 'Multilogin API is not reachable');
    }
    return this.handleError(error);
  }

  /**
   * Map Multilogin status strings to standardized status enum
   * @param {string} status - Multilogin status value
   * @returns {'running'|'stopped'|'error'|'unknown'}
   * @private
   */
  _mapStatus(status) {
    if (!status) return 'unknown';
    const s = String(status).toLowerCase();
    if (s === 'running' || s === 'active' || s === 'started') return 'running';
    if (s === 'stopped' || s === 'closed' || s === 'idle' || s === 'ready') return 'stopped';
    if (s === 'error' || s === 'failed') return 'error';
    return 'unknown';
  }
}

// Standalone buildFingerprintPayload for direct access
function buildFingerprintPayload(config) {
  const instance = new MultiloginProvider();
  return instance.buildFingerprintPayload(config);
}

module.exports = { MultiloginProvider, buildFingerprintPayload };
