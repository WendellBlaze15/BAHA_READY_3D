/** Connection policy set once at boot from the validated env (tests override it). */
export interface Policy {
  allowedOrigins: string[];
  /** Reject connections with no Origin header (production: yes; tests/dev scripts: no). */
  requireOrigin: boolean;
}

let policy: Policy = { allowedOrigins: [], requireOrigin: false };

export function setPolicy(p: Policy) {
  policy = { ...p, allowedOrigins: p.allowedOrigins.map((o) => o.replace(/\/+$/, '')) };
}

export function originAllowed(origin: string | null | undefined): boolean {
  if (!origin) return !policy.requireOrigin;
  return policy.allowedOrigins.includes(origin.replace(/\/+$/, ''));
}

export function allowedOrigins() {
  return policy.allowedOrigins;
}
