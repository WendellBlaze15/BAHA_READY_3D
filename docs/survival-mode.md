# Survival Mode

Co-op (1–5 players) 30-day flood-survival game. Players hold out in a flooded barangay, build a
boat in 6 stages, keep the camp alive through storms, help other survivors, and are rescued by
helicopter on Day 30. Every lesson in the game is a real flood-safety habit.

Survival Mode is an add-on: the Signal levels, accounts, groups and admin tools work the same as
before. It has its own game server (`apps/game-server`), its own tables (`survival_*`), and its
own pages under `/survival` (players) and `/admin/survival` (staff).

## Who can play

Only **players** (role 2) who are not facilitators, admins or super admins, not suspended, and
not under a Survival restriction. This rule lives in one database function, `can_play_survival()`.
It is checked:

- in the web app's route guard (`/survival`, from the `can_play_survival` JWT claim),
- again on every Survival API call (live, not the token),
- by the game server before a room is created or joined, and every 5 minutes during a game.

Guests see a teaser card that tells them to sign up.

## How a game works

| Step | What happens |
|---|---|
| New game | The host picks Solo or With others and a difficulty. The web app asks the game server for a room. |
| Lobby | Others join with the 6-character code or the invite link (`/survival/join/CODE`; the Android app opens `bahaready://survival/join/CODE`). Each picks a role (Medic, Builder, Scout, Cook, Radio) and taps Ready. |
| Story | A 6-panel intro, synced for the team. Anyone can skip; the game starts when everyone has finished or skipped. |
| Playing | 20 ticks a second on the server. The server is the referee for movement, stats, loot, crafting, building, chat and votes. |
| Saving | Saved at the start, every dawn, every couple of minutes, when the room closes and when the server restarts. **Continue** on the hub reopens the game where the team left it. |
| Ending | Rescue on Day 30 (or by boat), or the team is lost. Everyone sees the results screen, the lessons learned, rewards and the leaderboard. |

### Controls

| Action | Keyboard / mouse | Phone |
|---|---|---|
| Move | WASD | Left joystick |
| Look | Drag | Drag on the right side |
| Sprint (uses energy) | Shift | Wind button |
| Jump | Space | Arrow button |
| Axe / shove | Left click or F | Axe button |
| Use / pick up | E | The big yellow button |

Running out of energy ("Hingal") only locks sprint and jump until it refills. **Walking is never slowed.**

## Safety and moderation

- **Text chat** goes through the shared filter: bad words are masked, and links, phone numbers,
  social handles, addresses, "where do you live?" and photo requests are blocked. Messages are
  stored before delivery, kept for 14 days, then purged.
- Players can mute, block (they won't be matched again) and report. Personal-information reports
  are high priority.
- Repeat offenders are auto-muted (10 / 30 / 120 minutes) and flagged for staff.
- Each player can set Survival chat to full, quick chat only, or off (Settings → Survival).

**Staff console** (`/admin/survival`, MFA required):

- live rooms, with force-close
- the reports queue, with chat evidence (every view is audited)
- restrictions
- the chat word list, with a test box
- the game config editor (diff, then publish a new version)
- analytics
- the **kill switch** (super admin only, re-authentication needed): running games get a
  5-minute warning, are saved, then close.

## Architecture

```
Browser / Android app ──wss──▶ Game server (Colyseus, Railway, Singapore)
        │                              │
        │ https (API routes)           │ service role
        ▼                              ▼
   Next.js on Vercel ───────────▶ Supabase (Postgres + RLS)
                  admin API (Bearer secret)   Upstash Redis (codes, rate limits, live runs)
```

- Shared rules: `packages/shared/src/survival` (config schema, items, recipes, map, movement
  check, chat filter, lessons). Both the server and the browser use them.
- Server: `apps/game-server`. See its [README](../apps/game-server/README.md) for the security
  model, simulation and environment.
- Client:
  - `apps/web/game/survival`: the 3D world, local player, and session store.
  - `apps/web/components/survival`: hub, lobby, HUD, panels, chat, results.
- Database: `supabase/migrations/2026100100xxxx_survival_*.sql`, tested by
  `supabase/tests/03–05_survival*.sql`.

## Mobile and performance

- Mobile first. The game is designed for phones in landscape. On short screens the HUD is
  compacted (the `short:` Tailwind variant, max-height 480 px). Notifications are small pills at
  the top, never in the middle of the screen, and repeated messages don't stack.
- In the Android app, the game locks to landscape and keeps the screen awake. Leaving the app
  counts as a disconnect, and the player is reconnected on return.
- Loot and platforms are instanced meshes. Teammates re-render only when their data changes.
  About 50–60 draw calls on a phone.

## Testing

| Command | What it checks |
|---|---|
| `pnpm test` | Unit tests: shared rules, server rooms (`@colyseus/testing`), web logic |
| `pnpm test:db` | pgTAP: who can see/do what (always rolled back) |
| `pnpm --filter @baha/game-server loadtest 50 60` | 50 rooms × 5 bots for 60 s; passes if the p99 room tick is under 10 ms |
| `node scripts/with-env.mjs node --import tsx scripts/survival-e2e.ts` | 3 real players in browsers: create, join by link and by code, roles, story, 3D, walking, chat, reload/reconnect, draw-call budget |
| `node scripts/with-env.mjs node --import tsx scripts/responsive-audit.ts` | Signal levels and Survival screens on phone (portrait and landscape), tablet and desktop: overlapping or cut-off text, buttons covered, off-screen or smaller than 24 px, sideways scrolling, axe WCAG 2.1 AA |
| `node scripts/with-env.mjs node --import tsx scripts/survival-profile.ts` | CPU profile of a solo game (hot functions) |
| `pnpm test:journeys` | Cross-role journeys, including Survival access rules |

Set `BASE=https://…` to run the browser scripts against a deployed site. They create temporary
`@test.local` users and delete them afterwards.

### Load test result (local, Windows laptop)

50 rooms × 5 bots for 60 s:

- room tick p50 0.04 ms · p99 0.22 ms · max 5.4 ms (budget 10 ms)
- server CPU ≈ 68 % of one core
- 193 MB RAM
- 0 movement corrections

One 1-vCPU instance is enough for about 50 concurrent games.

## Deploying

- **Web:** Vercel deploys on every push to `main`.
- **Game server:**
  - The GitHub workflow `.github/workflows/game-server.yml` runs the room tests and a short load
    test when the server or the shared rules change. It then deploys to Railway with the
    project token (`RAILWAY_TOKEN` secret) and checks `/health`.
  - By hand: `pnpm run setup railway`, then `pnpm run setup railway-deploy`.
- **Railway runs on trial credits only.** The service sleeps when idle. `pnpm run setup railway`
  prints the remaining credits. Moving to a paid plan is the owner's decision.

## Needs a person

- **Rotate the Railway token, and any other key pasted in chat:** Railway → Account → Tokens.
  Then update `.env.local` and re-run `pnpm run setup railway`.
- **Real-device playtest:** a full 5-player co-op game on real phones, checking FPS, heat and
  battery.
- **Check the health lessons:** lines marked `VERIFY WITH DOH/MDRRMO` in
  `packages/shared/src/survival/learning.ts` need review by the research team.
- **iOS app:** needs an Apple Developer account.
