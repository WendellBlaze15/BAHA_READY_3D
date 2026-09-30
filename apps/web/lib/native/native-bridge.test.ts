import { describe, expect, it } from 'vitest';
import { deepLinkToPath } from './native-bridge';

describe('deepLinkToPath', () => {
  it('maps custom-scheme join links to the join form', () => {
    expect(deepLinkToPath('bahaready://join/abc234')).toBe('/groups?code=ABC234');
  });
  it('maps custom-scheme paths', () => {
    expect(deepLinkToPath('bahaready://play/signal-1')).toBe('/play/signal-1');
  });
  it('keeps same-host App Links', () => {
    expect(
      deepLinkToPath(
        'https://baha-ready-3d.vercel.app/groups?code=ABC234',
        'baha-ready-3d.vercel.app',
      ),
    ).toBe('/groups?code=ABC234');
  });
  it('rejects foreign hosts and junk', () => {
    expect(deepLinkToPath('https://evil.example/home', 'baha-ready-3d.vercel.app')).toBeNull();
    expect(deepLinkToPath('javascript:alert(1)')).toBeNull();
    expect(deepLinkToPath('not a url')).toBeNull();
    expect(deepLinkToPath('bahaready://x/<script>')).toBeNull();
  });
});
