/**
 * loadEnv — Lightweight .env loader (no external dependencies)
 *
 * Loads key=value pairs from a .env file at the project root into process.env
 * without overwriting variables already set in the environment.
 *
 * Why not the dotenv package? To avoid adding a new dependency to package.json
 * for a feature this small. The parser is intentionally minimal but handles:
 *   - Comments (#) and blank lines
 *   - Surrounding single or double quotes
 *   - Whitespace around keys/values
 *
 * Usage: require('./providers/loadEnv.cjs')();
 */

'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv(envPath) {
  const resolvedPath = envPath || path.resolve(__dirname, '..', '..', '.env');

  if (!fs.existsSync(resolvedPath)) {
    return { loaded: false, path: resolvedPath, count: 0 };
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  let count = 0;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Don't overwrite values already set in the environment
    if (process.env[key] === undefined) {
      process.env[key] = value;
      count++;
    }
  }

  return { loaded: true, path: resolvedPath, count };
}

module.exports = loadEnv;
