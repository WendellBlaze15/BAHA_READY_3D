#!/usr/bin/env node
// Copies the pure shared game code (scoring, layout, schemas) into supabase/functions/_shared
// so the Deno Edge Functions compute results with byte-identical logic to the client preview.
// Run automatically before `functions deploy`; CI fails if copies drift (see --check).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'packages/shared/src');
const dest = path.join(root, 'supabase/functions/_shared/shared');
const files = [
  'level-config.ts',
  'game/rng.ts',
  'game/events.ts',
  'game/content.ts',
  'game/layout.ts',
  'game/scoring.ts',
  'game/index.ts',
];
const header =
  '// AUTO-SYNCED from packages/shared/src by scripts/sync-functions-shared.mjs. Do not edit.\n';
const check = process.argv.includes('--check');

let drift = 0;
for (const f of files) {
  const content = header + fs.readFileSync(path.join(src, f), 'utf8');
  const out = path.join(dest, f);
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== content) {
      console.error(`✘ drift: ${f}`);
      drift++;
    }
    continue;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
}
if (check) {
  if (drift) process.exit(1);
  console.log('✔ functions/_shared is in sync');
} else console.log(`✔ synced ${files.length} files → supabase/functions/_shared/shared`);
