import type { CapacitorConfig } from '@capacitor/cli';

/**
 * DECISION: the Android app is a thin native shell around the deployed web app (server.url),
 * so gameplay, auth and the authoritative scoring stay identical across web and mobile and
 * updates ship without a store release. `www/` only holds the offline fallback page.
 */
const url = process.env.PRODUCTION_URL ?? 'https://baha-ready-3d.vercel.app';

const config: CapacitorConfig = {
  appId: 'ph.bahaready.app',
  appName: 'Baha Ready 3D',
  webDir: 'www',
  server: {
    url,
    androidScheme: 'https',
    cleartext: false,
    allowNavigation: [new URL(url).host, '*.supabase.co'],
    errorPath: 'index.html',
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#16202B',
      showSpinner: false,
    },
    StatusBar: { backgroundColor: '#1E2A38', style: 'DARK' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
