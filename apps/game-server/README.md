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

## Simulation (Phase 5)

`src/sim/simulation.ts` is a network-free, unit-tested class; the room feeds it validated
intents (verified user id only) and runs `tick()` at 20 Hz, then `rooms/sync.ts` mirrors it into
Colyseus state. It owns time/day-night, seeded weather and storms (water rises), stats and
status effects (Lakas at 0 locks sprint/jump only — walking is never slowed), movement
validation (depth bands, sprint only while server stamina allows, jump envelope, client-clock
clamp; impossible moves get a `correction`, repeated ones flag the run), axe/shove (no friendly
fire), loot holds (seeded per container × day), bag/drop/give, logged camp storage and timed
crafting. ~0.02 ms per 5-player tick.

Chat (`rooms/chat-handler.ts`): kill switch → admin chat restriction → player's chat mode →
auto-mute (Redis, escalating 10/30/120 min, repeat offenders flagged) → 1.5 s / 20 per min /
duplicate limits → shared filter (profanity masked; links, numbers, handles, addresses,
where-do-you-live and photo requests rejected) → stored in `survival_chat_messages` BEFORE
delivery → delivered only to teammates who haven't muted/blocked the sender. Reports attach
message ids + context; personal-info reports are high priority.

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
