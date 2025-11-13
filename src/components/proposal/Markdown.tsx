import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { cn } from "@/utils/tailwind";

interface MarkdownProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

// Initialize once
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
      className={cn("prose prose-sm max-w-none", className)}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
