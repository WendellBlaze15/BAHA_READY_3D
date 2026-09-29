// Validates every level_versions.config in the linked DB against the shared Zod schema.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { levelConfigSchema } from '../packages/shared/src/level-config.ts';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
const url = new URL(fs.readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
url.password = process.env.SUPABASE_DB_PASSWORD ?? '';
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(
  'select level_id, version, config from public.level_versions order by level_id, version',
);
await client.end();
let bad = 0;
for (const r of rows) {
  const res = levelConfigSchema.safeParse(r.config);
  if (res.success) console.log(`✔ level ${r.level_id} v${r.version}`);
  else {
    bad++;
    console.log(
      `✘ level ${r.level_id} v${r.version}:`,
      res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
}
process.exit(bad ? 1 : 0);
