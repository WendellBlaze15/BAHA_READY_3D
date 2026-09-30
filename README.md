# Baha Ready 3D

A bilingual (Filipino / English) 3D flood- and typhoon-preparedness game for Pila, Laguna.
Players pack a go-bag, secure their home, and evacuate safely as the storm signal rises from
**Signal No. 1 to No. 5**. Teachers and barangay officials run class drills as facilitators.

**Live:** https://baha-ready-3d.vercel.app

## Features

- **3D game.** Built with React Three Fiber and Rapier physics. The world is procedural and blocky, with shader water, GPU rain and synthesized audio. Controls work with keyboard, touch joystick or gamepad.
- **Server-authoritative scoring.** Scoring is deterministic, and one code path runs in both the client preview and the Edge Functions. Attempt tokens are single-use, and tampered runs are flagged.
- **Roles.** Player, facilitator, admin and super admin, enforced by Postgres RLS. Staff must use TOTP two-factor authentication.
- **Facilitators.** Groups with QR join, assignments, live sessions, analytics, and CSV/PDF reports.
- **Admin tools.** Content CMS, level versioning, moderation, audit log and maintenance mode.
- **Realtime.** Leaderboards, notifications, and role changes that apply without re-login.
- **Offline-ready PWA.** Built with Serwist. You can replay downloaded levels offline, and the offline submission queue is stored in Dexie. Web Push is supported.
- **Android app.** A Capacitor shell with verified App Links.
- **Email.** 20 bilingual templates sent through Brevo, driven by a database outbox.

## Stack

| Layer | Tech |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind v4, shadcn/ui, next-intl |
| 3D | three, @react-three/fiber + drei, @react-three/rapier |
| Data | Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions, pg_cron, pg_net) |
| State | TanStack Query, Zustand (game), Dexie (offline) |
| Infra | Vercel (sin1), Upstash Redis (rate limits), Brevo (email) |
| Mobile | Capacitor 8 (Android) |
| Quality | Vitest, pgTAP, Playwright + axe, ESLint, Prettier, gitleaks, GitHub Actions |

## Repository layout

```
apps/web          Next.js app (routes in app/[locale]/…, game in game/, API in app/api/)
apps/mobile       Capacitor Android shell (see apps/mobile/README.md)
packages/shared   Zod schemas, env validation, deterministic game layout + scoring
supabase/         migrations, pgTAP tests, Edge Functions (_shared/shared is synced — don't edit)
scripts/          setup, secret scan, env loader, email templates, icon + type generation
e2e/              Playwright end-to-end + accessibility suite
```

## Getting started

Requirements: Node 22+ and pnpm 10 (run `corepack enable`). Docker is **not** required.

```bash
pnpm install
cp .env.example .env.local        # fill in values; never commit this file
pnpm run setup check-env          # shows which variables are set (values are never printed)
pnpm dev                          # http://localhost:3000
```

All secrets live in the repo-root `.env.local`. `scripts/with-env.mjs` loads it for `dev`, `build`,
`start` and the CLI tools. On Vercel, the dashboard env vars are used instead.

> ⚠️ `pnpm setup` is a pnpm built-in. Always use **`pnpm run setup <step>`** for this repo's
> setup script.

### Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm --filter @baha/web start` | Develop / build / serve production locally |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | Static checks and unit tests |
| `pnpm test:db` | pgTAP RLS and function tests against the linked project (always rolled back) |
| `pnpm test:journeys` | Cross-role integration journeys (157 checks) against a local server: application → approval → groups → assignments → play → analytics/reports, live sessions, moderation, suspension, data isolation. Uses temporary `@test.local` users and cleans up. Local only (needs the service key) |
| `pnpm test:e2e` | Playwright + axe (reuses a server on :3000; `PW_CHANNEL=msedge` uses installed Edge) |
| `pnpm db:push` | Apply new migrations |
| `pnpm db:types` | Regenerate Supabase TypeScript types |
| `pnpm functions:deploy` | Sync shared game code into the Edge Functions and deploy them (no Docker) |
| `pnpm run setup <step>` | Idempotent service setup: `check-env`, `supabase-auth`, `seed-staff`, `vercel`, `vercel-deploy`, `functions-secrets`, `brevo`, `email-pipeline` |
| `node scripts/gh-ci-env.mjs` | Push the minimal CI variables and secrets to GitHub Actions |

## Environments

- **Supabase `jilnmytqtdnujbphvhrn`** is **dev/staging**. Create a separate production project
  before public launch, then run `pnpm db:push`, `pnpm functions:deploy` and the setup steps against it.
- **Vercel** project `baha-ready-3d` (region `sin1`). Deploy with `pnpm run setup vercel-deploy`.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:
1. format, lint, typecheck and unit tests
2. a check that the Edge Functions' shared code is in sync
3. a gitleaks secret scan
4. the pgTAP suite
5. a production build with a **180 kB shared-JS budget**
6. Playwright E2E with axe (WCAG 2.1 AA) on desktop and phone

Dependabot opens grouped update PRs weekly.

## Content accuracy

Safety tips and hotlines in `supabase/seed.sql` are marked `-- VERIFY WITH MDRRMO/NDRRMC`.
They must be reviewed by the local disaster-risk office before public use. The only hotline
seeded by default is **911**.

## Security

See [SECURITY.md](SECURITY.md) for the security model and how to report a vulnerability.
