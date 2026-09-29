import { z } from 'zod';

// Shared auth input schemas (client forms + route handlers). Unknown keys are rejected.

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'errors.email_invalid')
  .pipe(z.email('errors.email_invalid'));

export const otpSchema = z.string().regex(/^\d{6}$/, 'errors.otp_format');

/** Hidden honeypot field: must be empty. Bots that fill it get a fake success. */
export const honeypotSchema = z.string().max(200).optional();

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Minimal profanity blocklist (Filipino + English). Matched as substrings, case-insensitive.
// DECISION: only unambiguous stems, to avoid false positives like "reputation" or "Dickson".
const BLOCKED = [
  'putang',
  'tangina',
  'gago',
  'ulol',
  'kupal',
  'pakyu',
  'fuck',
  'shit',
  'bitch',
  'pussy',
  'nigg',
  'cunt',
  // Reserved: prevents impersonating staff or agencies.
  'admin',
  'moderator',
  'bahaready',
  'official',
  'mdrrmo',
  'ndrrmc',
  'pagasa',
];

export function isCleanUsername(name: string) {
  const n = name.toLowerCase().replace(/_/g, '');
  return !BLOCKED.some((w) => n.includes(w));
}

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_RE, 'errors.username_format')
  .refine(isCleanUsername, 'errors.username_blocked');

export const otpRequestSchema = z
  .object({
    email: emailSchema,
    mode: z.enum(['signin', 'signup']),
    locale: z.enum(['fil', 'en']).default('fil'),
    website: honeypotSchema,
  })
  .strict();

export const otpVerifySchema = z
  .object({ email: emailSchema, token: otpSchema, website: honeypotSchema })
  .strict();

export const passwordSignInSchema = z
  .object({
    identifier: z.string().trim().min(3, 'errors.required').max(254),
    password: z.string().min(1, 'errors.required').max(200),
    website: honeypotSchema,
  })
  .strict();

export const PASSWORD_MIN = 10;
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, 'errors.password_short')
  .max(200, 'errors.password_long');

export const forgotPasswordSchema = z
  .object({ email: emailSchema, website: honeypotSchema })
  .strict();

export const resetPasswordSchema = z
  .object({ email: emailSchema, token: otpSchema, password: newPasswordSchema })
  .strict();

export const reauthSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('otp_request') }).strict(),
  z.object({ method: z.literal('otp'), token: otpSchema }).strict(),
  z.object({ method: z.literal('totp'), code: otpSchema }).strict(),
  z.object({ method: z.literal('password'), password: z.string().min(1).max(200) }).strict(),
]);

export const AVATAR_PRESETS = [
  'lakeside',
  'jeepney',
  'palengke',
  'rescuer',
  'student',
  'fisher',
] as const;

export const onboardingSchema = z
  .object({
    username: usernameSchema,
    avatarPreset: z.enum(AVATAR_PRESETS),
    language: z.enum(['fil', 'en']),
    barangay: z.string().trim().max(80).optional().or(z.literal('')),
    school: z.string().trim().max(120).optional().or(z.literal('')),
    isMinor: z.boolean(),
    consent: z.literal(true, 'errors.consent_required'),
  })
  .strict();

export type OnboardingInput = z.infer<typeof onboardingSchema>;

// Barangays of Pila, Laguna — VERIFY WITH MDRRMO before public release.
export const PILA_BARANGAYS = [
  'Aplaya',
  'Bagong Pook',
  'Bukal',
  'Bulilan Norte (Poblacion)',
  'Bulilan Sur (Poblacion)',
  'Concepcion',
  'Labuin',
  'Linga',
  'Masico',
  'Mojon',
  'Pansol',
  'Pinagbayanan',
  'San Antonio',
  'San Miguel',
  'Santa Clara Norte (Poblacion)',
  'Santa Clara Sur (Poblacion)',
  'Tubuan',
] as const;
