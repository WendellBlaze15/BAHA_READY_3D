import {
  DataSet,
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
} from 'obscenity';
import { FILIPINO_WORDLIST, type FilWord } from './wordlist-fil.ts';

/**
 * Survival team-chat filter (Section 17.1). Runs on the GAME SERVER for every message.
 * - Profanity (English + Filipino/Taglish, leetspeak): masked with ****, still delivered.
 * - Personal info / contact (links, emails, PH phone numbers, handles, "add mo ko sa fb",
 *   addresses, where-do-you-live / photo requests): REJECTED, sender gets a friendly notice. (Anti-grooming, privacy.)
 * - Plain text only: HTML/markdown stripped, repeated characters collapsed.
 */
export type FilterHit =
  | 'profanity'
  | 'url'
  | 'email'
  | 'phone'
  | 'handle'
  | 'contact_invite'
  | 'address'
  | 'location_request'
  | 'photo_request'
  | 'blocked_phrase';

export type FilterResult =
  | { status: 'delivered' | 'masked'; text: string; hits: FilterHit[]; maskedWords: number }
  | { status: 'rejected'; reasonKey: 'empty' | 'too_long' | 'personal_info'; hits: FilterHit[] };

function buildMatcher(extra: FilWord[]) {
  const ds = new DataSet<{ originalWord: string }>().addAll(englishDataset);
  for (const w of [...FILIPINO_WORDLIST, ...extra]) {
    ds.addPhrase((p) => {
      let phrase = p.setMetadata({ originalWord: w.word });
      for (const pat of w.patterns) phrase = phrase.addPattern(parseRawPattern(pat));
      for (const ok of w.allow ?? []) phrase = phrase.addWhitelistedTerm(ok);
      return phrase;
    });
  }
  return new RegExpMatcher({ ...ds.build(), ...englishRecommendedTransformers });
}

let defaultMatcher: RegExpMatcher | null = null;
const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

// ── Personal-info detectors (applied to a leetspeak-normalized copy) ─────
const TLD = '(?:com|ph|net|org|io|me|gg|xyz|co|app|ly|tk|info|biz|link|site|online)';
const URL_RE = new RegExp(
  String.raw`(?:https?:\/\/|www\.|\b(?:bit\.ly|tinyurl|t\.me|goo\.gl|discord\.gg)\b|\b[a-z0-9-]{2,}\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*${TLD}\b)`,
  'i',
);
const EMAIL_RE =
  /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+\s*(?:\.|\sdot\s|\(dot\))\s*[a-z]{2,}/i;
