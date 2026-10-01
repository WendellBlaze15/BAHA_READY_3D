/**
 * Filipino / Taglish profanity and sexual terms masked in Survival team chat (child safety).
 * `|` marks a word boundary (obscenity pattern syntax): `|gaga|` masks "gaga" but not "gagawa".
 * Leetspeak (g4g0), spacing tricks and stretched letters (gagooo) are handled by the matcher's
 * transformers. `allow` lists everyday words that must never be masked.
 * Maintained by admins via the Survival chat-filter settings (versioned, audit-logged).
 */
export type FilWord = { word: string; patterns: string[]; allow?: string[] };

export const FILIPINO_WORDLIST: FilWord[] = [
  {
    word: 'putangina',
    patterns: [
      'putangina',
      'putang ina',
      'potangina',
      'tangina',
      'tang ina',
      '|kingina|',
      'pakingshet',
      'bwakanangina',
    ],
  },
  { word: 'puta', patterns: ['|puta|', '|putah|'], allow: ['putahe', 'putol', 'puto'] },
  { word: 'pakyu', patterns: ['pakyu', '|pak yu|', 'fakyu'] },
  { word: 'pakshet', patterns: ['pakshet', 'pakshit'] },
  {
    word: 'gago',
    patterns: ['|gago|', '|gaga|', '|gagu|', '|gagi|'],
    allow: ['gagawa', 'gagamba', 'gagamitin'],
  },
  { word: 'ulol', patterns: ['|ulol|', '|ulul|', '|olol|'], allow: ['ulo', 'ulam'] },
  { word: 'tarantado', patterns: ['tarantado', 'tarantada'] },
  { word: 'bobo', patterns: ['|bobo|', '|bobita|'] },
  {
    word: 'tanga',
    patterns: ['|tanga|', '|tangahan|', '|tange|'],
    allow: ['tangkad', 'tanggal', 'tangay'],
  },
  { word: 'leche', patterns: ['|leche|', '|letse|'], allow: ['lechon', 'leche flan'] },
  { word: 'punyeta', patterns: ['punyeta', 'punyemas'] },
  { word: 'kupal', patterns: ['|kupal|'] },
  { word: 'siraulo', patterns: ['siraulo', '|sira ulo|'] },
  // Sexual terms (never acceptable in a kids' game chat).
  { word: 'kantot', patterns: ['kantot', 'kantut', '|iyot|'] },
  { word: 'jakol', patterns: ['jakol', 'salsal'] },
  { word: 'tite', patterns: ['|tite|', '|titi|', '|burat|'] },
  { word: 'puke', patterns: ['|puke|', '|pekpek|', '|pepek|'] },
  { word: 'libog', patterns: ['libog', 'malibog'] },
  { word: 'chupa', patterns: ['|chupa|', '|tsupa|'] },
];
