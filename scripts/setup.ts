// Baha Ready 3D — idempotent setup script (Section 26).
//   pnpm setup                 → run every step
//   pnpm setup check-env       → report missing keys (names only)
//   pnpm setup supabase-auth   → configure Supabase Auth (SMTP, OTP, templates, MFA, hooks)
//   pnpm setup seed-staff      → create/refresh admin + super admin accounts
// Secret VALUES are never printed; only key names and ✔/✘.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { publicEnvSchema, serverEnvSchema, toolingEnvSchema } from '../packages/shared/src/env.ts';
import { authTemplates } from './email/auth-templates.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.local');
dotenv.config({ path: ENV_FILE, quiet: true });

type Status = 'ok' | 'warn' | 'fail';
const report: { service: string; status: Status; note: string }[] = [];
const log = (service: string, status: Status, note: string) => {
  report.push({ service, status, note });
  console.log(`${status === 'ok' ? '✔' : status === 'warn' ? '⚠' : '✘'} ${service}: ${note}`);
};
const env = (k: string) => process.env[k]?.trim() || undefined;

function setEnvValue(key: string, value: string) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text)
    ? text.replace(re, `${key}=${value}`)
    : `${text.trimEnd()}\n${key}=${value}\n`;
  fs.writeFileSync(ENV_FILE, text);
  process.env[key] = value;
}

// ── check-env ─────────────────────────────────────────────────────────
function checkEnv() {
  for (const [name, schema] of [
    ['public', publicEnvSchema],
    ['server', serverEnvSchema],
    ['tooling', toolingEnvSchema],
  ] as const) {
    const res = schema.safeParse(process.env);
    const keys = Object.keys(schema.shape);
    const bad = new Set(res.success ? [] : res.error.issues.map((i) => String(i.path[0])));
    for (const k of keys)
      console.log(
        `  ${bad.has(k) ? '✘' : env(k) ? '✔' : '·'} ${k}${bad.has(k) ? ' (missing/invalid)' : env(k) ? '' : ' (optional, empty)'}`,
      );
    log(
      `env:${name}`,
      bad.size ? 'fail' : 'ok',
      bad.size ? `${bad.size} key(s) missing/invalid` : 'all required keys set',
    );
  }
}

// ── generate ──────────────────────────────────────────────────────────
function generate() {
  const gens: Record<string, () => string> = {
    ATTEMPT_TOKEN_SECRET: () => crypto.randomBytes(48).toString('base64'),
    EMAIL_WEBHOOK_SECRET: () => crypto.randomBytes(32).toString('hex'),
    CRON_SECRET: () => crypto.randomBytes(32).toString('hex'),
  };
  for (const [k, fn] of Object.entries(gens)) if (!env(k)) setEnvValue(k, fn());
  if (!env('VAPID_PRIVATE_KEY')) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    setEnvValue('NEXT_PUBLIC_VAPID_PUBLIC_KEY', ecdh.getPublicKey().toString('base64url'));
    setEnvValue('VAPID_PRIVATE_KEY', ecdh.getPrivateKey().toString('base64url'));
  }
  log(
    'generated-secrets',
    'ok',
    'ATTEMPT_TOKEN_SECRET, EMAIL_WEBHOOK_SECRET, CRON_SECRET, VAPID keys present',
  );
}

// ── Supabase Management API ───────────────────────────────────────────
async function mgmt(method: string, p: string, body?: unknown) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${env('SUPABASE_PROJECT_REF')}${p}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${env('SUPABASE_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    text,
    json: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })(),
  };
}

