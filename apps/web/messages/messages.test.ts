import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_FILES } from './load';

const dir = path.resolve(__dirname);
const read = (p: string) =>
  JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8')) as Record<string, unknown>;

function flatten(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function load(locale: 'fil' | 'en') {
  const files = [`${locale}.json`, ...FEATURE_FILES.map((f) => `${locale}/${f}.json`)];
  const namespaces = new Map<string, string>();
  const merged: Record<string, unknown> = {};
  for (const f of files) {
    for (const [ns, v] of Object.entries(read(f))) {
      if (namespaces.has(ns))
        throw new Error(`namespace "${ns}" defined in ${namespaces.get(ns)} and ${f}`);
      namespaces.set(ns, f);
      merged[ns] = v;
    }
  }
  return merged;
}

describe('i18n catalogs', () => {
  it('have no duplicate namespaces and identical keys in fil and en', () => {
    const fil = new Set(flatten(load('fil')));
    const en = new Set(flatten(load('en')));
    expect([...fil].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !fil.has(k))).toEqual([]);
  });

  it('have no empty strings', () => {
    for (const l of ['fil', 'en'] as const) {
      const empty = flatten(load(l)).filter((k) => {
        const v = k
          .split('.')
          .reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], load(l));
        return v === '';
      });
      expect(empty).toEqual([]);
    }
  });
});
