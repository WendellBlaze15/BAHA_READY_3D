import { z } from 'zod';
import { chatWordlistSchema } from '@baha/shared/survival';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const schema = z
  .object({
    enabled: z.boolean().optional(),
    wordlist: chatWordlistSchema.omit({ version: true }).optional(),
  })
  .strict();

/** Global text-chat switch + admin filter lists (versioned; audited via system_settings). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireStaff('survival.config.manage');
  await rateLimit('content_write', userId);
  const body = await parseBody(req, schema);
  if (body.enabled !== undefined) {
    const { error } = await supabase
      .from('system_settings')
      .update({ value: body.enabled })
      .eq('key', 'survival_chat_enabled');
    if (error) throw fail('FORBIDDEN', 'errors.forbidden');
  }
  if (body.wordlist) {
    const { data: cur } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'survival_chat_wordlist')
      .maybeSingle();
    const version = Number((cur?.value as { version?: number } | null)?.version ?? 0) + 1;
    const value = chatWordlistSchema.parse({
      words: [...new Set(body.wordlist.words)],
      blockedPhrases: [...new Set(body.wordlist.blockedPhrases)],
      version,
    });
    const { error } = await supabase
      .from('system_settings')
      .update({ value })
      .eq('key', 'survival_chat_wordlist');
    if (error) throw fail('FORBIDDEN', 'errors.forbidden');
  }
  return json({ ok: true });
});
