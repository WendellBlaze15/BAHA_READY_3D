import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Baha Ready 3D',
    short_name: 'Baha Ready',
    description:
      'Isang 3D na laro para matutong maghanda sa baha at bagyo. A 3D flood-preparedness game.',
    id: '/',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#16202B',
    theme_color: '#1E2A38',
    lang: 'fil',
    categories: ['education', 'games'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Maglaro · Play',
        url: '/levels',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Daily challenge',
        url: '/daily',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Hotlines',
        url: '/hotlines',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
