/**
 * Local API token auth for destructive / sensitive routes.
 * Token: MMB_API_TOKEN in .env, or auto-generated .api-token (gitignored).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_FILE = path.resolve(__dirname, '..', '.api-token');
let cachedToken = null;

function getApiToken() {
  if (cachedToken) return cachedToken;
  const fromEnv = process.env.MMB_API_TOKEN && String(process.env.MMB_API_TOKEN).trim();
  if (fromEnv) {
    cachedToken = fromEnv;
    return cachedToken;
  }
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      cachedToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (cachedToken) return cachedToken;
    }
  } catch { /* ignore */ }
  cachedToken = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(TOKEN_FILE, cachedToken);
    console.log(`[Auth] Generated local API token → .api-token (also returned via GET /api/settings)`);
  } catch (err) {
    console.warn('[Auth] Could not write .api-token:', err.message);
  }
  return cachedToken;
}

function readRequestToken(req) {
  const header = req.headers['x-mmb-token'];
  if (header && String(header).trim()) return String(header).trim();
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return '';
}

function requireAuth(req, res, next) {
  const expected = getApiToken();
  const provided = readRequestToken(req);
  if (provided && provided === expected) return next();
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Provide X-MMB-Token header matching MMB_API_TOKEN or .api-token',
  });
}

module.exports = { getApiToken, requireAuth };
