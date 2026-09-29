import type { ApiError } from '@baha/shared/api';

export class ApiClientError extends Error {
  code: ApiError['code'];
  messageKey: string;
  fields: Record<string, string>;
  retryAfter?: number;
  constructor(err: ApiError) {
    super(err.code);
    this.code = err.code;
    this.messageKey = err.message;
    this.fields = err.fields ?? {};
    this.retryAfter = err.retry_after;
  }
}

/** POST JSON to a same-origin API route and unwrap the `{ data, error }` envelope. */
export async function apiPost<T>(url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError({ code: 'INTERNAL', message: 'errors.generic' });
  }
  const envelope = (await res.json().catch(() => null)) as {
    data: T;
    error: ApiError | null;
  } | null;
  if (!res.ok || !envelope || envelope.error) {
    const retry = Number(res.headers.get('Retry-After')) || undefined;
    throw new ApiClientError(
      envelope?.error ?? {
        code: res.status === 429 ? 'RATE_LIMITED' : 'INTERNAL',
        message: 'errors.generic',
        retry_after: retry,
      },
    );
  }
  return envelope.data;
}
