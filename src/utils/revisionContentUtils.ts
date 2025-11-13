/**
 * Client-side utilities for working with Discourse revisions
 * This file contains NO server-side imports and can be used in browser components
 */

interface DiscourseRevision {
  version: number;
  created_at: string;
  username: string;
  edit_reason?: string;
  body_changes?: {
    inline?: string;
    side_by_side?: string;
    side_by_side_markdown?: string;
  };
  title_changes?: {
    inline?: string;
    side_by_side?: string;
    previous?: string;
    current?: string;
  };
}

interface ReconstructionResult {
  content: string;
  title: string;
  success: boolean;
  errors: string[];
}

/**
 * Extracts the "before" content from a Discourse side_by_side diff
 */
function extractBeforeContent(sideBySide: string): string {
  if (typeof document !== "undefined") {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = sideBySide;

    const revisionDivs = tempDiv.querySelectorAll(".revision-content");
    if (revisionDivs.length > 0) {
      const beforeDiv = revisionDivs[0];
      let content = beforeDiv.innerHTML;

      content = content.replace(/<ins>.*?<\/ins>/g, "");
      content = content.replace(/<del>(.*?)<\/del>/g, "$1");

      return content.trim();
    }
  }

  const regex = /<div class="revision-content">([\s\S]*?)<\/div>/;
  const match = sideBySide.match(regex);
  if (match && match[1]) {
    let content = match[1];
    content = content.replace(/<ins>.*?<\/ins>/g, "");
    content = content.replace(/<del>(.*?)<\/del>/g, "$1");
    return content.trim();
  }
  return "";
}

/**
 * Reconstructs the content and title of a specific revision by working backwards
 * from the current content using Discourse diffs
 *
 * @param currentContent - The current/latest content (HTML)
 * @param currentTitle - The current/latest title
 * @param revisions - All revisions from Discourse API
 * @param targetVersion - Which version to reconstruct (1 = original)
 * @returns The content and title as they appeared at that version
 */
export function reconstructRevisionContent(
  currentContent: string,
  currentTitle: string,
  revisions: DiscourseRevision[],
  targetVersion: number
): ReconstructionResult {
  const errors: string[] = [];
  const currentVersion = revisions.length + 1;

  if (targetVersion === currentVersion) {
    return {
      content: currentContent,
      title: currentTitle,
      success: true,
      errors: [],
    };
  }

  if (targetVersion < 1 || targetVersion > currentVersion) {
    const error = `Invalid target version: ${targetVersion} (must be between 1 and ${currentVersion})`;
    console.error(error);
    return {
      content: currentContent,
      title: currentTitle,
      success: false,
      errors: [error],
    };
  }

  let content = currentContent;
  let title = currentTitle;

  const sortedRevisions = [...revisions].sort((a, b) => b.version - a.version);

  for (const revision of sortedRevisions) {
    if (revision.version <= targetVersion) {
      break;
    }

    try {
      if (revision.body_changes?.side_by_side) {
        const beforeContent = extractBeforeContent(
          revision.body_changes.side_by_side
        );
        if (beforeContent) {
          content = beforeContent;
        } else {
          const error = `v${revision.version} body: Could not extract before content`;
          errors.push(error);
        }
      }

      if (revision.title_changes?.side_by_side) {
        const beforeTitle = extractBeforeContent(
          revision.title_changes.side_by_side
        );
        if (beforeTitle) {
          title = beforeTitle;
        }
      }
    } catch (error) {
      const errorMsg = `Failed to process revision v${revision.version}: ${error}`;
      console.error(errorMsg);
      errors.push(errorMsg);
    }
  }

  return {
    content,
    title,
    success: errors.length === 0,
    errors,
  };
}
