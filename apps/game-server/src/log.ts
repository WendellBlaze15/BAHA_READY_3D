/**
 * One-line JSON logs (Railway's log viewer parses them). Never pass tokens, keys, chat text or
 * emails here — user ids and room ids only.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min: Level =
  process.env.NODE_ENV === 'test'
    ? 'warn'
    : process.env.NODE_ENV === 'production'
      ? 'info'
      : 'debug';

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (ORDER[level] < ORDER[min]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => write('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => write('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => write('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => write('error', m, c),
};

export function errInfo(e: unknown) {
  return e instanceof Error ? { err: e.message, name: e.name } : { err: String(e) };
}
