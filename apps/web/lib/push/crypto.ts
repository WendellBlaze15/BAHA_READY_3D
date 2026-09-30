import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { serverEnv } from '@/lib/env/server';

/**
 * Push tokens/subscriptions are encrypted at rest (AES-256-GCM). The key is derived with HKDF
 * from a server secret, with a purpose-specific label so it can't be confused with other uses.
 */
function key() {
  return Buffer.from(
    hkdfSync('sha256', serverEnv().ATTEMPT_TOKEN_SECRET, 'baha-ready', 'push-subscriptions-v1', 32),
  );
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(token: string) {
  const [v, iv, tag, data] = token.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('bad token');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
