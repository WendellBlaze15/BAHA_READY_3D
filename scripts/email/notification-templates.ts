// Brevo transactional templates (one bilingual template per event, Section 12A).
// Brevo variables: {{ params.x }}. `params.url` is an absolute link built by send-email.
import { brand, button, renderEmail } from './layout.ts';

type Spec = {
  subject: string;
  accent?: string;
  signal?: number;
  fil: { heading: string; intro: string; cta?: string; after?: string };
  en: { heading: string; intro: string; cta?: string; after?: string };
  critical?: boolean;
};

const P = (k: string) => `{{ params.${k} }}`;

const SPECS: Record<string, Spec> = {
  welcome: {
    subject: 'Maligayang pagdating sa Baha Ready! · Welcome to Baha Ready!',
    accent: brand.green,
    signal: 1,
    fil: {
      heading: `Kumusta, ${P('username')}!`,
      intro:
        'Handa na ang account mo. Simulan sa Tutorial, pagkatapos ay subukan ang Signal No. 1 hanggang No. 5 para matutong maghanda sa baha.',
      cta: 'Maglaro ngayon',
    },
    en: {
      heading: `Hi, ${P('username')}!`,
      intro:
        'Your account is ready. Start with the Tutorial, then work through Signal No. 1 to No. 5 to learn flood preparedness.',
      cta: 'Play now',
    },
  },
  new_device_signin: {
    subject: 'Abiso sa seguridad ng account · Account security notice',
    accent: brand.red,
    signal: 4,
    critical: true,
    fil: {
      heading: 'May pagbabago sa seguridad ng account mo',
      intro:
        'May bagong sign-in o pagbabago sa seguridad ng account mo. Kung hindi ikaw ito, palitan agad ang password at i-sign out ang ibang device.',
      cta: 'Suriin ang account',
    },
    en: {
      heading: 'A security change on your account',
      intro:
        'There was a new sign-in or security change on your account. If this wasn’t you, change your password and sign out other devices right away.',
      cta: 'Review account',
    },
  },
  otp_lockout: {
    subject: 'Pansamantalang na-lock ang sign-in · Sign-in temporarily locked',
    accent: brand.red,
    signal: 4,
    critical: true,
    fil: {
      heading: 'Masyadong maraming maling code',
      intro: `Para sa seguridad, naka-lock ang sign-in sa email na ito nang ${P('minutes')} minuto. Kung hindi ikaw ang sumubok, walang kailangang gawin — ligtas ang account mo.`,
    },
    en: {
      heading: 'Too many wrong codes',
      intro: `For your security, sign-in for this email is locked for ${P('minutes')} minutes. If this wasn’t you, no action is needed — your account is safe.`,
    },
  },
  application_received: {
    subject: 'Natanggap ang aplikasyon mo · Application received',
    signal: 2,
    fil: {
      heading: 'Natanggap namin ang aplikasyon mo',
      intro: `Salamat sa pag-apply bilang facilitator para sa ${P('organization')}. Aabisuhan ka namin kapag nasuri na ito ng admin.`,
    },
    en: {
      heading: 'We received your application',
      intro: `Thanks for applying as a facilitator for ${P('organization')}. We’ll let you know once an admin reviews it.`,
    },
  },
  application_received_admin: {
    subject: 'Bagong facilitator application · New facilitator application',
    accent: brand.amber,
    signal: 3,
    fil: {
      heading: 'May bagong aplikasyon',
      intro: `${P('full_name')} (${P('organization')}) ay nag-apply bilang facilitator.`,
      cta: 'Suriin ang aplikasyon',
    },
    en: {
      heading: 'New application',
      intro: `${P('full_name')} (${P('organization')}) applied to be a facilitator.`,
      cta: 'Review application',
    },
  },
  application_approved: {
    subject: 'Aprubado ka bilang Facilitator! · You’re approved!',
    accent: brand.green,
    signal: 5,
    critical: true,
    fil: {
      heading: 'Facilitator ka na!',
      intro:
        'Naaprubahan ang aplikasyon mo. I-set up ang authenticator app para mabuksan ang facilitator tools: groups, assignments, live drills, at reports.',
      cta: 'Buksan ang facilitator tools',
    },
    en: {
      heading: 'You’re a facilitator now!',
      intro:
        'Your application was approved. Set up an authenticator app to open the facilitator tools: groups, assignments, live drills, and reports.',
      cta: 'Open facilitator tools',
    },
  },
  application_rejected: {
    subject: 'Tungkol sa aplikasyon mo · About your application',
    accent: brand.amber,
    signal: 2,
    critical: true,
    fil: {
      heading: 'Hindi naaprubahan ang aplikasyon',
      intro: `Dahilan: ${P('note')}. Puwede kang mag-apply ulit kapag handa ka na.`,
      cta: 'Mag-apply ulit',
    },
    en: {
      heading: 'Your application wasn’t approved',
      intro: `Reason: ${P('note')}. You can apply again when you’re ready.`,
      cta: 'Apply again',
    },
  },
  assignment_new: {
    subject: `Bagong assignment: ${P('title')} · New assignment`,
    signal: 3,
    fil: {
      heading: `Bagong assignment sa ${P('group')}`,
      intro: `${P('title')} — deadline: ${P('due_at')}.`,
      cta: 'Tingnan ang assignment',
    },
    en: {
      heading: `New assignment in ${P('group')}`,
      intro: `${P('title')} — due: ${P('due_at')}.`,
      cta: 'View assignment',
    },
  },
  assignment_due_soon: {
    subject: `Malapit na ang deadline: ${P('title')} · Due soon`,
    accent: brand.amber,
    signal: 4,
    fil: {
      heading: 'Malapit na ang deadline',
      intro: `Wala nang 24 oras bago ang deadline ng ${P('title')}.`,
      cta: 'Tapusin ngayon',
    },
    en: {
      heading: 'Due soon',
      intro: `Less than 24 hours left for ${P('title')}.`,
      cta: 'Finish it now',
    },
  },
  assignment_overdue: {
    subject: `Lampas na sa deadline: ${P('title')} · Overdue`,
    accent: brand.red,
    signal: 5,
    fil: {
      heading: 'Lampas na sa deadline',
      intro: `Hindi pa tapos ang ${P('title')}. Puwede mo pa rin itong laruin para matuto.`,
      cta: 'Laruin',
    },
    en: {
      heading: 'Past the deadline',
      intro: `${P('title')} isn’t finished yet. You can still play it to learn.`,
      cta: 'Play',
    },
  },
  group_announcement: {
    subject: `📣 ${P('title')}`,
    signal: 2,
    fil: { heading: P('title'), intro: P('body'), cta: 'Buksan ang group' },
    en: { heading: P('title'), intro: P('body'), cta: 'Open group' },
  },
  join_request_pending: {
    subject: `Bagong join request sa ${P('group')} · New join request`,
    signal: 2,
    fil: {
      heading: 'May gustong sumali',
      intro: `Si ${P('username')} ay humihiling na sumali sa ${P('group')}.`,
      cta: 'Suriin ang request',
    },
    en: {
      heading: 'Someone wants to join',
      intro: `${P('username')} asked to join ${P('group')}.`,
      cta: 'Review request',
    },
  },
  join_request_approved: {
    subject: `Tinanggap ka sa ${P('group')} · You’re in!`,
    accent: brand.green,
    signal: 2,
    fil: {
      heading: 'Tinanggap ka!',
      intro: `Miyembro ka na ng ${P('group')}. Tingnan ang mga assignment at leaderboard ng group.`,
      cta: 'Buksan ang group',
    },
    en: {
      heading: 'You’re in!',
      intro: `You’re now a member of ${P('group')}. Check the group’s assignments and leaderboard.`,
      cta: 'Open group',
    },
  },
  report_ready: {
    subject: 'Handa na ang report · Your report is ready',
    accent: brand.green,
    signal: 2,
    fil: {
      heading: 'Handa na ang report mo',
      intro: `Handa nang i-download ang report para sa ${P('group')}.`,
      cta: 'I-download',
    },
    en: {
      heading: 'Your report is ready',
      intro: `The report for ${P('group')} is ready to download.`,
      cta: 'Download',
    },
  },
  account_suspended: {
    subject: 'Naka-suspend ang account mo · Account suspended',
    accent: brand.red,
    signal: 5,
    critical: true,
    fil: {
      heading: 'Naka-suspend ang account mo',
      intro: `Dahilan: ${P('reason')}. Tagal: ${P('days')} araw. Kung sa tingin mo ay mali ito, makipag-ugnayan sa facilitator o admin.`,
    },
    en: {
      heading: 'Your account is suspended',
      intro: `Reason: ${P('reason')}. Duration: ${P('days')} days. If you think this is a mistake, contact your facilitator or an admin.`,
    },
  },
  account_restored: {
    subject: 'Naibalik ang account mo · Account restored',
    accent: brand.green,
    signal: 1,
    critical: true,
    fil: {
      heading: 'Maligayang pagbabalik!',
      intro: 'Naalis na ang suspension sa account mo. Puwede ka nang maglaro ulit.',
      cta: 'Mag-sign in',
    },
    en: {
      heading: 'Welcome back!',
      intro: 'The suspension on your account was lifted. You can play again.',
      cta: 'Sign in',
    },
  },
  account_deletion_requested: {
    subject: 'Buburahin ang account mo · Account deletion requested',
    accent: brand.red,
    signal: 4,
    critical: true,
    fil: {
      heading: 'Natanggap ang request na burahin ang account',
      intro: `Tuluyang buburahin ang data mo pagkalipas ng ${P('days')} araw. Kung hindi ikaw ang humiling nito, makipag-ugnayan agad sa amin.`,
    },
    en: {
      heading: 'Account deletion requested',
      intro: `Your data will be permanently deleted after ${P('days')} days. If you didn’t request this, contact us right away.`,
    },
  },
  account_deletion_completed: {
    subject: 'Nabura na ang account mo · Account deleted',
    signal: 1,
    critical: true,
    fil: {
      heading: 'Nabura na ang account mo',
      intro:
        'Tuluyan nang nabura ang account at data mo. Salamat sa paggamit ng Baha Ready — mag-ingat palagi.',
    },
    en: {
      heading: 'Your account was deleted',
      intro:
        'Your account and data were permanently deleted. Thank you for using Baha Ready — stay safe.',
    },
  },
  admin_promoted: {
    subject: 'Admin ka na sa Baha Ready · You’re now an admin',
    accent: brand.amber,
    signal: 5,
    critical: true,
    fil: {
      heading: 'Na-promote ka bilang Admin',
      intro: 'May access ka na sa admin tools. Siguraduhing naka-on ang authenticator app mo.',
      cta: 'Buksan ang admin',
    },
    en: {
      heading: 'You were promoted to admin',
      intro: 'You now have access to the admin tools. Make sure your authenticator app is set up.',
      cta: 'Open admin',
    },
  },
  admin_demoted: {
    subject: 'Nagbago ang role mo · Your role changed',
    accent: brand.amber,
    signal: 3,
    critical: true,
    fil: {
      heading: 'Hindi ka na admin',
      intro:
        'Inalis ang admin role sa account mo. Kung hindi mo inaasahan ito, makipag-ugnayan sa super admin.',
    },
    en: {
      heading: 'You’re no longer an admin',
      intro:
        'The admin role was removed from your account. If you didn’t expect this, contact a super admin.',
    },
  },
  survival_warning: {
    subject: 'Paalala tungkol sa Survival Mode · A note about Survival Mode',
    accent: brand.amber,
    signal: 2,
    fil: {
      heading: 'Paalala mula sa admin',
      intro: `Nakatanggap kami ng report tungkol sa isang laro mo sa Survival Mode. Tala ng admin: ${P('note')}. Tandaan: maging magalang at huwag magbahagi o humingi ng personal na impormasyon.`,
      cta: 'Buksan ang Survival Mode',
    },
    en: {
      heading: 'A note from an admin',
      intro: `We received a report about one of your Survival Mode games. Admin note: ${P('note')}. Please be respectful and never share or ask for personal information.`,
      cta: 'Open Survival Mode',
    },
  },
  survival_restricted: {
    subject: 'Pansamantalang limitasyon sa Survival Mode · Survival Mode restriction',
    accent: brand.red,
    signal: 3,
    critical: true,
    fil: {
      heading: 'May pansamantalang limitasyon ang account mo',
      intro: `Dahil sa isang report, pansamantalang naka-off ang ${P('scope')} mo sa Survival Mode hanggang ${P('until')}. Dahilan: ${P('reason')}. Kung walang petsa, permanente ito hanggang suriin muli.`,
    },
    en: {
      heading: 'Your account has a temporary restriction',
      intro: `Because of a report, your Survival Mode ${P('scope')} is paused until ${P('until')}. Reason: ${P('reason')}. If no date is shown, it stays until reviewed again.`,
    },
  },
  survival_run_expiring: {
    subject: 'Mag-e-expire ang inyong Survival run · Your Survival run is expiring',
    accent: brand.amber,
    signal: 2,
    fil: {
      heading: 'Naghihintay pa ang inyong team!',
      intro: `Hindi pa natatapos ang inyong Survival Mode run (Day ${P('day')}). Kapag hindi ito naituloy sa loob ng 3 araw, mawawala na ito.`,
      cta: 'Ituloy ang laro',
    },
    en: {
      heading: 'Your team is still waiting!',
      intro: `Your Survival Mode run (Day ${P('day')}) isn’t finished yet. If nobody resumes it within 3 days, it will expire.`,
      cta: 'Resume the game',
    },
  },
};

