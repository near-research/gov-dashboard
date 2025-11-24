/**
 * Docs Tool - Search & Fetch
 */

// ============================================================================
// Configuration
// ============================================================================

const DOCS_BASE = "https://houseofstake.org/docs";

export const DOC_PATHS = {
  // Overview Section
  overview: {
    path: "overview",
    title: "Overview",
    description: "Introduction to House of Stake",
  },
  "what-is-hos": {
    path: "overview/what-is-house-of-stake",
    title: "What is House of Stake",
    description: "Core concepts and components of HoS governance",
  },
  "governance-philosophy": {
    path: "overview/governance-philosophy",
    title: "Governance Philosophy",
    description: "Principles of transparency, efficiency, and accountability",
  },

  // Structure & Roles Section
  structure: {
    path: "structure",
    title: "Structure & Roles",
    description: "Organizational structure, working groups, and key roles",
  },
  "working-groups-overview": {
    path: "structure/working-groups-overview",
    title: "Working Groups Overview",
    description: "Specialized groups focused on governance areas",
  },
  delegates: {
    path: "structure/delegates-and-participants",
    title: "Delegates & Participants",
    description: "Delegate roles, responsibilities, and requirements",
  },
  "screening-committee": {
    path: "structure/screening-committee",
    title: "Screening Committee",
    description: "Proposal review and quality control body",
  },
  "security-council": {
    path: "structure/security-council",
    title: "Security Council",
    description: "Emergency response and protocol security body",
  },
  raci: {
    path: "structure/raci",
    title: "Responsibilities (RACI)",
    description: "Role responsibility matrix for governance participants",
  },
  "code-of-conduct": {
    path: "structure/code-of-conduct",
    title: "Code of Conduct",
    description: "Community guidelines and expected behavior",
  },

  // Governance System Section
  "governance-system": {
    path: "governance-system",
    title: "Governance System",
    description: "veNEAR token system and voting mechanisms",
  },
  venear: {
    path: "governance-system/what-is-venear",
    title: "What is veNEAR",
    description: "Vote-escrowed NEAR token mechanics and voting power",
  },

  // Working Groups Section
  "working-groups": {
    path: "working-groups",
    title: "Working Groups",
    description: "All working groups: governance, ecosystem, treasury, network",
  },

  // Strategic Direction Section
  "strategic-direction": {
    path: "strategic-direction",
    title: "Strategic Direction",
    description: "Roadmap, milestones, and long-term goals",
  },
  "ai-scaling": {
    path: "strategic-direction/the-future-ai-and-scaling",
    title: "The Future: AI & Scaling",
    description: "Vision for AI-augmented governance",
  },

  // Get Involved Section
  "get-involved": {
    path: "get-involved",
    title: "Get Involved",
    description: "How to participate, submit proposals, and contribute",
  },
} as const;

export type DocKey = keyof typeof DOC_PATHS;

// ============================================================================
// Caching
// ============================================================================

interface CachedDoc {
  content: string;
  title: string;
  url: string;
  fetchedAt: number;
}

// In-memory cache with TTL
const docsCache = new Map<string, CachedDoc>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCachedDoc(key: string): CachedDoc | null {
  const cached = docsCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    docsCache.delete(key);
    return null;
  }
  return cached;
}

function setCachedDoc(key: string, doc: CachedDoc): void {
  docsCache.set(key, doc);
}

// ============================================================================
// Content Fetching
// ============================================================================

/**
 * Strip HTML and clean up content for LLM consumption
 */
