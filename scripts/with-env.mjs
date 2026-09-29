#!/usr/bin/env node
// Runs a command with repo-root .env.local loaded into its environment.
// Usage: node scripts/with-env.mjs <cmd> [...args]   (values are never printed)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: with-env <cmd> [...args]');
  process.exit(2);
}
const r = spawnSync(cmd, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
process.exit(r.status ?? 1);
