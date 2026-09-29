#!/usr/bin/env node
// Run SQL against the linked Supabase project via the Management API.
// Usage: node scripts/sql.mjs "select 1"   |   node scripts/sql.mjs -f file.sql
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });

const args = process.argv.slice(2);
const query = args[0] === '-f' ? fs.readFileSync(args[1], 'utf8') : args.join(' ');
const ref = process.env.SUPABASE_PROJECT_REF;
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text}`);
  process.exit(1);
}
try {
  const rows = JSON.parse(text);
  if (Array.isArray(rows) && rows.length && typeof rows[0] === 'object') console.table(rows);
  else console.log(text);
} catch {
  console.log(text);
}
