# Security Policy

Baha Ready 3D stores personal data about players, many of them minors, as well as teachers and
barangay staff. We treat that data under the Philippine **Data Privacy Act of 2012 (RA 10173)**.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through
[GitHub Security Advisories](https://github.com/WendellBlaze15/BAHA_READY_3D/security/advisories/new)
or by email to **adminbahaready3d@gmail.com** with the subject `SECURITY`. Include steps to reproduce
and the impact. We aim to acknowledge reports within 3 days and to fix critical issues within 14 days.
Please give us reasonable time to fix an issue before you disclose it.

Only the latest deployment on `main` (https://baha-ready-3d.vercel.app) is supported.

## Security model (summary)

**Authentication**
- Sign-in uses email OTP (6 digits, 5-minute expiry) or username/email with a password.
- Staff (facilitators, admins, super admins) must use TOTP two-factor authentication (`aal2`), controlled by `system_settings.require_staff_mfa`, which fails closed.
- Sensitive actions (password change, account deletion, admin management) require fresh re-authentication.
- Sign-in and sign-out clear all client caches with a full page load.

**Authorization**
- Row Level Security is enabled on every table.
- `authorize()` checks live roles, not JWT claims, so revoking a role takes effect immediately.
- Service-role access exists only on the server and in Edge Functions.

**Game integrity**
- Scores are computed on the server with the same deterministic code the client uses.
- Attempt tokens are signed, single-use and short-lived.
- Implausible runs are flagged for moderation.

**Abuse controls**
- Every API route has an Upstash sliding-window rate limit.
- OTP entry locks after repeated failures.
- Forms use a honeypot, and disposable email addresses are blocked.
- Every mutating route checks the request origin.

**Headers**
- Each request gets a nonce-based Content-Security-Policy with `strict-dynamic`, no `eval` (Rapier physics is allowed WASM only), no frames and `frame-ancestors 'none'`.
- Also set: HSTS with preload, `nosniff`, a strict referrer policy, and a Permissions-Policy that allows the camera only on the QR-join page.

**Uploads**
- File type is detected from magic bytes (PDF/PNG/JPEG only) and size is capped at 5 MB.
- Facilitator proofs and reports go to private Storage buckets and are served only through short-lived signed URLs (5 and 10 minutes).
- Avatar images are public by design.

**Data at rest**
- Push subscriptions are encrypted with AES-256-GCM using an HKDF-derived key.
- Monitoring (optional Sentry) never collects user info, cookies, headers, bodies or query strings.

**Secrets**
- Secrets are kept only in `.env.local`, Vercel env vars, Supabase secrets/Vault and GitHub Actions secrets.
- A pre-commit hook blocks any `.env.local` value from being committed, and CI runs gitleaks.
- CI follows least privilege: the service-role, Brevo and management keys are never given to CI.

**Android**
- `allowBackup` and cleartext traffic are both off.
- Links open the app only when verified by App Links.
- The release keystore is never committed.

## Operator checklist

- Rotate any credential that has ever been shared in chat, email or screenshots:
  - Supabase access token and DB password
  - Brevo API and SMTP keys
  - Upstash token
  - Vercel token
- Revoke unused app passwords.
- Keep the Android release keystore and its password backed up offline. They cannot be recovered.
- Keep device clocks set automatically. TOTP codes fail when a clock drifts by more than about 30 seconds.
- Review Supabase advisors (`pnpm db:advisors`) after schema changes.
