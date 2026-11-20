#!/usr/bin/env node
/**
 * Environment separation + secret guardrails.
 *
 * Usage:
 *   node scripts/check-env.mjs            # validate current process.env
 *   node scripts/check-env.mjs --bundle   # scan built client bundle for server-only names
 *
 * Exit code 1 on any violation so CI fails closed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const SERVER_ONLY_PREFIXES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET', 'PRIVATE_KEY'];
const SERVER_ONLY_NAMES = new Set([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'DATABASE_URL',
  'JWT_SECRET',
  'SESSION_SECRET',
  'PRIVATE_KEY',
]);

const NETWORKS = {
  mainnet: {
    required: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_NETWORK'],
    forbidden: ['NEXT_PUBLIC_TESTNET', 'TESTNET'],
  },
  testnet: {
    required: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_NETWORK'],
    forbidden: [],
  },
};

const errors = [];
const warnings = [];

function isServerOnly(name) {
  if (SERVER_ONLY_NAMES.has(name)) return true;
  return SERVER_ONLY_PREFIXES.some((p) => name === p || name.startsWith(`${p}_`));
}

function looksLikeSecret(value) {
  if (!value || value.length < 16) return false;
  if (/^(your[-_]|example|changeme|placeholder|xxx+|<.*>)/i.test(value)) return false;
  // JWT-ish, long base64/hex, or service-role style keys
  return /^eyJ[A-Za-z0-9_-]{10,}/.test(value) || /^[A-Za-z0-9+/=_-]{32,}$/.test(value);
}

function validateEnv() {
  const env = process.env;
  const network = (env.NEXT_PUBLIC_NETWORK || '').toLowerCase();

  if (!network) {
    errors.push('NEXT_PUBLIC_NETWORK is required (expected "mainnet" or "testnet").');
  } else if (!NETWORKS[network]) {
    errors.push(`NEXT_PUBLIC_NETWORK="${network}" is not a supported network.`);
  } else {
    for (const key of NETWORKS[network].required) {
      if (!env[key]) errors.push(`Missing required ${network} configuration: ${key}`);
    }
    for (const key of NETWORKS[network].forbidden) {
      if (env[key]) errors.push(`Unsafe combination: ${key} must not be set on ${network}.`);
    }
  }

  // Prevent unsafe production/testnet combinations.
  const isProd = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  if (isProd && network === 'testnet') {
    errors.push('Unsafe combination: testnet configuration detected in a production environment.');
  }
  if (isProd && env.NEXT_PUBLIC_TESTNET === 'true') {
    errors.push('Unsafe combination: NEXT_PUBLIC_TESTNET=true in production.');
  }

  // Server-only names must never be exposed via NEXT_PUBLIC_.
  for (const key of Object.keys(env)) {
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    const stripped = key.slice('NEXT_PUBLIC_'.length);
    if (isServerOnly(stripped)) {
      errors.push(`Server-only variable exposed to client bundle: ${key}`);
    }
  }

  // Secret scanning of the current environment (catches accidental inline secrets).
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    if (looksLikeSecret(value)) {
      errors.push(`Possible secret committed to a public variable: ${key}`);
    }
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (['.js', '.mjs', '.cjs', '.map'].includes(extname(full))) out.push(full);
  }
  return out;
}

function checkBundle() {
  const dirs = ['.next/static', 'dist', 'build', 'out'].filter((d) => existsSync(d));
  if (dirs.length === 0) {
    warnings.push('No client bundle directory found; skipping bundle scan.');
    return;
  }
  const files = dirs.flatMap((d) => walk(d));
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const name of SERVER_ONLY_NAMES) {
      if (content.includes(name)) {
        errors.push(`Server-only variable name "${name}" leaked into client bundle: ${file}`);
      }
    }
  }
}

if (process.argv.includes('--bundle')) {
  checkBundle();
} else {
  validateEnv();
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
console.log('Environment checks passed.');
