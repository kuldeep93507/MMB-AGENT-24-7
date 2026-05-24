'use strict';

/**
 * ProfileFactory — Auto create/delete Multilogin profiles for v2 agent lifecycle
 *
 * Lifecycle per agent:
 *   createAndStart() → profile create → proxy assign → start → return cdpPort
 *   stopAndDelete()  → stop browser → delete profile → done
 *
 * Proxy: Always US or UK (random per call)
 * Naming: MMB AGENT 01, MMB AGENT 02...
 */

const path = require('path');

// Reuse existing MultiloginProvider
const { MultiloginProvider } = require('../../server/providers/MultiloginProvider.cjs');

const COUNTRIES = ['us', 'gb']; // US and UK only

function randomCountry() {
  return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class ProfileFactory {
  constructor() {
    this.provider = new MultiloginProvider();
  }

  /**
   * Create a fresh Multilogin profile + start it
   * Returns { profileId, cdpPort, cdpEndpoint } on success
   */
  async createAndStart(agentName) {
    const country = randomCountry();
    const profileName = agentName || `MMB AGENT ${Date.now()}`;

    console.log(`[ProfileFactory] Creating profile: ${profileName} (proxy: ${country.toUpperCase()})`);

    // Step 1: Create cloud profile with SmartProxy
    const createResult = await this.provider.createProfile({
      name: profileName,
      os: 'Windows',
      browserType: 'mimic',
      proxy: {
        type: 'smartproxy',
        country,
      },
    });

    if (createResult.code !== 0 || !createResult.data?.id) {
      throw new Error(`Profile create failed: ${createResult.message}`);
    }

    const profileId = createResult.data.id;
    console.log(`[ProfileFactory] Profile created: ${profileId}`);

    // Step 2: Wait briefly for Multilogin to register
    await sleep(3000);

    // Step 3: Start the profile (get CDP port)
    let startResult = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[ProfileFactory] Starting profile ${profileId} (attempt ${attempt}/3)...`);
      startResult = await this.provider.startProfile(profileId);
      if (startResult.code === 0 && startResult.data?.cdpPort) break;
      if (attempt < 3) await sleep(5000);
    }

    if (!startResult || startResult.code !== 0 || !startResult.data?.cdpPort) {
      // Clean up — delete the profile we just created
      await this.provider.deleteProfile(profileId).catch(() => {});
      throw new Error(`Profile start failed: ${startResult?.message || 'No CDP port'}`);
    }

    const { cdpPort, cdpEndpoint } = startResult.data;
    console.log(`[ProfileFactory] Profile started: ${profileId} on CDP port ${cdpPort}`);

    return { profileId, cdpPort, cdpEndpoint };
  }

  /**
   * Stop browser + delete profile completely
   * Safe to call even if already stopped
   */
  async stopAndDelete(profileId) {
    if (!profileId) return;

    console.log(`[ProfileFactory] Stopping profile: ${profileId}`);

    // Step 1: Stop browser gracefully
    try {
      await this.provider.stopProfile(profileId);
      await sleep(2000);
    } catch (err) {
      console.warn(`[ProfileFactory] Stop warning: ${err.message}`);
    }

    // Step 2: Delete profile from Multilogin cloud
    console.log(`[ProfileFactory] Deleting profile: ${profileId}`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await this.provider.deleteProfile(profileId);
        if (result.code === 0) {
          console.log(`[ProfileFactory] Profile deleted: ${profileId}`);
          return true;
        }
        console.warn(`[ProfileFactory] Delete attempt ${attempt} failed: ${result.message}`);
      } catch (err) {
        console.warn(`[ProfileFactory] Delete attempt ${attempt} error: ${err.message}`);
      }
      if (attempt < 3) await sleep(3000);
    }

    console.error(`[ProfileFactory] Could not delete profile ${profileId} after 3 attempts`);
    return false;
  }
}

module.exports = { ProfileFactory };
