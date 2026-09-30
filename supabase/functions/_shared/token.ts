// Short-lived, single-purpose attempt tokens: HMAC-SHA256(attemptId.userId.exp).
// Single-use is enforced by the attempt row leaving `in_progress` on submit.
const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function key() {
  const secret = Deno.env.get('ATTEMPT_TOKEN_SECRET');
  if (!secret || secret.length < 32) throw new Error('ATTEMPT_TOKEN_SECRET missing');
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export const TOKEN_TTL_SEC = 30 * 60;

export async function signAttemptToken(attemptId: string, userId: string, ttlSec = TOKEN_TTL_SEC) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${attemptId}.${userId}.${exp}`;
  const sig = await crypto.subtle.sign('HMAC', await key(), enc.encode(payload));
  return { token: `${b64url(enc.encode(payload))}.${b64url(sig)}`, exp };
}

export async function verifyAttemptToken(token: string, attemptId: string, userId: string) {
  const [p, s] = token.split('.');
  if (!p || !s) return false;
  let payload: string;
  try {
    payload = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return false;
  }
  const [aId, uId, expStr] = payload.split('.');
  if (aId !== attemptId || uId !== userId) return false;
  // Pauses are allowed; tokens outlive a normal run, but never more than TTL + 15 min grace.
  if (Number(expStr) + 15 * 60 < Math.floor(Date.now() / 1000)) return false;
  const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  return crypto.subtle.verify('HMAC', await key(), sig, enc.encode(payload));
}
