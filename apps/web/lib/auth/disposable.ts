import 'server-only';
import domains from 'disposable-email-domains/index.json';
import wildcards from 'disposable-email-domains/wildcard.json';

const set = new Set<string>(domains as string[]);
const wild = wildcards as string[];

/** True when the email's domain (or a parent domain) is a known disposable provider. */
export function isDisposableEmail(email: string) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return true;
  if (set.has(domain)) return true;
  return wild.some((w) => domain === w || domain.endsWith(`.${w}`));
}
