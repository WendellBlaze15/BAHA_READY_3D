import { cn } from '@/lib/utils';

/** Shared layout for 404 / error / offline / maintenance screens. */
export function StatusPage({
  code,
  title,
  body,
  tone = 'neutral',
  children,
}: {
  code: string;
  title: string;
  body: string;
  tone?: 'neutral' | 'danger';
  children?: React.ReactNode;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-4 py-12"
    >
      <span
        aria-hidden
        className={cn(
          'font-display inline-flex size-16 items-center justify-center rounded-lg text-3xl font-bold',
          tone === 'danger' ? 'bg-signal-red text-white' : 'bg-storm-slate text-mist',
        )}
      >
        {code}
      </span>
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-muted-foreground prose-width text-lg">{body}</p>
      {children && <div className="flex flex-wrap gap-3">{children}</div>}
    </main>
  );
}
