// Generates PWA / app icons from the blocky brand mark (original art).
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('package.json'));
const sharp = require('sharp');

const mark = (pad, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${bg ? 0 : 7}" fill="#1E2A38"/>
  <g transform="translate(${pad} ${pad}) scale(${(32 - pad * 2) / 32})">
    <rect x="6" y="6" width="20" height="6" rx="1" fill="#D2402F"/>
    <rect x="8" y="12" width="16" height="10" rx="1" fill="#EEF2F3"/>
    <rect x="14" y="15" width="4" height="7" fill="#8A6B4A"/>
    <rect x="2" y="21" width="28" height="9" rx="2" fill="#2F6F7E"/>
    <rect x="5" y="24" width="7" height="1.6" rx="0.8" fill="#EEF2F3" opacity="0.7"/>
    <rect x="17" y="26" width="9" height="1.6" rx="0.8" fill="#EEF2F3" opacity="0.7"/>
  </g></svg>`;
const out = 'apps/web/public/icons';
const jobs = [
  ['icon-192.png', 192, mark(3, false)],
  ['icon-512.png', 512, mark(3, false)],
  ['maskable-512.png', 512, mark(6, true)],
  ['apple-touch-icon.png', 180, mark(3, true)],
  ['badge-96.png', 96, mark(2, false)],
];
for (const [name, size, svg] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`${out}/${name}`);
  console.log('✔', name);
}

// Android launcher icons (Capacitor project). Adaptive foreground = 108dp canvas, 66dp safe zone.
const res = 'apps/mobile/android/app/src/main/res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const fs = await import('node:fs');
if (fs.existsSync(res)) {
  for (const [d, k] of Object.entries(densities)) {
    const dir = `${res}/mipmap-${d}`;
    await sharp(Buffer.from(mark(3, true)))
      .resize(48 * k, 48 * k)
      .png()
      .toFile(`${dir}/ic_launcher.png`);
    const round = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${48 * k}" height="${48 * k}"><circle cx="50%" cy="50%" r="50%" fill="#fff"/></svg>`,
    );
    await sharp(Buffer.from(mark(5, true)))
      .resize(48 * k, 48 * k)
      .composite([{ input: round, blend: 'dest-in' }])
      .png()
      .toFile(`${dir}/ic_launcher_round.png`);
    await sharp(Buffer.from(mark(9, true)))
      .resize(108 * k, 108 * k)
      .png()
      .toFile(`${dir}/ic_launcher_foreground.png`);
  }
  const bg = `${res}/values/ic_launcher_background.xml`;
  if (fs.existsSync(bg))
    fs.writeFileSync(bg, fs.readFileSync(bg, 'utf8').replace(/#[0-9A-Fa-f]{6}/, '#1E2A38'));
  console.log('✔ android mipmaps');
}
