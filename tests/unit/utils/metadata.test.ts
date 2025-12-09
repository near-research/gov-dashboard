import { describe, expect, it } from "vitest";

import { extractMetadata, stripFrontmatter } from "@/utils/metadata";

describe("metadata utilities", () => {
  it("parses YAML frontmatter and sanitizes proposal fields", () => {
    const content = `
---
title: <h1>NEAR Proposal</h1>
description: Some <strong>bold</strong> copy with   extra   whitespace.
author: Alice
status: draft
type: governance
category: NEAR <br /> Discussion
created: 2024-10-02
requires: NEAR Foundation
unknown: should be ignored
---

Body content here.
`;

    const metadata = extractMetadata(content);

    expect(metadata).toEqual({
      title: "NEAR Proposal",
      description: "Some bold copy with extra whitespace.",
      author: "Alice",
      status: "draft",
      type: "governance",
      category: "NEAR",
      created: "2024-10-02",
      requires: "NEAR Foundation",
    });
  });

  it("extracts Discourse-style metadata and strips that section", () => {
    const content = `
Intro blurb.

## Frontmatter
Title: Discussion Update
Description: <p>Updates with <br/> multiple lines.</p>
Author: Bob

Remaining markdown body.
`;

    const metadata = extractMetadata(content);
    expect(metadata.title).toBe("Discussion Update");
    expect(metadata.description).toBe("Updates with multiple lines.");
    expect(metadata.author).toBe("Bob");

    const stripped = stripFrontmatter(content);
    expect(stripped).toContain("Intro blurb.");
    expect(stripped).toContain("Remaining markdown body.");
    expect(stripped).not.toContain("## Frontmatter");
  });

  it("ignores invalid or empty fields while keeping valid defaults", () => {
    const content = `
---
Title: 
Description:   <p>  </p>
Category: NEAR Governance
BadLine without colon
Foo: bar
---
`;

    const metadata = extractMetadata(content);
    expect(metadata).toEqual({
      category: "NEAR Governance",
    });
  });

  it("returns empty metadata and leaves content untouched when frontmatter is missing", () => {
    const content = "Just a regular post with no metadata.";

    expect(extractMetadata(content)).toEqual({});
    expect(stripFrontmatter(content)).toBe(content);
  });

  it("removes YAML, header, and plain metadata when present", () => {
    const yamlContent = `
---
Title: Yaml Only
---
Body.
`;
    expect(stripFrontmatter(yamlContent).startsWith("Body.")).toBe(true);

    const headerContent = `
Frontmatter
Title: Header Only

Body.
`;
    expect(stripFrontmatter(headerContent).startsWith("Body.")).toBe(true);

    const plainContent = `
Title: Plain Only

Body.
`;
    expect(stripFrontmatter(plainContent).startsWith("Body.")).toBe(true);
  });
});
