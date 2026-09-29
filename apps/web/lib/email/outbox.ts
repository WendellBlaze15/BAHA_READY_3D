import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export type EmailTemplateKey =
  | 'welcome'
  | 'new_device_signin'
  | 'otp_lockout'
  | 'application_received'
  | 'application_received_admin'
  | 'application_approved'
  | 'application_rejected'
  | 'assignment_new'
  | 'assignment_due_soon'
  | 'assignment_overdue'
  | 'group_announcement'
  | 'join_request_pending'
  | 'join_request_approved'
  | 'report_ready'
  | 'account_suspended'
  | 'account_restored'
  | 'account_deletion_requested'
  | 'account_deletion_completed'
  | 'admin_promoted'
  | 'admin_demoted';

/** Security/account emails that users cannot opt out of (Section 12A). */
export const CRITICAL_TEMPLATES = new Set<EmailTemplateKey>([
  'new_device_signin',
  'otp_lockout',
  'account_suspended',
  'account_restored',
  'account_deletion_requested',
  'account_deletion_completed',
  'admin_promoted',
  'admin_demoted',
  'application_approved',
  'application_rejected',
]);

// Non-deliverable addresses (e.g. the seeded super admin) never get queued.
const UNDELIVERABLE = /@(bahaready\.internal|test\.local|example\.(com|org))$/i;

/**
 * Queue a transactional email. A DB webhook on insert triggers the `send-email` Edge Function,
 * which sends through Brevo. Respects suppressions and the user's email preference.
 */
export async function enqueueEmail(input: {
  to: string;
  template: EmailTemplateKey;
  params?: Record<string, string | number | boolean | null>;
  userId?: string;
  locale?: 'fil' | 'en';
}) {
  if (UNDELIVERABLE.test(input.to)) return { queued: false, reason: 'undeliverable' as const };
  const admin = getSupabaseAdmin();

  const { data: suppressed } = await admin
    .from('email_suppressions')
    .select('email')
    .eq('email', input.to)
    .maybeSingle();
  if (suppressed) return { queued: false, reason: 'suppressed' as const };

  let locale = input.locale;
  if (input.userId) {
    const [{ data: settings }, { data: profile }] = await Promise.all([
      admin.from('user_settings').select('notifications').eq('user_id', input.userId).maybeSingle(),
      admin.from('profiles').select('language').eq('id', input.userId).maybeSingle(),
    ]);
    const prefs = (settings?.notifications ?? {}) as { email?: boolean };
    if (prefs.email === false && !CRITICAL_TEMPLATES.has(input.template)) {
      return { queued: false, reason: 'opted_out' as const };
    }
    locale ??= (profile?.language as 'fil' | 'en' | undefined) ?? 'fil';
  }

  const { error } = await admin.from('email_outbox').insert({
    to_email: input.to,
    template_key: input.template,
    params: input.params ?? {},
    locale: locale ?? 'fil',
    user_id: input.userId ?? null,
  });
  if (error) {
    console.error('[email] enqueue failed', error.code);
    return { queued: false, reason: 'error' as const };
  }
  return { queued: true as const };
}
