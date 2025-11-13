import DOMPurify from "dompurify";

/**
 * Sanitize HTML to prevent XSS attacks
 * Use this before rendering any user-generated HTML with dangerouslySetInnerHTML
 * CLIENT-SIDE ONLY
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

/**
 * Strip HTML tags from a string
 * Useful for getting plain text from HTML content
 * Works in both browser and Node.js environments
 */
export function stripHtml(html: string): string {
  // Browser environment - use DOM
  if (typeof document !== "undefined") {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  // Node.js environment - use regex
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
