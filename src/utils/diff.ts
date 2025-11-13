import { diffWords } from "diff";

interface DiffOptions {
  addedColor?: string;
  addedBg?: string;
  removedColor?: string;
  removedBg?: string;
}

export function diffPartialText(
  oldText: string,
  newText: string,
  options?: DiffOptions
): string {
  const {
    addedColor = "#166534",
    addedBg = "#dcfce7",
    removedColor = "#991b1b",
    removedBg = "#fee2e2",
  } = options || {};

  const oldTextToCompare =
    oldText.length > newText.length
      ? oldText.slice(0, newText.length)
      : oldText;

  const changes = diffWords(oldTextToCompare, newText);
  let result = "";

  for (const part of changes) {
    if ((part as any).added) {
      result += `<em style="font-style: italic; color: ${addedColor}; background-color: ${addedBg};">${escapeHtml(
        part.value
      )}</em>`;
    } else if ((part as any).removed) {
      result += `<s style="text-decoration: line-through; color: ${removedColor}; background-color: ${removedBg};">${escapeHtml(
        part.value
      )}</s>`;
    } else {
      result += escapeHtml(part.value);
    }
  }

  if (oldText.length > newText.length) {
    result += escapeHtml(oldText.slice(newText.length));
  }

  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
