import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { cn } from "@/utils/tailwind";

interface MarkdownProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

// Initialize once with enhanced formatting
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
});

export function Markdown({ content, className, style }: MarkdownProps) {
  const html = useMemo(() => {
    const rendered = md.render(content);
    return DOMPurify.sanitize(rendered);
  }, [content]);

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none",
        // Enhanced list styling
        "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_ul]:my-2",
        "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1 [&_ol]:my-2",
        "[&_ul_li]:pl-1 [&_ol_li]:pl-1",
        "[&_li]:leading-relaxed",
        // Nested list styling
        "[&_ul_ul]:mt-1 [&_ul_ul]:mb-1",
        "[&_ol_ol]:mt-1 [&_ol_ol]:mb-1",
        "[&_ul_ol]:mt-1 [&_ul_ol]:mb-1",
        "[&_ol_ul]:mt-1 [&_ol_ul]:mb-1",
        // Better paragraph spacing
        "[&_p]:my-2 [&_p]:leading-relaxed",
        // Headings
        "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2",
        "[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2",
        "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1",
        // Code blocks
        "[&_code]:text-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded",
        "[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto",
        className
      )}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
