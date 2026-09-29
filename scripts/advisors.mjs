#!/usr/bin/env node
// Print Supabase security/performance advisor findings for the linked project.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
const ref = process.env.SUPABASE_PROJECT_REF;
for (const kind of process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['security', 'performance']) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/advisors/${kind}`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  const body = await r.json();
  const lints = body.lints ?? [];
  console.log(`\n== ${kind}: ${lints.length} findings ==`);
  const counts = {};
  for (const l of lints) {
    const k = `${l.level} ${l.name}`;
    counts[k] ??= [];
    counts[k].push(l.metadata?.name ?? l.detail?.slice(0, 80));
  }
  for (const [k, v] of Object.entries(counts))
    console.log(`${k} (${v.length}): ${v.slice(0, 12).join(', ')}`);
}
