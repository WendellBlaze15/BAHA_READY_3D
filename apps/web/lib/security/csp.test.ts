import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

const connectSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('connect-src')) ?? '';

describe('buildCsp', () => {
  const base = { dev: false, supabaseUrl: 'https://abc.supabase.co' };

  it('allows Supabase only when no game server is configured', () => {
    const c = connectSrc(buildCsp('n', base));
    expect(c).toBe("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
  });

  it('adds the game server https + wss origins (no path)', () => {
    const c = connectSrc(
      buildCsp('n', { ...base, gameServerUrl: 'wss://game.example.app/some/path' }),
    );
    expect(c).toContain('https://game.example.app');
    expect(c).toContain('wss://game.example.app');
    expect(c).not.toContain('/some/path');
  });

  it('uses ws/http for a local game server', () => {
    const c = connectSrc(
      buildCsp('n', { ...base, dev: true, gameServerUrl: 'ws://localhost:2567' }),
    );
    expect(c).toContain('http://localhost:2567');
    expect(c).toContain('ws://localhost:2567');
  });
});
