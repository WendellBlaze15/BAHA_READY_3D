// Shared, email-client-safe HTML layout (tables + inline styles) for every Baha Ready email.
// Used for Supabase Auth templates (Go template vars like {{ .Token }}) and Brevo templates
// (Brevo vars like {{ params.name }}). Bilingual: Filipino first, then English.

export const brand = {
  slate: '#1E2A38',
  lake: '#2F6F7E',
  amber: '#F2A516',
  red: '#D2402F',
  green: '#2E8B57',
  mist: '#EEF2F3',
  signals: ['#3F8FD2', '#F2C416', '#F2A516', '#E0672A', '#D2402F'],
};

const font = `'Atkinson Hyperlegible', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const display = `'Barlow Condensed', 'Arial Narrow', 'Segoe UI', Arial, sans-serif`;

export type LangBlock = {
  heading: string;
  intro: string;
  /** Optional HTML rendered after the intro (e.g. a code box or button). */
  action?: string;
  after?: string;
};

export type EmailSpec = {
  preheader: string;
  /** Accent color for the top band (defaults to lake). */
  accent?: string;
  /** Filled segments (1–5) of the Storm Signal Meter in the header. */
  signal?: number;
  fil: LangBlock;
  en: LangBlock;
  footerNote?: { fil: string; en: string };
};

const esc = (s: string) => s; // content is authored by us; placeholders must survive untouched

function meter(signal: number) {
  const cells = brand.signals
    .map(
      (c, i) =>
        `<td width="20%" style="padding:0 2px;"><div style="height:6px;border-radius:2px;background:${
          i < signal ? c : 'rgba(238,242,243,0.22)'
        };line-height:6px;font-size:0;">&nbsp;</div></td>`,
    )
    .join('');
  return `<table role="presentation" width="160" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr>${cells}</tr></table>`;
}

function block(b: LangBlock, lang: 'fil' | 'en') {
  return `
  <tr><td style="padding:0 40px;" lang="${lang}">
    <p style="margin:0 0 6px;font-family:${font};font-size:12px;letter-spacing:.04em;color:#5a6b7b;">${
      lang === 'fil' ? 'Filipino' : 'English'
    }</p>
    <h1 style="margin:0 0 12px;font-family:${display};font-size:28px;line-height:1.15;font-weight:700;color:${brand.slate};">${esc(
      b.heading,
    )}</h1>
    <p style="margin:0 0 18px;font-family:${font};font-size:16px;line-height:1.6;color:#2b3a4a;">${esc(b.intro)}</p>
    ${b.action ?? ''}
    ${b.after ? `<p style="margin:18px 0 0;font-family:${font};font-size:14px;line-height:1.6;color:#4a5a6a;">${b.after}</p>` : ''}
  </td></tr>`;
}

/** Large, copy-friendly one-time code box. */
export function codeBox(code: string) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;">
      <tr><td style="background:${brand.mist};border:2px solid ${brand.slate};border-radius:10px;padding:14px 26px;">
        <span style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${brand.slate};">${code}</span>
      </td></tr>
    </table>`;
}

/** Bulletproof button (works in Outlook). */
export function button(label: string, href: string, color = brand.lake) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;">
      <tr><td style="border-radius:6px;background:${color};">
        <a href="${href}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${font};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>
      </td></tr>
    </table>`;
}

export function renderEmail(spec: EmailSpec): string {
  const accent = spec.accent ?? brand.lake;
  const footer = spec.footerNote ?? {
    fil: 'Kung hindi ikaw ang humiling nito, huwag pansinin ang email na ito. Hindi kailanman hihingin ng Baha Ready ang iyong code o password.',
    en: 'If you did not request this, you can ignore this email. Baha Ready will never ask for your code or password.',
  };
  return `<!doctype html>
<html lang="fil" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>Baha Ready 3D</title>
</head>
<body style="margin:0;padding:0;background:${brand.mist};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${spec.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.mist};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d5dde1;">
    <tr><td style="background:${brand.slate};padding:22px 40px;border-bottom:4px solid ${accent};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${display};font-size:24px;font-weight:700;color:${brand.mist};letter-spacing:.02em;">
          <span style="display:inline-block;width:14px;height:14px;background:${brand.red};border-radius:2px;margin-right:6px;vertical-align:middle;"></span>Baha Ready 3D
          ${meter(spec.signal ?? 5)}
        </td>
        <td align="right" style="font-family:${font};font-size:12px;color:#a9b7c2;">Pila, Laguna</td>
      </tr></table>
    </td></tr>
    <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
    ${block(spec.fil, 'fil')}
    <tr><td style="padding:26px 40px;"><div style="height:1px;background:#e1e7ea;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
    ${block(spec.en, 'en')}
    <tr><td style="height:30px;line-height:30px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="background:#f6f8f9;padding:20px 40px;border-top:1px solid #e1e7ea;">
      <p style="margin:0 0 8px;font-family:${font};font-size:13px;line-height:1.55;color:#4a5a6a;">${footer.fil}</p>
      <p style="margin:0 0 12px;font-family:${font};font-size:13px;line-height:1.55;color:#4a5a6a;">${footer.en}</p>
      <p style="margin:0;font-family:${font};font-size:12px;line-height:1.5;color:#6b7b8a;">Baha Ready 3D · Paghahanda sa baha para sa Pila, Laguna · Sumusunod sa Data Privacy Act of 2012 (RA 10173).</p>
    </td></tr>
  </table>
  <p style="margin:14px 0 0;font-family:${font};font-size:12px;color:#6b7b8a;">Sa emergency, tumawag sa 911. · In an emergency, call 911.</p>
</td></tr>
</table>
</body>
</html>`;
}
