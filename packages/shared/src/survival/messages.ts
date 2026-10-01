import { z } from 'zod';
import { DIFFICULTIES, ROLES } from './config.ts';

/**
 * Colyseus client → server messages (Section 20.2 + owner add-ons: jump, sprint, axe attack).
 * The game server validates EVERY payload with these schemas and drops anything else.
 */
const coord = z.number().finite().min(-500).max(500);
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_:-]+$/);
const uuid = z.uuid();
const slot = z.number().int().min(0).max(39);
const itemKey = z.string().regex(/^[a-z0-9_]{2,40}$/);

export const clientMessages = {
  'lobby:setRole': z.object({ role: z.enum(ROLES) }).strict(),
  'lobby:ready': z.object({ ready: z.boolean() }).strict(),
  'lobby:setDifficulty': z.object({ difficulty: z.enum(DIFFICULTIES) }).strict(),
  'lobby:kick': z.object({ userId: uuid }).strict(),
  'lobby:start': z.object({}).strict(),
  'cutscene:done': z.object({}).strict(),
  move: z
    .object({
      x: coord,
      y: z.number().finite().min(-10).max(60),
      z: coord,
      vx: z.number().finite().min(-30).max(30),
      vz: z.number().finite().min(-30).max(30),
      rotY: z.number().finite(),
      anim: z.enum(['idle', 'walk', 'run', 'swim', 'jump', 'fall', 'crawl', 'swing', 'emote']),
      /** Sprint input held (the server decides whether sprint is actually active). */
      sprinting: z.boolean(),
      grounded: z.boolean(),
      /** Client timestamp (ms since session start), for ordering. */
      t: z.number().int().min(0),
    })
    .strict(),
  'action:jump': z.object({ t: z.number().int().min(0) }).strict(),
  'action:attack': z
    .object({
      dir: z.number().finite(),
      clientSeq: z
        .number()
        .int()
        .min(0)
        .max(2 ** 31),
    })
    .strict(),
  interact: z.object({ targetId: id }).strict(),
  useItem: z.object({ slot, targetUserId: uuid.optional() }).strict(),
  'bag:move': z.object({ from: slot, to: slot }).strict(),
  'bag:drop': z.object({ slot, qty: z.number().int().min(1).max(200) }).strict(),
  'bag:split': z.object({ slot, qty: z.number().int().min(1).max(199) }).strict(),
  'bag:equip': z.object({ slot }).strict(),
  'give:offer': z.object({ toUserId: uuid, slot }).strict(),
  'give:accept': z.object({ offerId: id }).strict(),
  'storage:deposit': z.object({ itemKey, qty: z.number().int().min(1).max(200) }).strict(),
  'storage:withdraw': z.object({ itemKey, qty: z.number().int().min(1).max(200) }).strict(),
  craft: z.object({ recipeKey: itemKey }).strict(),
  build: z
    .object({ target: z.enum(['boat', 'camp', 'signal']), action: z.enum(['deposit', 'work']) })
    .strict(),
  revive: z.object({ targetUserId: uuid }).strict(),
  'chat:send': z.object({ text: z.string().max(600), clientMsgId: id }).strict(),
  'chat:mute': z.object({ userId: uuid }).strict(),
  'chat:unmute': z.object({ userId: uuid }).strict(),
  'chat:report': z
    .object({
      messageId: z.number().int().min(1),
      reason: z.enum([
        'chat_harassment',
        'chat_language',
        'personal_info_request',
        'griefing',
        'afk',
        'offensive_name_avatar',
        'other',
      ]),
    })
    .strict(),
  quickChat: z.object({ id: z.number().int().min(0).max(31) }).strict(),
  ping: z
    .object({
      type: z.enum(['item', 'danger', 'go', 'help']),
      x: coord,
      y: z.number().finite(),
      z: coord,
    })
    .strict(),
  emote: z
    .object({ id: z.enum(['wave', 'thumbs_up', 'dance', 'point', 'cry', 'celebrate']) })
    .strict(),
  vote: z
    .object({
      type: z.enum(['rest', 'kick', 'abandon']),
      targetUserId: uuid.optional(),
      value: z.boolean(),
    })
    .strict(),
  pause: z.object({ paused: z.boolean() }).strict(),
} as const;

export type ClientMessageType = keyof typeof clientMessages;
export type ClientMessage<T extends ClientMessageType> = z.infer<(typeof clientMessages)[T]>;

/** Validates a raw message; returns null for unknown types or bad payloads (server drops them). */
export function parseClientMessage(type: string, payload: unknown) {
  if (!Object.prototype.hasOwnProperty.call(clientMessages, type)) return null;
  const schema = clientMessages[type as ClientMessageType];
  const r = schema.safeParse(payload);
  return r.success ? { type: type as ClientMessageType, data: r.data } : null;
}

/** Bilingual quick-chat wheel (Section 17.2) — ids are stable, text shown in each viewer's language. */
export const QUICK_CHAT = [
  { fil: 'Tulong!', en: 'Help!' },
  { fil: 'Dito!', en: 'Over here!' },
  { fil: 'Sundan mo ako', en: 'Follow me' },
  { fil: 'May nakita akong gamit', en: 'Found something' },
  { fil: 'Kailangan ko ng pagkain', en: 'I need food' },
  { fil: 'Kailangan ko ng tubig', en: 'I need water' },
  { fil: 'Kailangan ko ng bandage', en: 'I need a bandage' },
  { fil: 'Mag-ingat!', en: 'Careful!' },
  { fil: 'Balik sa camp', en: 'Back to camp' },
  { fil: 'Salamat!', en: 'Thanks!' },
  { fil: 'Magaling!', en: 'Nice!' },
  { fil: 'Sige', en: 'OK' },
  { fil: 'Hindi', en: 'No' },
] as const;
