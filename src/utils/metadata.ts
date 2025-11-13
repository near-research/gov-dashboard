export interface ProposalFrontmatter {
  hsp?: string;
  title?: string;
  description?: string;
  author?: string;
  status?: string;
  type?: string;
  category?: string;
  created?: string;
  requires?: string;
}

const sanitizeValue = (raw: string) =>
  raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeSource = (raw: string) =>
  raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/\r\n/g, "\n");

interface FrontmatterMatch {
  block: string;
  raw: string;
}

const YAML_REGEX = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const HEADER_REGEX =
  /^\s*Frontmatter\s*\r?\n((?:[A-Za-z]+\s*:[^\n]*\r?\n)+)\s*(?:\r?\n|$)/i;
const PLAIN_REGEX = /^\s*((?:[A-Za-z]+\s*:[^\n]*\r?\n)+)\s*(?:\r?\n|$)/;

function findFrontmatter(content: string): FrontmatterMatch | null {
  let match = content.match(YAML_REGEX);
  if (match) {
    return { block: match[1], raw: match[0] };
  }

  match = content.match(HEADER_REGEX);
  if (match) {
    return { block: match[1], raw: match[0] };
  }

  match = content.match(PLAIN_REGEX);
  if (match) {
    return { block: match[1], raw: match[0] };
  }

  return null;
}

function parseMetadataBlock(block: string): ProposalFrontmatter {
  const metadata: ProposalFrontmatter = {};
  const lines = block.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
    if (!match) continue;

    const key = match[1].toLowerCase() as keyof ProposalFrontmatter;
    const value = sanitizeValue(match[2]);
    if (!value) continue;

    switch (key) {
      case "hsp":
      case "title":
      case "description":
      case "author":
      case "status":
      case "type":
      case "category":
      case "created":
      case "requires":
        metadata[key] = value;
        break;
      default:
        break;
    }
  }

  return metadata;
}

export function extractMetadata(content: string): ProposalFrontmatter {
  if (!content) return {};

  // Match Discourse-style "## Frontmatter" section in markdown
  const discourseMatch = content.match(
    /##\s+Frontmatter\s*\r?\n((?:[A-Za-z]+\s*:[^\n]*\r?\n)+)/i
  );

  if (discourseMatch) {
    return parseMetadataBlock(discourseMatch[1]);
  }

  // Fallback to other formats (YAML, etc.)
  const normalized = normalizeSource(content);
  const frontmatterMatch = findFrontmatter(normalized);
  if (frontmatterMatch?.block) {
    return parseMetadataBlock(frontmatterMatch.block);
  }

  return {};
}

export function stripFrontmatter(content: string): string {
  if (!content) return content;

  // Strip Discourse-style "## Frontmatter" section
  const discourseMatch = content.match(
    /##\s+Frontmatter\s*\r?\n((?:[A-Za-z]+\s*:[^\n]*\r?\n)+)\s*(?:\r?\n|$)/i
  );
  if (discourseMatch) {
    return content.replace(discourseMatch[0], "").trimStart();
  }

  // Strip YAML frontmatter
  const yamlMatch = content.match(YAML_REGEX);
  if (yamlMatch) {
    return content.replace(yamlMatch[0], "").trimStart();
  }

  // Strip other header formats
  const headerMatch = content.match(HEADER_REGEX);
  if (headerMatch) {
    return content.replace(headerMatch[0], "").trimStart();
  }

  const plainMatch = content.match(PLAIN_REGEX);
  if (plainMatch) {
    return content.replace(plainMatch[0], "").trimStart();
  }

  return content;
}
