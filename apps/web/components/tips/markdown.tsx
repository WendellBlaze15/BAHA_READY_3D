import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

/** Admin-authored Markdown, sanitized with an allowlist (never dangerouslySetInnerHTML). */
export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="prose-width [&_a]:text-link space-y-4 text-lg leading-relaxed [&_a]:underline [&_li]:ml-6 [&_ol]:list-decimal [&_ul]:list-disc">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{children}</ReactMarkdown>
    </div>
  );
}
