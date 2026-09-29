#!/usr/bin/env node
// pgTAP runner that works without Docker: connects to the linked project's session pooler,
// runs each supabase/tests/*.sql file inside a transaction that is ALWAYS rolled back,
// and reports TAP results. Usage: node scripts/test-db.mjs [file...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });

const poolerFile = path.join(root, 'supabase/.temp/pooler-url');
const base =
  process.env.SUPABASE_DB_URL ??
  (fs.existsSync(poolerFile) ? fs.readFileSync(poolerFile, 'utf8').trim() : null);
if (!base) {
  console.error('No DB URL: run `supabase link` first or set SUPABASE_DB_URL.');
  process.exit(2);
}
const url = new URL(base);
if (!url.password) url.password = process.env.SUPABASE_DB_PASSWORD ?? '';

const testsDir = path.join(root, 'supabase/tests');
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs
      .readdirSync(testsDir)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('_'))
      .sort()
      .map((f) => path.join(testsDir, f));
const setup = fs.readFileSync(path.join(testsDir, '_setup.sql'), 'utf8');

const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

let failed = 0;
let passed = 0;
for (const file of files) {
  const sql = fs.readFileSync(file, 'utf8');
  console.log(`\n# ${path.basename(file)}`);
  try {
    await client.query('begin');
    await client.query('create extension if not exists pgtap with schema extensions');
    await client.query(setup);
    const results = await client.query(sql);
    const lines = (Array.isArray(results) ? results : [results])
      .flatMap((r) => r.rows ?? [])
      .map((row) => Object.values(row)[0])
      .filter((v) => typeof v === 'string');
    for (const line of lines) {
      for (const l of line.split('\n')) {
        if (/^ok /.test(l)) passed++;
        if (/^not ok /.test(l)) failed++;
        if (/^(not ok|#)/.test(l)) console.log(l);
      }
    }
  } catch (e) {
    failed++;
    console.log(`not ok - ${path.basename(file)} crashed: ${e.message}`);
  } finally {
    await client.query('rollback').catch(() => {});
  }
}
await client.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
