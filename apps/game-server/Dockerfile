# Baha Ready 3D — Survival game server (Colyseus). Build context = repo root:
#   docker build -f apps/game-server/Dockerfile .
# Runs TypeScript directly with tsx (the shared package ships as TS source), so there is no
# separate compile step; `pnpm typecheck` in CI guards the types.
FROM node:22-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
# Manifests first for layer caching (all workspace manifests so the frozen lockfile matches).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY apps/game-server/package.json apps/game-server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@baha/game-server..."

FROM node:22-slim
ENV NODE_ENV=production PORT=2567
WORKDIR /repo
COPY --from=deps /repo /repo
COPY packages/shared/src packages/shared/src
COPY apps/game-server/src apps/game-server/src
WORKDIR /repo/apps/game-server
USER node
EXPOSE 2567
# Colyseus handles SIGTERM: rooms get onBeforeShutdown (snapshot save in Phase 7), then exit.
CMD ["node", "--import", "tsx", "src/index.ts"]