export function buildNotificationTemplates() {
  return Object.entries(SPECS).map(([key, s]) => ({
    key,
    name: `baha-${key}`,
    subject: s.subject,
    critical: !!s.critical,
    html: renderEmail({
      // Never cut a {{ variable }} in half (Brevo rejects unterminated tags).
      preheader: s.fil.intro
        .replace(/{{[^}]*}}/g, '…')
        .slice(0, 90)
        .replace(/{{[^}]*$/, ''),
      accent: s.accent,
      signal: s.signal,
      fil: {
        heading: s.fil.heading,
        intro: s.fil.intro,
        action: s.fil.cta ? button(s.fil.cta, P('url')) : undefined,
        after: s.fil.after,
      },
      en: {
        heading: s.en.heading,
        intro: s.en.intro,
        action: s.en.cta ? button(s.en.cta, P('url')) : undefined,
        after: s.en.after,
      },
      footerNote: s.critical
        ? {
            fil: 'Mahalagang abiso ito tungkol sa account mo, kaya hindi ito mapapatay sa settings.',
            en: 'This is an important notice about your account, so it can’t be turned off in settings.',
          }
        : {
            fil: `Ayaw mo na ng ganitong email? <a href="${P('settings_url')}" style="color:#2F6F7E">Baguhin ang notification settings</a>.`,
            en: `Don’t want these emails? <a href="${P('settings_url')}" style="color:#2F6F7E">Change your notification settings</a>.`,
          },
    }),
  }));
}
