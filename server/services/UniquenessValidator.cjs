'use strict';

/**
 * UniquenessValidator Service
 * 
 * Validates fingerprint and proxy uniqueness across all active profiles.
 * Ensures no two profiles share the same fingerprint combination or proxy session ID.
 * 
 * Fingerprint uniqueness is determined by the COMBINATION of:
 *   - userAgent
 *   - resolution
 *   - webGLMeta (vendor + renderer concatenated)
 *   - geolocation (lat/lng rounded to 4 decimal places)
 * 
 * Proxy uniqueness is determined by session ID only (all proxies share same server:port).
 * 
 * @module UniquenessValidator
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Profile statuses that should be checked for uniqueness conflicts.
 * Only active profiles (not deleted/archived) are considered.
 */
const ACTIVE_STATUSES = ['running', 'stopped', 'starting', 'error', 'recreating'];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITY HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Round a number to 4 decimal places for geolocation comparison.
 * @param {number} value
 * @returns {number}
 */
function roundTo4Decimals(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Extract the fingerprint comparison key from a fingerprint config.
 * The key is the combination of (userAgent, resolution, webGLMeta vendor+renderer, geolocation).
 * 
 * @param {object} config - Fingerprint config object
 * @returns {{ userAgent: string, resolution: string, webGLKey: string, geoKey: string }}
 */
function extractComparisonFields(config) {
  const userAgent = config.userAgent || '';
  const resolution = config.resolution || '';
  const webGLKey = (config.webGLMeta ? (config.webGLMeta.vendor || '') + (config.webGLMeta.renderer || '') : '');
  
  let geoLat = 0;
  let geoLng = 0;
  if (config.geolocation) {
    geoLat = roundTo4Decimals(config.geolocation.lat || 0);
    geoLng = roundTo4Decimals(config.geolocation.lng || 0);
  }
  const geoKey = `${geoLat},${geoLng}`;

  return { userAgent, resolution, webGLKey, geoKey };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNIQUENESS VALIDATOR CLASS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class UniquenessValidator {
  /**
   * Validate that a fingerprint config is unique across all active profiles.
   * 
   * Checks the COMBINATION of:
   *   - userAgent
   *   - resolution
   *   - webGLMeta vendor + renderer (concatenated)
   *   - geolocation (lat/lng rounded to 4 decimal places)
   * 
   * A conflict occurs when ALL FOUR fields match an existing profile's combination exactly.
   * 
   * @param {object} config - The ExtendedFingerprintConfig to validate
   * @param {object[]} existingProfiles - Array of existing profile objects with fingerprint and status fields
   * @returns {{ unique: boolean, conflictField?: string, conflictProfileId?: string }}
   */
  validateFingerprint(config, existingProfiles) {
    if (!config || !existingProfiles || !Array.isArray(existingProfiles)) {
      return { unique: true };
    }

    const newFields = extractComparisonFields(config);

    for (const profile of existingProfiles) {
      // Only check against active profiles
      if (!profile.status || !ACTIVE_STATUSES.includes(profile.status)) {
        continue;
      }

      // Skip profiles without fingerprint data
      if (!profile.fingerprint) {
        continue;
      }

      const existingFields = extractComparisonFields(profile.fingerprint);

      // Check if ALL four fields match (combination uniqueness)
      const userAgentMatch = newFields.userAgent === existingFields.userAgent;
      const resolutionMatch = newFields.resolution === existingFields.resolution;
      const webGLMatch = newFields.webGLKey === existingFields.webGLKey;
      const geoMatch = newFields.geoKey === existingFields.geoKey;

      if (userAgentMatch && resolutionMatch && webGLMatch && geoMatch) {
        return {
          unique: false,
          conflictField: 'fingerprint_combination',
          conflictProfileId: profile.id || profile._id || undefined,
        };
      }
    }

    return { unique: true };
  }

  /**
   * Validate that a proxy session ID is unique across all active profiles.
   * 
   * Since all proxies share the same server:port, uniqueness is enforced
   * by session ID only.
   * 
   * @param {string} sessionId - The proxy session ID to validate
   * @param {object[]} existingProfiles - Array of existing profile objects with proxy and status fields
   * @returns {{ unique: boolean, conflictField?: string, conflictProfileId?: string }}
   */
  validateProxy(sessionId, existingProfiles) {
    if (!sessionId || !existingProfiles || !Array.isArray(existingProfiles)) {
      return { unique: true };
    }

    for (const profile of existingProfiles) {
      // Only check against active profiles
      if (!profile.status || !ACTIVE_STATUSES.includes(profile.status)) {
        continue;
      }

      // Skip profiles without proxy data
      if (!profile.proxy) {
        continue;
      }

      // Check session ID match
      const existingSessionId = profile.proxy.sessionId;
      if (existingSessionId && existingSessionId === sessionId) {
        return {
          unique: false,
          conflictField: 'proxy_sessionId',
          conflictProfileId: profile.id || profile._id || undefined,
        };
      }
    }

    return { unique: true };
  }
}

// Export a singleton instance and the class for testing
const uniquenessValidator = new UniquenessValidator();

module.exports = uniquenessValidator;
module.exports.UniquenessValidator = UniquenessValidator;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