async function supabaseAuth() {
  // Production URL (from the vercel step) is the Auth site URL; localhost stays allowed for dev.
  const appUrl = env('PRODUCTION_URL') ?? env('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
  const extraUrls = (env('AUTH_EXTRA_REDIRECT_URLS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = [
    'http://localhost:3000/**',
    `${appUrl}/**`,
    // Vercel preview deployments of this project only.
    'https://baha-ready-3d-*-wendellramos400-gmailcoms-projects.vercel.app/**',
    'bahaready://auth/callback',
    ...extraUrls,
  ];

  const config: Record<string, unknown> = {
    site_url: appUrl,
    uri_allow_list: [...new Set(allow)].join(','),
    disable_signup: false,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    mailer_otp_exp: 300,
    mailer_otp_length: 6,
    password_min_length: 10,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    mfa_max_enrolled_factors: 10,
    jwt_exp: 3600,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    hook_custom_access_token_enabled: true,
    hook_custom_access_token_uri: 'pg-functions://postgres/public/custom_access_token_hook',
    mailer_subjects_magic_link: authTemplates.magic_link.subject,
    mailer_templates_magic_link_content: authTemplates.magic_link.html,
    mailer_subjects_confirmation: authTemplates.confirmation.subject,
    mailer_templates_confirmation_content: authTemplates.confirmation.html,
    mailer_subjects_recovery: authTemplates.recovery.subject,
    mailer_templates_recovery_content: authTemplates.recovery.html,
    mailer_subjects_email_change: authTemplates.email_change.subject,
    mailer_templates_email_change_content: authTemplates.email_change.html,
    mailer_subjects_reauthentication: authTemplates.reauthentication.subject,
    mailer_templates_reauthentication_content: authTemplates.reauthentication.html,
    mailer_subjects_invite: authTemplates.invite.subject,
    mailer_templates_invite_content: authTemplates.invite.html,
    password_hibp_enabled: true,
  };

  if (env('BREVO_SMTP_LOGIN') && env('BREVO_SMTP_KEY') && env('BREVO_SENDER_EMAIL')) {
    Object.assign(config, {
      smtp_admin_email: env('BREVO_SENDER_EMAIL'),
      smtp_host: 'smtp-relay.brevo.com',
      smtp_port: '587',
      smtp_user: env('BREVO_SMTP_LOGIN'),
      smtp_pass: env('BREVO_SMTP_KEY'),
      smtp_sender_name: env('BREVO_SENDER_NAME') ?? 'Baha Ready',
      smtp_max_frequency: 60,
      // Custom SMTP lifts Supabase's 2/h default; our own Upstash limits still apply upstream.
      rate_limit_email_sent: 100,
    });
  } else {
    log(
      'supabase-auth:smtp',
      'warn',
      'BREVO_SMTP_LOGIN/KEY/SENDER missing — using Supabase default mailer',
    );
  }

  let res = await mgmt('PATCH', '/config/auth', config);
  // Some fields (e.g. leaked-password protection) need a paid plan: drop and retry.
  const dropped: string[] = [];
  const knownPaidFeatures: Record<string, string> = { 'leaked password': 'password_hibp_enabled' };
  for (let i = 0; !res.ok && (res.status === 400 || res.status === 402) && i < 5; i++) {
    const field =
      Object.keys(config).find((k) => res.text.includes(k)) ??
      Object.entries(knownPaidFeatures).find(([msg]) => res.text.toLowerCase().includes(msg))?.[1];
    if (!field) break;
    dropped.push(field);
    delete config[field];
    res = await mgmt('PATCH', '/config/auth', config);
  }
  if (!res.ok) return log('supabase-auth', 'fail', `HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  log(
    'supabase-auth',
    'ok',
    `configured (OTP 6/300s, MFA TOTP, token hook, Brevo SMTP, 6 templates)${dropped.length ? `; skipped: ${dropped.join(', ')}` : ''}`,
  );
  if (dropped.includes('password_hibp_enabled')) {
    log(
      'supabase-auth:hibp',
      'warn',
      'Leaked-password protection needs Supabase Pro; zxcvbn ≥ 3 is still enforced in-app',
    );
  }
}

// ── Staff seeding (Auth Admin API) ────────────────────────────────────
async function authAdmin(method: string, p: string, body?: unknown) {
  const res = await fetch(`${env('NEXT_PUBLIC_SUPABASE_URL')}/auth/v1/admin${p}`, {
    method,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY')!,
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}

async function rest(method: string, p: string, body?: unknown, prefer?: string) {
  const res = await fetch(`${env('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1${p}`, {
    method,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY')!,
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function findUserByEmail(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const r = await authAdmin('GET', `/users?page=${page}&per_page=200`);
    const users: { id: string; email?: string }[] = r.json?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (users.length < 200) return undefined;
  }
  return undefined;
}

async function seedOne(
  label: string,
  email: string,
  password: string,
  username: string,
  roleId: number,
) {
  let id = await findUserByEmail(email);
  if (!id) {
    const r = await authAdmin('POST', '/users', {
      email,
      password,
      email_confirm: true,
      user_metadata: { language: 'fil', seeded: true },
    });
    if (!r.ok)
      return log(
        `seed:${label}`,
        'fail',
        `create failed (HTTP ${r.status}: ${r.json?.msg ?? r.json?.message ?? ''})`,
      );
    id = r.json.id as string;
  } else {
    // Keep the password in sync with .env.local (idempotent re-run).
    await authAdmin('PUT', `/users/${id}`, { password, email_confirm: true });
  }
  const now = new Date().toISOString();
  const up = await rest('PATCH', `/profiles?id=eq.${id}`, {
    username,
    display_name: label === 'super_admin' ? 'Super Admin' : 'Admin',
    consent_at: now,
    onboarded_at: now,
    leaderboard_visible: false,
  });
  if (!up.ok) return log(`seed:${label}`, 'fail', `profile update failed (HTTP ${up.status})`);
  // Staff roles replace the default player role (staff don't appear on leaderboards).
  await rest('DELETE', `/user_roles?user_id=eq.${id}&role_id=neq.${roleId}`);
  const ins = await rest(
    'POST',
    '/user_roles',
    { user_id: id, role_id: roleId },
    'resolution=ignore-duplicates',
  );
  if (!ins.ok && ins.status !== 409)
    return log(`seed:${label}`, 'fail', `role grant failed (HTTP ${ins.status})`);
  log(`seed:${label}`, 'ok', `username "${username}" ready (role ${label})`);
}

async function seedStaff() {
  const a = { email: env('SEED_ADMIN_EMAIL'), pw: env('SEED_ADMIN_PASSWORD') };
  const s = {
    email: env('SEED_SUPERADMIN_EMAIL'),
    pw: env('SEED_SUPERADMIN_PASSWORD'),
    user: env('SEED_SUPERADMIN_USERNAME'),
  };
  if (a.email && a.pw) await seedOne('admin', a.email, a.pw, 'bahaready_admin', 4);
  else log('seed:admin', 'warn', 'SEED_ADMIN_EMAIL/PASSWORD missing');
  if (s.email && s.pw && s.user) await seedOne('super_admin', s.email, s.pw, s.user, 5);
  else log('seed:super_admin', 'warn', 'SEED_SUPERADMIN_* missing');
}

// ── Vercel ────────────────────────────────────────────────────────────
const VERCEL_PROJECT = 'baha-ready-3d';
const GITHUB_REPO = 'WendellBlaze15/BAHA_READY_3D';

// Runtime vars only. Tooling secrets (DB password, access tokens, seed passwords, SMTP key)
// are NEVER uploaded to Vercel.
const VERCEL_PUBLIC_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'NEXT_PUBLIC_POSTHOG_HOST',
  'NEXT_PUBLIC_GAME_SERVER_URL',
];
const VERCEL_SECRET_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'BREVO_API_KEY',
  'ATTEMPT_TOKEN_SECRET',
  'EMAIL_WEBHOOK_SECRET',
  'CRON_SECRET',
  'VAPID_PRIVATE_KEY',
  'FCM_SERVICE_ACCOUNT_JSON',
  'SENTRY_AUTH_TOKEN',
  'GAME_SERVER_ADMIN_SECRET',
];
const VERCEL_PLAIN_SERVER_KEYS = [
  'SUPABASE_PROJECT_REF',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
  'BREVO_SMS_SENDER',
  'SMS_OTP_ENABLED',
  'WEATHER_LAT',
  'WEATHER_LON',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'GAME_SERVER_HTTP_URL',
];

async function vc(method: string, p: string, body?: unknown) {
  const team = env('VERCEL_ORG_ID');
  const sep = p.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.vercel.com${p}${team ? `${sep}teamId=${team}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${env('VERCEL_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    json: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })(),
  };
}

async function vercel() {
  if (!env('VERCEL_TOKEN'))
    return log('vercel', 'fail', 'VERCEL_TOKEN missing (vercel.com/account/tokens)');
  if (!env('VERCEL_ORG_ID')) {
    const u = await vc('GET', '/v2/user');
    if (!u.ok) return log('vercel', 'fail', `token rejected (HTTP ${u.status})`);
    setEnvValue('VERCEL_ORG_ID', u.json.user.defaultTeamId);
  }

  // 1. Project (linked to GitHub for automatic deploys on push).
  let project = (await vc('GET', `/v9/projects/${VERCEL_PROJECT}`)).json;
  if (!project?.id) {
    const settings = {
      name: VERCEL_PROJECT,
      framework: 'nextjs',
      rootDirectory: 'apps/web',
      installCommand: 'pnpm install --frozen-lockfile',
    };
    let created = await vc('POST', '/v11/projects', {
      ...settings,
      gitRepository: { type: 'github', repo: GITHUB_REPO },
    });
    if (!created.ok) {
      log(
        'vercel:git',
        'warn',
        `GitHub link failed (${created.json?.error?.code ?? created.status}); install the Vercel GitHub app on ${GITHUB_REPO}, then re-run`,
      );
      created = await vc('POST', '/v11/projects', settings);
    }
    if (!created.ok)
      return log(
        'vercel',
        'fail',
        `project create failed: ${created.json?.error?.message ?? created.status}`,
      );
    project = created.json;
  }
  setEnvValue('VERCEL_PROJECT_ID', project.id);

  const patch = await vc('PATCH', `/v9/projects/${project.id}`, {
    rootDirectory: 'apps/web',
    framework: 'nextjs',
    installCommand: 'pnpm install --frozen-lockfile',
    nodeVersion: '22.x',
    serverlessFunctionRegion: 'sin1',
  });
  if (!patch.ok)
    log('vercel:settings', 'warn', `settings patch: ${patch.json?.error?.message ?? patch.status}`);

  // 2. Production URL (first *.vercel.app domain).
  const domains = (await vc('GET', `/v9/projects/${project.id}/domains`)).json?.domains ?? [];
  const prodDomain: string =
    domains.find((d: { name: string }) => d.name.endsWith('.vercel.app'))?.name ??
    `${VERCEL_PROJECT}.vercel.app`;
  const prodUrl = `https://${prodDomain}`;
  setEnvValue('PRODUCTION_URL', prodUrl);

  // 3. Environment variables (upsert). Secrets are "sensitive" (write-only) in prod/preview.
  const vars: { key: string; value: string; type: string; target: string[] }[] = [];
  const add = (
    key: string,
    type: 'plain' | 'encrypted' | 'sensitive',
    target: string[],
    value = env(key),
  ) => {
    if (value) vars.push({ key, value, type, target });
  };
  add('NEXT_PUBLIC_APP_URL', 'plain', ['production', 'preview'], prodUrl);
  for (const k of VERCEL_PUBLIC_KEYS) add(k, 'plain', ['production', 'preview', 'development']);
  for (const k of VERCEL_PLAIN_SERVER_KEYS)
    add(k, 'encrypted', ['production', 'preview', 'development']);
  for (const k of VERCEL_SECRET_KEYS) add(k, 'sensitive', ['production', 'preview']);
  let failed = 0;
  for (const v of vars) {
    const r = await vc('POST', `/v10/projects/${project.id}/env?upsert=true`, v);
    if (!r.ok) {
      failed++;
      console.log(`  ✘ ${v.key}: ${r.json?.error?.code ?? r.status}`);
    }
  }
  log(
    'vercel:env',
    failed ? 'warn' : 'ok',
    `${vars.length - failed}/${vars.length} env vars set (names only; values never printed)`,
  );
  log('vercel', 'ok', `project ${VERCEL_PROJECT} (root apps/web, region sin1) → ${prodUrl}`);
}

async function vercelDeploy() {
  const projectId = env('VERCEL_PROJECT_ID');
  if (!projectId) return log('vercel:deploy', 'fail', 'run `pnpm setup vercel` first');
  const project = (await vc('GET', `/v9/projects/${projectId}`)).json;
  const repoId = project?.link?.repoId;
  if (!repoId)
    return log(
      'vercel:deploy',
      'warn',
      'project not linked to GitHub; deploy with the Vercel CLI instead',
    );
  const r = await vc('POST', '/v13/deployments', {
    name: VERCEL_PROJECT,
    project: projectId,
    target: 'production',
    gitSource: { type: 'github', repoId, ref: 'main' },
  });
  if (!r.ok)
    return log('vercel:deploy', 'fail', `deploy failed: ${r.json?.error?.message ?? r.status}`);
  log(
    'vercel:deploy',
    'ok',
    `production deployment started: https://${r.json.url} (id ${r.json.id})`,
  );
}

// ── Brevo templates + webhook ─────────────────────────────────────────
async function brevoApi(method: string, p: string, body?: unknown) {
  const res = await fetch(`https://api.brevo.com/v3${p}`, {
    method,
    headers: {
      'api-key': env('BREVO_API_KEY')!,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    json: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })(),
    text,
  };
}

async function brevo() {
  if (!env('BREVO_API_KEY')) return log('brevo', 'fail', 'BREVO_API_KEY missing');
  const { buildNotificationTemplates } = await import('./email/notification-templates.ts');
  const templates = buildNotificationTemplates();
  const existing = await brevoApi('GET', '/smtp/templates?limit=1000&offset=0');
  if (!existing.ok)
    return log('brevo', 'fail', `HTTP ${existing.status} (check Brevo authorised IPs)`);
  const byName = new Map<string, number>(
    ((existing.json?.templates ?? []) as { id: number; name: string }[]).map((t) => [t.name, t.id]),
  );
  const sender = {
    email: env('BREVO_SENDER_EMAIL'),
    name: env('BREVO_SENDER_NAME') ?? 'Baha Ready',
  };
  const ids: Record<string, { id: number; critical: boolean }> = {};
  for (const tpl of templates) {
    const payload = {
      sender,
      templateName: tpl.name,
      subject: tpl.subject,
      htmlContent: tpl.html,
      isActive: true,
      replyTo: sender.email,
    };
    const id = byName.get(tpl.name);
    if (id) {
      const r = await brevoApi('PUT', `/smtp/templates/${id}`, payload);
      if (!r.ok)
        return log('brevo', 'fail', `update ${tpl.key}: HTTP ${r.status} ${r.text.slice(0, 120)}`);
      ids[tpl.key] = { id, critical: tpl.critical };
    } else {
      const r = await brevoApi('POST', '/smtp/templates', payload);
      if (!r.ok)
        return log('brevo', 'fail', `create ${tpl.key}: HTTP ${r.status} ${r.text.slice(0, 120)}`);
      ids[tpl.key] = { id: r.json.id, critical: tpl.critical };
    }
  }
  const json = JSON.stringify(ids, null, 2) + '\n';
  fs.writeFileSync(path.join(ROOT, 'supabase/functions/send-email/templates.json'), json);
  fs.writeFileSync(
    path.join(ROOT, 'apps/web/lib/email/templates.ts'),
    `// AUTO-GENERATED by \`pnpm setup brevo\`: Brevo template IDs per notification event.\nexport const BREVO_TEMPLATES = ${JSON.stringify(ids, null, 2)} as const;\n`,
  );
  log('brevo:templates', 'ok', `${templates.length} bilingual templates upserted`);

  // Transactional webhook → bounce/spam suppression.
  const appUrl = env('PRODUCTION_URL');
  if (appUrl) {
    const url = `${appUrl}/api/webhooks/brevo?token=${env('EMAIL_WEBHOOK_SECRET')}`;
    const hooks = await brevoApi('GET', '/webhooks?type=transactional');
    const already = ((hooks.json?.webhooks ?? []) as { url: string }[]).some((h) =>
      h.url.startsWith(`${appUrl}/api/webhooks/brevo`),
    );
    if (!already) {
      const r = await brevoApi('POST', '/webhooks', {
        url,
        type: 'transactional',
        description: 'Baha Ready bounce/spam suppression',
        events: ['hardBounce', 'spam', 'blocked', 'unsubscribed', 'invalid'],
      });
      log(
        'brevo:webhook',
        r.ok ? 'ok' : 'warn',
        r.ok ? 'bounce/spam webhook registered' : `webhook: HTTP ${r.status}`,
      );
    } else log('brevo:webhook', 'ok', 'bounce/spam webhook already registered');
  }
}

// ── Email pipeline wiring (Vault secrets for the DB → send-email trigger) ──
async function emailPipeline() {
  const url = `${env('NEXT_PUBLIC_SUPABASE_URL')}/functions/v1/send-email`;
  const secret = env('EMAIL_WEBHOOK_SECRET');
  if (!secret) return log('email:pipeline', 'fail', 'EMAIL_WEBHOOK_SECRET missing');
  const esc = (s: string) => s.replace(/'/g, "''");
  // Upsert both vault secrets (values are sent over TLS to the Management API, never printed).
  const sql = `
    do $$ begin
      if exists (select 1 from vault.secrets where name = 'email_webhook_secret') then
        perform vault.update_secret((select id from vault.secrets where name = 'email_webhook_secret'), '${esc(secret)}');
      else perform vault.create_secret('${esc(secret)}', 'email_webhook_secret'); end if;
      if exists (select 1 from vault.secrets where name = 'send_email_url') then
        perform vault.update_secret((select id from vault.secrets where name = 'send_email_url'), '${esc(url)}');
      else perform vault.create_secret('${esc(url)}', 'send_email_url'); end if;
    end $$;`;
  const r = await mgmt('POST', '/database/query', { query: sql });
  log(
    'email:pipeline',
    r.ok ? 'ok' : 'fail',
    r.ok ? 'vault secrets set for the email webhook' : `HTTP ${r.status} ${r.text.slice(0, 160)}`,
  );
}

// ── Edge Function secrets ─────────────────────────────────────────────
async function functionsSecrets() {
  const origins = [env('PRODUCTION_URL'), 'http://localhost:3000'].filter(Boolean).join(',');
  const pairs: [string, string | undefined][] = [
    ['ATTEMPT_TOKEN_SECRET', env('ATTEMPT_TOKEN_SECRET')],
    ['UPSTASH_REDIS_REST_URL', env('UPSTASH_REDIS_REST_URL')],
    ['UPSTASH_REDIS_REST_TOKEN', env('UPSTASH_REDIS_REST_TOKEN')],
    ['BREVO_API_KEY', env('BREVO_API_KEY')],
    ['BREVO_SENDER_EMAIL', env('BREVO_SENDER_EMAIL')],
    ['BREVO_SENDER_NAME', env('BREVO_SENDER_NAME')],
    ['EMAIL_WEBHOOK_SECRET', env('EMAIL_WEBHOOK_SECRET')],
    ['CRON_SECRET', env('CRON_SECRET')],
    ['VAPID_PRIVATE_KEY', env('VAPID_PRIVATE_KEY')],
    ['VAPID_PUBLIC_KEY', env('NEXT_PUBLIC_VAPID_PUBLIC_KEY')],
    ['FCM_SERVICE_ACCOUNT_JSON', env('FCM_SERVICE_ACCOUNT_JSON')],
    ['APP_ORIGINS', origins],
    ['APP_URL', env('PRODUCTION_URL') ?? env('NEXT_PUBLIC_APP_URL')],
  ];
  const secrets = pairs.filter(([, v]) => !!v).map(([name, value]) => ({ name, value: value! }));
  const r = await mgmt('POST', '/secrets', secrets);
  if (!r.ok) return log('functions:secrets', 'fail', `HTTP ${r.status}: ${r.text.slice(0, 160)}`);
  log(
    'functions:secrets',
    'ok',
    `${secrets.length} secrets set: ${secrets.map((s) => s.name).join(', ')}`,
  );
}

// ── main ──────────────────────────────────────────────────────────────
const steps: Record<string, () => unknown> = {
  'check-env': checkEnv,
  generate,
  'supabase-auth': supabaseAuth,
  'seed-staff': seedStaff,
  vercel,
  'vercel-deploy': vercelDeploy,
  'functions-secrets': functionsSecrets,
  brevo,
  'email-pipeline': emailPipeline,
};

const requested = process.argv.slice(2);
for (const name of requested.length ? requested : Object.keys(steps)) {
  const step = steps[name];
  if (!step) {
    console.error(`Unknown step "${name}". Available: ${Object.keys(steps).join(', ')}`);
    process.exit(2);
  }
  console.log(`\n── ${name} ──`);
  try {
    await step();
  } catch (e) {
    log(name, 'fail', (e as Error).message);
  }
}

console.log('\n══ Setup report ══');
for (const r of report)
  console.log(
    `${r.status === 'ok' ? '✔' : r.status === 'warn' ? '⚠' : '✘'} ${r.service.padEnd(24)} ${r.note}`,
  );
process.exit(report.some((r) => r.status === 'fail') ? 1 : 0);
