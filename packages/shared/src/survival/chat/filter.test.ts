import { describe, expect, it } from 'vitest';
import { filterChatMessage } from './filter.ts';

const f = (t: string) => filterChatMessage(t, { maxLength: 150 });

describe('profanity is masked (still delivered)', () => {
  it.each([
    ['English', 'what the fuck is this'],
    ['English leetspeak', 'sh1t naman'],
    ['Filipino', 'gago ka talaga'],
    ['Filipino leetspeak', 'ang g4g0 mo'],
    ['stretched letters', 'bobooooo'],
    ['spaced out', 'putang ina mo'],
    ['Taglish', 'tangina lag'],
    ['sexual term', 'kantot'],
  ])('%s', (_, text) => {
    const r = f(text);
    expect(r.status).toBe('masked');
    if (r.status === 'masked') expect(r.text).toContain('*');
  });
});

describe('normal gameplay chat is never touched (no false positives)', () => {
  it.each([
    'punta tayo sa 2nd floor',
    'may 10 pako dito',
    'kailangan ko ng 3 tarp at 4 lubid',
    'nasa day 12 na tayo',
    'HAHAHAHAHA',
    'ingat sa live wire!',
    'tara sa palengke',
    'gagawa tayo ng balsa',
    'masarap ang putahe',
    'lechon mamaya pag na-rescue',
    'ang tangkad ng puno',
    'tanggal ang yero',
    'pakikinginan natin ang radyo',
    'assassin class',
    'chat tayo mamaya sa camp',
    'basa na ako, palit damit',
    'stage 4/6 na ang bangka',
    'ulo ko masakit',
    'may gagamba sa bubong',
  ])('%s', (text) => {
    expect(f(text)).toMatchObject({ status: 'delivered', text });
  });
});

describe('personal info and contact are rejected', () => {
  it.each([
    ['url', 'punta ka sa https://example.com'],
    ['url', 'www.free-robux.ph'],
    ['url', 'game ko: mysite dot com'],
    ['url', 'bit.ly/abc123'],
    ['email', 'email mo ako juan.delacruz@gmail.com'],
    ['email', 'juan (at) gmail (dot) com'],
    ['phone', '09171234567'],
    ['phone', '0917 123 4567'],
    ['phone', '0917-123-4567'],
    ['phone', '+63 917 123 4567'],
    ['phone', '(02) 8123 4567'],
    ['handle', 'follow @juan_123'],
    ['contact_invite', 'add mo ko sa fb'],
    ['contact_invite', 'may ig ka?'],
    ['contact_invite', 'pm mo ko'],
    ['contact_invite', 'chat tayo sa messenger'],
    ['contact_invite', 'discord tayo'],
    ['address', 'Blk 5 Lot 12 kami'],
    ['address', 'purok 3 bahay namin'],
  ])('%s: %s', (hit, text) => {
    const r = f(text);
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') {
      expect(r.reasonKey).toBe('personal_info');
      expect(r.hits).toContain(hit);
    }
  });
});

describe('plain text rules', () => {
  it('strips HTML and markdown, collapses long repeats', () => {
    expect(f('<b>tulong</b> **dito**')).toMatchObject({ status: 'delivered', text: 'tulong dito' });
    expect(f('tulong!!!!!!!!!!!!')).toMatchObject({ text: 'tulong!!!!' });
  });

  it('rejects empty and over-long messages', () => {
    expect(f('   ')).toMatchObject({ status: 'rejected', reasonKey: 'empty' });
    expect(f('a'.repeat(151).split('').join(' ').slice(0, 151) + 'x')).toMatchObject({
      status: 'rejected',
      reasonKey: 'too_long',
    });
  });
});
