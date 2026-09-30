#!/usr/bin/env node
// Pushes the minimal CI configuration to GitHub Actions from .env.local.
// Public values → Actions variables; the few real secrets → Actions secrets (via stdin,
// never on the command line or in output). Least privilege: management tokens, the
// service-role key and Brevo keys are deliberately NOT sent to CI.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = dotenv.config({ path: path.join(root, '.env.local'), quiet: true }).parsed ?? {};

const VARIABLES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'SUPABASE_PROJECT_REF',
];
const SECRETS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SUPABASE_DB_PASSWORD'];

let failed = 0;
for (const [kind, keys] of [
  ['variable', VARIABLES],
  ['secret', SECRETS],
]) {
  for (const key of keys) {
    const value = env[key];
    if (!value) {
      console.log(`✘ ${key}: missing in .env.local`);
      failed++;
      continue;
    }
    const args =
      kind === 'variable' ? ['variable', 'set', key, '--body', value] : ['secret', 'set', key];
    const r = spawnSync('gh', args, {
      input: kind === 'secret' ? value : undefined,
      stdio: ['pipe', 'ignore', 'pipe'],
      shell: false,
    });
    if (r.status === 0) console.log(`✔ ${kind} ${key}`);
    else {
      failed++;
      console.log(`✘ ${kind} ${key}: ${String(r.stderr).split('\n')[0]}`);
    }
  }
}
process.exit(failed ? 1 : 0);
