#!/usr/bin/env node
// Pre-commit secret scan. Blocks the commit if any staged file contains:
//  1. a literal value from .env.local (length >= 8), or
//  2. a known credential pattern.
// Prints file names and key NAMES only — never the secret values.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,}/],
  ['Supabase access token', /sbp_[a-f0-9]{30,}/],
  ['Brevo API key', /xkeysib-[a-f0-9]{40,}/],
  ['Brevo SMTP key', /xsmtpsib-[a-f0-9]{40,}/],
  ['Vercel token', /vcp_[A-Za-z0-9]{30,}/],
  ['JWT (service role?)', /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/],
  ['Private key block', /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
];

// Config values that are not secrets and may legitimately appear in code.
const NON_SECRET = new Set([
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEY_ALIAS',
  'BREVO_SENDER_NAME',
  'BREVO_SMS_SENDER',
  'SMS_OTP_ENABLED',
  'SUPABASE_PROJECT_REF',
  'SEED_SUPERADMIN_USERNAME',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
]);

const envValues = [];
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || m[1].startsWith('NEXT_PUBLIC_') || NON_SECRET.has(m[1])) continue;
    const v = m[2].trim().replace(/^"|"$/g, '');
    // Skip non-secret config values.
    if (v.length >= 8 && !/^https?:\/\//.test(v) && !/^[\d.]+$/.test(v) && !v.includes('@')) {
      envValues.push([m[1], v]);
    }
  }
}

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const findings = [];
for (const file of staged) {
  if (/^\.env(\.|$)/.test(file) && file !== '.env.example') {
    findings.push(`${file}: env file must never be committed`);
    continue;
  }
  let content;
  try {
    content = execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 50e6 });
  } catch {
    continue; // binary or unreadable
  }
  for (const [name, re] of PATTERNS) if (re.test(content)) findings.push(`${file}: ${name}`);
  for (const [key, value] of envValues)
    if (content.includes(value)) findings.push(`${file}: value of ${key}`);
}

if (findings.length) {
  console.error('✘ Secret scan blocked this commit:\n  ' + findings.join('\n  '));
  process.exit(1);
}
console.log(`✔ Secret scan passed (${staged.length} staged files)`);
