import { ColyseusSDK } from '@colyseus/sdk';
import {
  DEFAULT_SURVIVAL_CONFIG,
  SURVIVAL_PROTOCOL_VERSION,
  survivalConfigSchema,
} from '@baha/shared/survival';
import { memoryCodeStore, memoryLimiter } from '../src/services/live.ts';
import type { Eligibility, Services } from '../src/services/types.ts';

export const PORT = 2568; // @colyseus/testing always boots a Server instance here
export const ADMIN_SECRET = 'test-admin-secret-0123456789abcdef0123';

/** Test identities: token "tok:<uuid>" verifies as that user. */
export const U = {
  host: 'aaaaaaaa-0000-4000-8000-000000000001',
  p2: 'bbbbbbbb-0000-4000-8000-000000000002',
  p3: 'cccccccc-0000-4000-8000-000000000003',
  facilitator: 'ffffffff-0000-4000-8000-000000000004',
  restricted: 'dddddddd-0000-4000-8000-000000000005',
} as const;

export interface FakeServices extends Services {
  eligible: Map<string, Eligibility>;
  setDisabled(on: boolean): void;
}

export function fakeServices(): FakeServices {
  const eligible = new Map<string, Eligibility>();
  for (const [name, id] of Object.entries(U)) {
    if (name === 'facilitator' || name === 'restricted')
      eligible.set(id, { ok: false, reason: 'not_eligible' });
    else
      eligible.set(id, {
        ok: true,
        profile: {
          userId: id,
          username: `user_${name}`,
          avatar: { hat: 'cap_red', bad: 'x'.repeat(99) },
        },
      });
  }
  let disabled = false;
  const config = survivalConfigSchema.parse(DEFAULT_SURVIVAL_CONFIG);
  return {
    eligible,
    setDisabled: (on) => {
      disabled = on;
    },
    verifyToken: async (token) =>
      token.startsWith('tok:')
        ? { userId: token.slice(4), exp: Math.floor(Date.now() / 1000) + 3600 }
        : null,
    checkEligibility: async (userId) =>
      disabled
        ? { ok: false, reason: 'survival_disabled' }
        : (eligible.get(userId) ?? { ok: false, reason: 'not_eligible' }),
    currentConfig: async () => ({ id: 'cfg-1', version: 1, config }),
    codes: memoryCodeStore(),
    limiter: memoryLimiter(),
  };
}

export function sdkFor(userId: string | null) {
  const sdk = new ColyseusSDK(`http://localhost:${PORT}`);
  if (userId) sdk.auth.token = `tok:${userId}`;
  return sdk;
}

export const createOpts = (mode: 'solo' | 'coop' = 'coop', difficulty = 'normal') => ({
  protocol: SURVIVAL_PROTOCOL_VERSION,
  mode,
  difficulty,
});
export const joinOpts = { protocol: SURVIVAL_PROTOCOL_VERSION };

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until fn() is truthy (state patches arrive asynchronously). */
export async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await wait(15);
  }
}