function cleanHtmlContent(html: string): string {
  return (
    html
      // Remove script and style tags with content
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // Convert common elements
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<h[1-6][^>]*>/gi, "## ")
      // Convert links to markdown-ish format
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")
      // Remove remaining tags
      .replace(/<[^>]+>/g, "")
      // Decode HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Clean up whitespace
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

/**
 * Fetch a documentation page from houseofstake.org
 */
async function fetchDocContent(docPath: string): Promise<string | null> {
  const url = `${DOCS_BASE}/${docPath}/`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "NEAR-Governance-Agent/1.0",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      console.warn(`[HoS Docs] Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    return cleanHtmlContent(html);
  } catch (error) {
    console.error(`[HoS Docs] Error fetching ${url}:`, error);
    return null;
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

const docKeysList = Object.entries(DOC_PATHS)
  .map(([key, info]) => `- ${key}: ${info.description}`)
  .join("\n");

export const DOCS_TOOL = {
  type: "function",
  function: {
    name: "get_doc",
    description: `Fetch official House of Stake documentation content to answer governance questions.

Use this tool when users ask about:
- House of Stake (HoS) governance structure
- veNEAR token mechanics and voting power
- Delegates, screening committee, or security council
- Working groups and their responsibilities
- How to participate or submit proposals
- Governance philosophy and principles

Available documentation:
${docKeysList}

The tool returns the full page content so you can answer questions accurately.`,
    parameters: {
      type: "object",
      properties: {
        doc_key: {
          type: "string",
          enum: Object.keys(DOC_PATHS),
          description: "The documentation page to fetch",
        },
      },
      required: ["doc_key"],
    },
  },
} as const;

// ============================================================================
// Tool Handler
// ============================================================================

export interface DocResult {
  success: boolean;
  url: string;
  title: string;
  content?: string;
  error?: string;
  cached?: boolean;
}

export async function handleGetDoc(args: {
  doc_key?: string;
}): Promise<{ result: DocResult }> {
  const key = args.doc_key as DocKey | undefined;

  // Validate doc key
  if (!key || !(key in DOC_PATHS)) {
    const availableKeys = Object.keys(DOC_PATHS).join(", ");
    return {
      result: {
        success: false,
        url: DOCS_BASE,
        title: "House of Stake Documentation",
        error: `Unknown doc_key "${args.doc_key}". Available keys: ${availableKeys}`,
      },
    };
  }

  const docInfo = DOC_PATHS[key];
  const url = `${DOCS_BASE}/${docInfo.path}/`;

  // Check cache first
  const cached = getCachedDoc(key);
  if (cached) {
    console.log(`[HoS Docs] Cache hit for ${key}`);
    return {
      result: {
        success: true,
        url: cached.url,
        title: cached.title,
        content: cached.content,
        cached: true,
      },
    };
  }

  // Fetch fresh content
  console.log(`[HoS Docs] Fetching ${key} from ${url}`);
  const content = await fetchDocContent(docInfo.path);

  if (!content) {
    return {
      result: {
        success: false,
        url,
        title: docInfo.title,
        error: `Failed to fetch documentation. Please refer to ${url}`,
      },
    };
  }

  // Truncate if too long (keep under ~8k tokens worth)
  const maxLength = 12000;
  const truncatedContent =
    content.length > maxLength
      ? content.slice(0, maxLength) +
        "\n\n[Content truncated. See full doc at URL]"
      : content;

  // Cache the result
  const docResult: CachedDoc = {
    content: truncatedContent,
    title: docInfo.title,
    url,
    fetchedAt: Date.now(),
  };
  setCachedDoc(key, docResult);

  return {
    result: {
      success: true,
      url,
      title: docInfo.title,
      content: truncatedContent,
      cached: false,
    },
  };
}

// ============================================================================
// Multi-doc Search Handler
// ============================================================================

export const SEARCH_DOCS_TOOL = {
  type: "function",
  function: {
    name: "search_docs",
    description: `Search House of Stake documentation by topic. Returns content from multiple relevant pages.

Use for broader questions that might span multiple docs, like:
- "How does governance work?" (fetches overview + venear + structure)
- "What are the different roles?" (fetches delegates + committees)
- "How do I participate?" (fetches get-involved + venear)`,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "The topic to search for (e.g., 'voting', 'delegates', 'proposals', 'working groups')",
        },
      },
      required: ["topic"],
    },
  },
} as const;

// Topic to doc keys mapping for search
const TOPIC_DOC_MAPPING: Record<string, DocKey[]> = {
  overview: ["what-is-hos", "governance-philosophy"],
  "house of stake": ["what-is-hos", "governance-philosophy", "structure"],
  governance: ["what-is-hos", "governance-philosophy", "governance-system"],
  voting: ["venear", "governance-system", "delegates"],
  venear: ["venear", "governance-system"],
  token: ["venear"],
  lock: ["venear"],
  delegates: ["delegates", "structure"],
  delegation: ["delegates", "venear"],
  screening: ["screening-committee", "structure"],
  proposal: ["screening-committee", "get-involved"],
  security: ["security-council", "structure"],
  council: ["security-council", "screening-committee"],
  "working group": ["working-groups", "structure"],
  participate: ["get-involved", "venear", "delegates"],
  contribute: ["get-involved"],
  submit: ["get-involved", "screening-committee"],
  future: ["ai-scaling", "strategic-direction"],
  ai: ["ai-scaling"],
  roadmap: ["strategic-direction", "ai-scaling"],
  roles: ["structure", "delegates", "raci"],
  responsibilities: ["raci", "delegates", "screening-committee"],
  conduct: ["code-of-conduct"],
};

function findRelevantDocs(topic: string): DocKey[] {
  const normalizedTopic = topic.toLowerCase().trim();

  // Direct match
  if (normalizedTopic in TOPIC_DOC_MAPPING) {
    return TOPIC_DOC_MAPPING[normalizedTopic];
  }

  // Partial match
  const matches: DocKey[] = [];
  for (const [key, docs] of Object.entries(TOPIC_DOC_MAPPING)) {
    if (normalizedTopic.includes(key) || key.includes(normalizedTopic)) {
      matches.push(...docs);
    }
  }

  // Dedupe and limit
  const unique = [...new Set(matches)];
  return unique.length > 0 ? unique.slice(0, 3) : ["what-is-hos", "structure"];
}

export async function handleSearchDocs(args: {
  topic?: string;
}): Promise<{ result: { topic: string; docs: DocResult[] } }> {
  const topic = args.topic || "overview";
  const relevantKeys = findRelevantDocs(topic);

  console.log(`[HoS Docs] Searching for "${topic}", found keys:`, relevantKeys);

  const results = await Promise.all(
    relevantKeys.map(async (key) => {
      const { result } = await handleGetDoc({ doc_key: key });
      return result;
    })
  );

  return {
    result: {
      topic,
      docs: results,
    },
  };
}

// ============================================================================
// System Prompt Addition
// ============================================================================

export function buildDocsSystemPrompt(): string {
  return `**House of Stake Documentation Tools:**

You have access to official House of Stake (HoS) governance documentation.

**When to use these tools:**
- Questions about HoS governance structure, roles, or processes → use get_doc or search_docs
- Questions about veNEAR token mechanics → get_doc with "venear"
- Questions about delegates or delegation → get_doc with "delegates"
- Questions about proposal screening → get_doc with "screening-committee"
- Questions about how to participate → get_doc with "get-involved"
- Broad governance questions → search_docs with the topic

**Response guidelines:**
- Answer based on the fetched documentation content
- Always cite the source URL when providing information
- If the docs don't cover a topic, say so and suggest checking the forum
- Keep answers focused and relevant to what was asked

**Citation format:**
"According to the [House of Stake documentation](url)..."
or
"The HoS docs explain that... [Source](url)"`;
}

// ============================================================================
// Exports for agent integration
// ============================================================================

export const DOCS_TOOLS = [DOCS_TOOL, SEARCH_DOCS_TOOL] as const;
