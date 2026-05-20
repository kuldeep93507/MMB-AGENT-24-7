'use strict';

const { MultiloginProvider } = require('../providers/MultiloginProvider.cjs');

describe('MultiloginProvider.buildFingerprintPayload', () => {
  let provider;

  beforeEach(() => {
    process.env.MULTILOGIN_EMAIL = 'test@test.com';
    process.env.MULTILOGIN_PASSWORD = 'testpass';
    process.env.MULTILOGIN_FOLDER_ID = 'test-folder-id';
    provider = new MultiloginProvider();
  });

  afterEach(() => {
    delete process.env.MULTILOGIN_EMAIL;
    delete process.env.MULTILOGIN_PASSWORD;
    delete process.env.MULTILOGIN_FOLDER_ID;
  });

  test('timezone uses Multilogin X shape { zone }', () => {
    const payload = provider.buildFingerprintPayload({ timezone: 'America/Chicago' });
    expect(payload.timezone).toEqual({ zone: 'America/Chicago' });
  });

  test('language uses { list: [...] }', () => {
    const payload = provider.buildFingerprintPayload({ language: 'en-US' });
    expect(payload.language).toEqual({ list: ['en-US'] });
  });

  test('does not emit geolocation (proxy/IP drives geo)', () => {
    const payload = provider.buildFingerprintPayload({
      geolocation: { lat: 32.7767, lng: -96.797 },
    });
    expect(payload).not.toHaveProperty('geolocation');
  });

  test('does not emit webrtc (API needs public_ip)', () => {
    const payload = provider.buildFingerprintPayload({ webRTC: 'disabled' });
    expect(payload).not.toHaveProperty('webrtc');
  });

  test('canvas / webgl / audio noise when seeds present', () => {
    const payload = provider.buildFingerprintPayload({
      canvasNoise: { enabled: true, seed: 'abc12345' },
      webGLNoise: { enabled: true, seed: 'def67890' },
      audioContextNoise: { enabled: true, seed: 'ghi11223' },
    });
    expect(payload.canvas).toEqual({ mode: 'noise', seed: 'abc12345' });
    expect(payload.webgl).toEqual({ mode: 'noise', seed: 'def67890' });
    expect(payload.audio).toEqual({ mode: 'noise', seed: 'ghi11223' });
  });

  test('navigator uses snake_case keys', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0';
    const payload = provider.buildFingerprintPayload({
      userAgent: ua,
      os: 'Windows',
      cpu: 8,
      ram: 16,
    });
    expect(payload.navigator).toMatchObject({
      user_agent: ua,
      hardware_concurrency: 8,
      platform: 'Win32',
      device_memory: 8,
    });
  });

  test('screen parses resolution into width/height/pixel_ratio', () => {
    const payload = provider.buildFingerprintPayload({
      resolution: '1920x1080',
      pixelRatio: 2,
    });
    expect(payload.screen).toEqual({
      width: 1920,
      height: 1080,
      pixel_ratio: 2,
    });
  });

  test('fonts are a flat array', () => {
    const fonts = ['Arial', 'Verdana'];
    const payload = provider.buildFingerprintPayload({ fonts });
    expect(payload.fonts).toEqual(fonts);
  });

  test('returns {} when config is null/undefined', () => {
    expect(provider.buildFingerprintPayload(null)).toEqual({});
    expect(provider.buildFingerprintPayload(undefined)).toEqual({});
  });

  test('omits empty optional sections', () => {
    const payload = provider.buildFingerprintPayload({
      timezone: 'America/New_York',
      language: '',
      canvasNoise: null,
      webGLNoise: { enabled: true, seed: '' },
      audioContextNoise: { enabled: true, seed: 'seed1234' },
      userAgent: '',
      fonts: [],
    });
    expect(payload.timezone).toEqual({ zone: 'America/New_York' });
    expect(payload).not.toHaveProperty('language');
    expect(payload).not.toHaveProperty('canvas');
    expect(payload).not.toHaveProperty('webgl');
    expect(payload.audio).toEqual({ mode: 'noise', seed: 'seed1234' });
    expect(payload).not.toHaveProperty('navigator');
    expect(payload).not.toHaveProperty('fonts');
  });
});
