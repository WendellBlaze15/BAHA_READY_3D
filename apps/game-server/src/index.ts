import { NATIVE_ORIGINS, loadEnv } from './env.ts';
import { errInfo, log } from './log.ts';
import { setPolicy } from './policy.ts';
import { setServices } from './services/index.ts';
import { liveServices } from './services/live.ts';
import { buildServer } from './app.ts';

const env = loadEnv();
setPolicy({
  allowedOrigins: [...env.ALLOWED_ORIGINS, ...NATIVE_ORIGINS],
  requireOrigin: env.NODE_ENV === 'production',
});
const svc = liveServices(env);
setServices(svc);

// Fail fast if Supabase or the config is unreachable — Railway restarts the container.
await svc.currentConfig();

const server = buildServer(env.GAME_SERVER_ADMIN_SECRET);
server.onShutdown(() => log.info('shutdown complete'));
process.on('unhandledRejection', (e) => log.error('unhandled rejection', errInfo(e)));

await server.listen(env.PORT, '0.0.0.0');
log.info('game server listening', {
  port: env.PORT,
  env: env.NODE_ENV,
  origins: env.ALLOWED_ORIGINS.length,
  redis: Boolean(env.UPSTASH_REDIS_REST_URL),
  replica: env.RAILWAY_REPLICA_ID,
});
