# Baha Ready 3D — Survival game server

Authoritative [Colyseus 0.18](https://docs.colyseus.io) server for Survival Mode (co-op 1–5 players).
Runs TypeScript directly with `tsx`; shared rules come from `@baha/shared/survival`.

## Run locally

```bash
pnpm --filter @baha/game-server dev        # loads ../../.env.local, listens on :2567
pnpm --filter @baha/game-server test       # room tests (@colyseus/testing, in-memory services)
node ../../scripts/with-env.mjs tsx scripts/smoke.ts [baseUrl]   # live smoke with real Supabase tokens
```

To point the local web app at a local server, set `NEXT_PUBLIC_GAME_SERVER_URL=ws://localhost:2567`.

## Security model

- **Auth happens before a room exists** (`static onAuth`): Origin allowlist → protocol version →
  Supabase JWT (JWKS/ES256 via `jose`, falling back to `auth.getUser` only if JWKS is unreachable) →
  per-user rate limit (Upstash) → live `can_play_survival()` + the `survival_enabled` kill switch.
  Facilitators, admins, super admins, guests, suspended and restricted users are rejected.
- Only `create`, `joinById` and `reconnect` matchmaking methods are exposed (no listing, no
  join-any). Rooms are private; players join with a 6-character code (stored in Redis as
  `survival:code:<CODE>` → roomId).
- Every client message is validated with the shared Zod schemas; anything else is dropped.
  Eligibility is re-checked every 5 minutes, so suspensions apply mid-session.
- `/admin/*` is server-to-server only (Bearer `GAME_SERVER_ADMIN_SECRET`); the web app's staff
  routes do RBAC + audit logging before calling it. `/health` exposes liveness only.
- Logs are JSON lines with user/room ids only — never tokens, chat text or emails.

## Environment

| Var | Notes |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | service role, server-side only |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | required in production |
| `ALLOWED_ORIGINS` | comma-separated web origins (Capacitor origins are always allowed) |
| `GAME_SERVER_ADMIN_SECRET` | 32+ chars, same value as on Vercel |
| `PORT` | default 2567 |

## Deploy (Railway)

Docker build from the repo root: `apps/game-server/Dockerfile` (`RAILWAY_DOCKERFILE_PATH`).
Region Singapore, 1 replica, `/health` check, **sleeps when idle** to save credits.
