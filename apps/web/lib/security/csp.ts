/**
 * Per-request Content-Security-Policy (Section 14). Scripts are nonce-gated with
 * 'strict-dynamic' so Next's chunks (loaded by the nonced bootstrap) run but injected
 * scripts don't. 'wasm-unsafe-eval' allows Rapier's WASM physics only — no JS eval.
 * DECISION: style-src keeps 'unsafe-inline' — Radix/motion/R3F set inline style attributes,
 * which nonces can't cover; style injection is far lower risk than script injection.
 */
export function buildCsp(
  nonce: string,
  opts: { dev: boolean; supabaseUrl: string; gameServerUrl?: string },
) {
  const sb = new URL(opts.supabaseUrl);
  const supabase = `${sb.protocol}//${sb.host}`;
  const supabaseWs = `wss://${sb.host}`;
  // Survival game server: HTTP matchmaking + WebSocket on the same host.
  const game: string[] = [];
  if (opts.gameServerUrl) {
    const g = new URL(opts.gameServerUrl);
    const secure = g.protocol === 'wss:' || g.protocol === 'https:';
    game.push(`${secure ? 'https' : 'http'}://${g.host}`, `${secure ? 'wss' : 'ws'}://${g.host}`);
  }
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      ...(opts.dev ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', supabase],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", supabase, supabaseWs, ...game, ...(opts.dev ? ['ws:'] : [])],
    'media-src': ["'self'", 'data:', 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!opts.dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function makeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
