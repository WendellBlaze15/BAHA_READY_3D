// POST /functions/v1/guest-migrate  { attempts: [{ level_id, seed, events, client_summary }] }
// Imports guest (local) attempts after sign-up. Each one is re-validated with the same
// authoritative replay; invalid (flagged) attempts are discarded, not stored.
import { z } from 'zod';
import { adminClient, HttpError, json, rateLimit, requireUser, serve } from '../_shared/http.ts';
import { loadContent, loadLevelConfig } from '../_shared/content.ts';
import {
  computeResult,
  generateLayout,
  clientSummarySchema,
  eventLogSchema,
} from '../_shared/shared/game/index.ts';
import { scoreAndFinalize } from '../_shared/finalize.ts';

const body = z
  .object({
    attempts: z
      .array(
        z
          .object({
            level_id: z.number().int().min(0).max(1), // guests can only play tutorial + Signal 1
            seed: z.string().regex(/^\d{1,10}$/),
            events: eventLogSchema,
            client_summary: clientSummarySchema.optional(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

serve(async (req) => {
  const { userId } = await requireUser(req);
  await rateLimit('guest_migrate', userId, 3, '1 h');
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError('VALIDATION_ERROR', 'errors.validation');
  const admin = adminClient();
  const content = await loadContent(admin);
  const imported: { level_id: number; score: number; stars: number }[] = [];
  let discarded = 0;
  let failed = 0;

  for (const g of parsed.data.attempts) {
    const { data: level } = await admin
      .from('levels')
      .select('current_version_id')
      .eq('id', g.level_id)
      .single();
    if (!level?.current_version_id) {
      failed++;
      continue;
    }
    const config = await loadLevelConfig(admin, level.current_version_id);
    // Dry-run first: never store attempts that fail validation.
    const dry = computeResult(config, content, generateLayout(config, g.seed), g.events);
    if (dry.flags.length > 0) {
      discarded++;
      continue;
    }
    const { data: attempt, error: insertError } = await admin
      .from('attempts')
      .insert({
        user_id: userId,
        level_id: g.level_id,
        level_version_id: level.current_version_id,
        mode: 'normal',
        seed: Number(g.seed),
        imported: true, // exempt from the one-live-attempt rule (see migration 000700)
      })
      .select('id')
      .single();
    if (!attempt) {
      console.error('guest-migrate insert failed', insertError?.message);
      failed++;
      continue;
    }
    const { result } = await scoreAndFinalize({
      admin,
      attemptId: attempt.id,
      config,
      content,
      seed: g.seed,
      events: g.events,
      clientSummary: g.client_summary,
    });
    await admin.from('attempt_events').insert({
      attempt_id: attempt.id,
      events: g.events,
      byte_size: JSON.stringify(g.events).length,
    });
    imported.push({ level_id: g.level_id, score: result.score, stars: result.stars });
  }
  return json(req, { imported, discarded, failed });
});
