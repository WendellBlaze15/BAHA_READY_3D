import 'server-only';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

export type ReportRow = {
  username: string;
  status: string;
  levels_done: number;
  stars: number;
  attempts: number;
  best_score: number;
  last_played: string | null;
};

export type GroupReport = {
  groupName: string;
  generatedAt: string;
  rows: ReportRow[];
  summary: {
    members: number;
    avgStars: number | null;
    completion: number | null;
    topMistakes: string[];
  };
};

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralize spreadsheet formula injection and quote safely.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function toCsv(r: GroupReport) {
  const header = [
    'username',
    'status',
    'levels_done',
    'stars',
    'attempts',
    'best_score',
    'last_played',
  ];
  const lines = [
    header.join(','),
    ...r.rows.map((x) => header.map((h) => csvCell(x[h as keyof ReportRow])).join(',')),
  ];
  return '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8 names correctly
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#1E2A38' },
  band: {
    backgroundColor: '#1E2A38',
    color: '#EEF2F3',
    padding: 14,
    marginBottom: 14,
    borderRadius: 6,
  },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#5a6b7b' },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: { flexGrow: 1, borderWidth: 1, borderColor: '#d5dde1', borderRadius: 6, padding: 8 },
  statVal: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e7ea',
    paddingVertical: 5,
  },
  th: { fontFamily: 'Helvetica-Bold', backgroundColor: '#EEF2F3' },
  c1: { width: '28%' },
  c: { width: '12%', textAlign: 'right' },
  foot: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 8, color: '#6b7b8a' },
});

export async function toPdf(r: GroupReport) {
  const doc = (
    <Document title={`Baha Ready — ${r.groupName}`} author="Baha Ready 3D">
      <Page size="A4" style={s.page}>
        <View style={s.band}>
          <Text style={s.h1}>Baha Ready 3D · {r.groupName}</Text>
          <Text>Group report · {r.generatedAt}</Text>
        </View>
        <View style={s.stats}>
          <View style={s.stat}>
            <Text style={s.muted}>Members</Text>
            <Text style={s.statVal}>{r.summary.members}</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.muted}>Average stars</Text>
            <Text style={s.statVal}>{r.summary.avgStars ?? '—'}</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.muted}>Completion</Text>
            <Text style={s.statVal}>
              {r.summary.completion === null ? '—' : `${Math.round(r.summary.completion * 100)}%`}
            </Text>
          </View>
        </View>
        {r.summary.topMistakes.length > 0 && (
          <Text style={{ marginBottom: 10 }}>Top mistakes: {r.summary.topMistakes.join(', ')}</Text>
        )}
        <View style={[s.row, s.th]}>
          <Text style={s.c1}>Username</Text>
          <Text style={s.c}>Status</Text>
          <Text style={s.c}>Levels</Text>
          <Text style={s.c}>Stars</Text>
          <Text style={s.c}>Games</Text>
          <Text style={s.c}>Best</Text>
          <Text style={s.c}>Last</Text>
        </View>
        {r.rows.map((x) => (
          <View key={x.username} style={s.row} wrap={false}>
            <Text style={s.c1}>{x.username}</Text>
            <Text style={s.c}>{x.status}</Text>
            <Text style={s.c}>{x.levels_done}</Text>
            <Text style={s.c}>{x.stars}</Text>
            <Text style={s.c}>{x.attempts}</Text>
            <Text style={s.c}>{x.best_score}</Text>
            <Text style={s.c}>{x.last_played ? x.last_played.slice(0, 10) : '—'}</Text>
          </View>
        ))}
        <Text style={s.foot} fixed>
          Usernames only (RA 10173). Safety content is being verified with the MDRRMO/NDRRMC.
        </Text>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
