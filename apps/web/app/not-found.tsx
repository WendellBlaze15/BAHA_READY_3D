import './globals.css';
import Link from 'next/link';

export default function GlobalNotFound() {
  return (
    <html lang="fil">
      <body className="flex min-h-dvh items-center justify-center p-6">
        <main className="max-w-md space-y-3">
          <h1 className="text-3xl font-bold">404 · Walang ganitong pahina</h1>
          <p>This page doesn&apos;t exist.</p>
          <Link className="text-link underline" href="/">
            Bumalik sa Home / Back to Home
          </Link>
        </main>
      </body>
    </html>
  );
}
