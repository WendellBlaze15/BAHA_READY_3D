// Supabase Auth email templates (Go template syntax: {{ .Token }}, {{ .ConfirmationURL }}).
import { brand, button, codeBox, renderEmail } from './layout.ts';

const expiry = {
  fil: 'Mag-e-expire ang code na ito sa loob ng <strong>5 minuto</strong>. Huwag itong ibigay kaninuman.',
  en: 'This code expires in <strong>5 minutes</strong>. Do not share it with anyone.',
};

export const authTemplates = {
  magic_link: {
    subject: 'Code para mag-sign in · Your Baha Ready sign-in code',
    html: renderEmail({
      preheader: 'Ilagay ang 6-digit code para makapasok. · Enter the 6-digit code to sign in.',
      signal: 2,
      fil: {
        heading: 'Ang iyong sign-in code',
        intro: 'Ilagay ang code na ito sa Baha Ready para makapasok sa iyong account.',
        action: codeBox('{{ .Token }}'),
        after: expiry.fil,
      },
      en: {
        heading: 'Your sign-in code',
        intro: 'Enter this code in Baha Ready to sign in to your account.',
        action: codeBox('{{ .Token }}'),
        after: expiry.en,
      },
    }),
  },
  confirmation: {
    subject: 'Kumpirmahin ang iyong email · Confirm your email',
    html: renderEmail({
      preheader: 'Isang hakbang na lang para magsimula. · One step left to get started.',
      signal: 1,
      accent: brand.green,
      fil: {
        heading: 'Maligayang pagdating sa Baha Ready!',
        intro: 'Ilagay ang code na ito para kumpirmahin ang iyong email at simulan ang paghahanda.',
        action: codeBox('{{ .Token }}'),
        after: expiry.fil,
      },
      en: {
        heading: 'Welcome to Baha Ready!',
        intro: 'Enter this code to confirm your email and start preparing.',
        action: codeBox('{{ .Token }}'),
        after: expiry.en,
      },
    }),
  },
  recovery: {
    subject: 'I-reset ang iyong password · Reset your password',
    html: renderEmail({
      preheader: 'Code para palitan ang password. · Code to reset your password.',
      signal: 3,
      accent: brand.amber,
      fil: {
        heading: 'I-reset ang iyong password',
        intro:
          'May humiling na palitan ang password ng account na ito. Ilagay ang code para magpatuloy.',
        action: codeBox('{{ .Token }}'),
        after: expiry.fil,
      },
      en: {
        heading: 'Reset your password',
        intro: 'Someone asked to reset the password for this account. Enter the code to continue.',
        action: codeBox('{{ .Token }}'),
        after: expiry.en,
      },
    }),
  },
  email_change: {
    subject: 'Kumpirmahin ang bagong email · Confirm your new email',
    html: renderEmail({
      preheader: 'Kumpirmahin ang pagpapalit ng email. · Confirm your email change.',
      signal: 3,
      accent: brand.amber,
      fil: {
        heading: 'Kumpirmahin ang bagong email',
        intro:
          'Ilagay ang code na ito para gamitin ang <strong>{{ .NewEmail }}</strong> sa iyong Baha Ready account.',
        action: codeBox('{{ .Token }}'),
        after: expiry.fil,
      },
      en: {
        heading: 'Confirm your new email',
        intro:
          'Enter this code to use <strong>{{ .NewEmail }}</strong> for your Baha Ready account.',
        action: codeBox('{{ .Token }}'),
        after: expiry.en,
      },
    }),
  },
  reauthentication: {
    subject: 'Kumpirmahin na ikaw ito · Confirm it is you',
    html: renderEmail({
      preheader: 'Kailangan ng dagdag na kumpirmasyon. · Extra confirmation needed.',
      signal: 4,
      accent: brand.red,
      fil: {
        heading: 'Kumpirmahin na ikaw ito',
        intro: 'May sensitibong aksyon sa iyong account na nangangailangan ng kumpirmasyon.',
        action: codeBox('{{ .Token }}'),
        after: expiry.fil,
      },
      en: {
        heading: 'Confirm it is you',
        intro: 'A sensitive action on your account needs confirmation.',
        action: codeBox('{{ .Token }}'),
        after: expiry.en,
      },
    }),
  },
  invite: {
    subject: 'Inimbitahan ka sa Baha Ready · You are invited to Baha Ready',
    html: renderEmail({
      preheader: 'Tanggapin ang imbitasyon. · Accept your invitation.',
      signal: 1,
      accent: brand.green,
      fil: {
        heading: 'Inimbitahan ka!',
        intro:
          'Inimbitahan kang sumali sa Baha Ready 3D, isang laro para matutong maghanda sa baha.',
        action: button('Tanggapin ang imbitasyon', '{{ .ConfirmationURL }}'),
      },
      en: {
        heading: 'You are invited!',
        intro:
          'You have been invited to join Baha Ready 3D, a game for learning flood preparedness.',
        action: button('Accept invitation', '{{ .ConfirmationURL }}'),
      },
    }),
  },
} as const;
