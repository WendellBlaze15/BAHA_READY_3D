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
  const appUrl = env('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
  const extraUrls = (env('AUTH_EXTRA_REDIRECT_URLS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = [
    'http://localhost:3000/**',
    `${appUrl}/**`,
    'https://*-wendellblaze15s-projects.vercel.app/**',
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

// ── main ──────────────────────────────────────────────────────────────
const steps: Record<string, () => unknown> = {
  'check-env': checkEnv,
  generate,
  'supabase-auth': supabaseAuth,
  'seed-staff': seedStaff,
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