/** 7+ digits even when split with spaces, dashes, dots or brackets (09XX XXX XXXX, +63 9XX…). */
const PHONE_RE = /(?:\+?\d[\s\-.()]{0,3}){7,}/;
const HANDLE_RE = /(?:^|[\s(])@[a-z0-9_.]{2,}/i;
const PLATFORM =
  '(?:fb|facebook|ig|insta|instagram|tiktok|discord|telegram|viber|whatsapp|snapchat|snap|messenger|twitter|gcash|roblox)';
const PLATFORM_RE = new RegExp(String.raw`\b${PLATFORM}\b`, 'i');
/** Contact intent ("pm mo ko", "add mo ako", "text me"). Plain "chat tayo" stays allowed —
 *  chat only exists inside the room; platform names are caught by PLATFORM_RE. */
const INVITE_RE =
  /\b(?:(?:add|follow|pm|dm|text|txt|call|tawagan|message|msg|kontakin|contact)\s+(?:mo\s+)?(?:me|ako|ko|kami)|(?:pm|dm)\s+(?:mo|kita|me))\b/i;
const ADDRESS_RE = /\b(?:blk|block|lot|purok|sitio)\.?\s*#?\s*\d+/i;
/**
 * Grooming red flags: asking where someone lives or studies. In-game location talk ("saan ka
 * na?", "punta tayo sa school") stays allowed — only home/school-of-the-person questions match.
 */
const LOCATION_RE =
  /\b(?:sa?an\s+(?:ka|kayo)\s+(?:naka\s*tira|tumitira)|taga\s*sa?an\s+(?:ka|kayo)|where\s+(?:do\s+)?(?:you|u)\s+live|(?:ano(?:ng)?|what'?s?|wats)\s+(?:(?:ang|is)\s+)?(?:your|ur|yung)?\s*address|address\s+(?:mo|nyo|ninyo)|(?:ano(?:ng)?|saang?)\s+(?:school|eskwelahan|paaralan)\s+(?:mo|ka|nyo)|sa?an\s+(?:ka|kayo)\s+nag[-\s]?aaral|what\s+school\s+(?:do\s+)?(?:you|u))\b/i;
/** Requests for photos of the person. */
const PHOTO_RE =
  /\b(?:(?:send|padala|pasend|sendan)\s+(?:mo\s+)?(?:(?:me|ako|ng)\s+)?(?:pic|pics|picture|photo|selfie|litrato)|pakita\s+(?:mo\s+)?(?:ang\s+)?(?:mukha|itsura)|(?:pic|picture|photo|selfie)\s+(?:mo|nyo))\b/i;

/** Normalizes leetspeak for detection only (the delivered text keeps the user's characters). */
function normalize(s: string) {
  return s.toLowerCase().replace(/\$/g, 's').replace(/€/g, 'e').replace(/\s+/g, ' ');
}

export function filterChatMessage(
  raw: string,
  opts: {
    maxLength: number;
    extraWords?: FilWord[];
    /** Admin-managed phrases that are always rejected (plain text, case-insensitive). */
    blockedPhrases?: string[];
  },
): FilterResult {
  // Plain text: strip HTML tags and markdown emphasis, collapse whitespace and long repeats.
  let text = raw
    .replace(/<[^>]*>/g, '')
    .replace(/[*_~`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(.)\1{4,}/gu, '$1$1$1$1');
  if (!text) return { status: 'rejected', reasonKey: 'empty', hits: [] };
  if ([...text].length > opts.maxLength)
    return { status: 'rejected', reasonKey: 'too_long', hits: [] };

  const n = normalize(text);
  const hits: FilterHit[] = [];
  if (URL_RE.test(n)) hits.push('url');
  if (EMAIL_RE.test(n)) hits.push('email');
  if (PHONE_RE.test(n) && (n.match(/\d/g)?.length ?? 0) >= 7) hits.push('phone');
  if (HANDLE_RE.test(n)) hits.push('handle');
  if (PLATFORM_RE.test(n) || INVITE_RE.test(n)) hits.push('contact_invite');
  if (ADDRESS_RE.test(n)) hits.push('address');
  if (LOCATION_RE.test(n)) hits.push('location_request');
  if (PHOTO_RE.test(n)) hits.push('photo_request');
  if (opts.blockedPhrases?.some((p) => p.trim() && n.includes(p.trim().toLowerCase())))
    hits.push('blocked_phrase');
  if (hits.length) return { status: 'rejected', reasonKey: 'personal_info', hits };

  const matcher = opts.extraWords?.length
    ? buildMatcher(opts.extraWords)
    : (defaultMatcher ??= buildMatcher([]));
  const matches = matcher.getAllMatches(text, true);
  let masked = matches.length;
  if (masked) text = censor.applyTo(text, matches);
  // Second pass per word with stretched letters collapsed ("bobooooo" → "bobo"): the library
  // keeps some doubled letters, which defeats word-boundary patterns like |bobo|.
  text = text.replace(/[\p{L}\d@$]+/gu, (word) => {
    if (word.includes('*')) return word;
    const once = word.replace(/(.)\1+/gu, '$1');
    if (once !== word && matcher.hasMatch(once)) {
      masked++;
      return '*'.repeat([...word].length);
    }
    return word;
  });
  if (!masked) return { status: 'delivered', text, hits: [], maskedWords: 0 };
  return { status: 'masked', text, hits: ['profanity'], maskedWords: masked };
}

/** Friendly notices (bilingual) for rejected messages. */
export const CHAT_REJECT_NOTICE = {
  personal_info: {
    fil: 'Hindi pwedeng magbahagi ng personal na impormasyon o link sa chat para sa kaligtasan ng lahat.',
    en: "For everyone's safety, personal info and links can't be shared in chat.",
  },
  too_long: { fil: 'Masyadong mahaba ang mensahe.', en: 'That message is too long.' },
  empty: { fil: 'Walang laman ang mensahe.', en: 'The message is empty.' },
} as const;
