import { z } from 'zod';

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'MAINTENANCE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  /** i18n message key, e.g. `errors.rate_limited`. Never a stack trace. */
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  retry_after: z.number().int().nonnegative().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export type ApiEnvelope<T> = { data: T; error: null } | { data: null; error: ApiError };

export const ok = <T>(data: T): ApiEnvelope<T> => ({ data, error: null });
export const fail = (error: ApiError): ApiEnvelope<never> => ({ data: null, error });

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  MAINTENANCE: 503,
  INTERNAL: 500,
};

export const paginationSchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
