// Builds a signed release AAB. Requires the Android SDK (ANDROID_HOME) + JDK 21.
import { execSync } from 'node:child_process';
const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
  console.error('✘ ANDROID_HOME not set — install Android Studio (SDK) first.');
  process.exit(1);
}
run('npx cap sync android');
run(
  process.platform === 'win32' ? 'gradlew.bat bundleRelease' : './gradlew bundleRelease',
  'android',
);
console.log('✔ AAB: android/app/build/outputs/bundle/release/app-release.aab');
