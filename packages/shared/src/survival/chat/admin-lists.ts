import { z } from 'zod';
import type { FilWord } from './wordlist-fil.ts';

/**
 * Admin-managed chat filter additions (system_settings.survival_chat_wordlist). Plain words and
 * phrases only — never raw patterns or regex — so an admin can't break or slow the filter.
 */
export const chatWordlistSchema = z
  .object({
    /** Extra words to mask (letters/digits; matched as whole words). */
    words: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[\p{L}\d]{2,30}$/u),
      )
      .max(500),
    /** Phrases that make a message rejected (e.g. a local contact-invite slang). */
    blockedPhrases: z.array(z.string().trim().min(2).max(60)).max(200),
    version: z.number().int().min(1),
  })
  .strict();

export type ChatWordlist = z.infer<typeof chatWordlistSchema>;

export const EMPTY_WORDLIST: ChatWordlist = { words: [], blockedPhrases: [], version: 1 };

/** Admin words → obscenity phrases (whole-word match). */
export function toFilWords(words: string[]): FilWord[] {
  return words.map((w) => ({ word: w, patterns: [`|${w}|`] }));
}
