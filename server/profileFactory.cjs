'use strict';

/**
 * ProfileFactory — Ephemeral Multilogin profiles for MMB YT AGENT 24/7
 */

const { MultiloginProvider } = require('./providers/MultiloginProvider.cjs');
const { normalizeProxyCountry } = require('./services/proxyCountry.cjs');

const COUNTRIES = ['us', 'gb'];

function randomCountry() {
  return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class ProfileFactory {
  constructor(options = {}) {
    this.provider = new MultiloginProvider();
    this.proxyType = options.proxyType || 'smartproxy';
  }

  setProxyType(type) {
    this.proxyType = type === 'multilogin' ? 'multilogin' : 'smartproxy';
  }

  async createAndStart(agentName) {
    const profileName = agentName || `MMB YT AGENT ${Date.now()}`;
    const country = normalizeProxyCountry(randomCountry());

    const proxyOpts = this.proxyType === 'multilogin'
      ? { type: 'multilogin_residential', country }
      : { type: 'smartproxy', country: 'us' };

    console.log(`[ProfileFactory] Creating ${profileName} (proxy: ${this.proxyType}${this.proxyType === 'smartproxy' ? `/${country.toUpperCase()}` : ''})`);

    const createResult = await this.provider.createProfile({
      name: profileName,
      os: 'Windows',
      browserType: 'mimic',
      proxy: proxyOpts,
    });

    if (createResult.code !== 0 || !createResult.data?.id) {
      throw new Error(`Profile create failed: ${createResult.message}`);
    }

    const profileId = createResult.data.id;
    await sleep(3000);

    let startResult = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      startResult = await this.provider.startProfile(profileId);
      if (startResult.code === 0 && startResult.data?.cdpPort) break;
      if (attempt < 3) await sleep(5000);
    }

    if (!startResult || startResult.code !== 0 || !startResult.data?.cdpPort) {
      await this.provider.deleteProfile(profileId).catch(() => {});
      throw new Error(`Profile start failed: ${startResult?.message || 'No CDP port'}`);
    }

    const { cdpPort, cdpEndpoint } = startResult.data;
    return { profileId, cdpPort, cdpEndpoint };
  }

  async stopAndDelete(profileId) {
    if (!profileId) return false;

    try {
      await this.provider.stopProfile(profileId);
      await sleep(2000);
    } catch (err) {
      console.warn(`[ProfileFactory] Stop warning: ${err.message}`);
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await this.provider.deleteProfile(profileId);
        if (result.code === 0) return true;
      } catch (err) {
        console.warn(`[ProfileFactory] Delete attempt ${attempt}: ${err.message}`);
      }
      if (attempt < 3) await sleep(3000);
    }
    return false;
  }
}

module.exports = { ProfileFactory };
