import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/proposal/Markdown";
import { describe, expect, it } from "vitest";

describe("Markdown", () => {
  it("renders markdown content as HTML", () => {
    render(<Markdown content="**bold text**" />);
    const boldText = screen.getByText("bold text");
    expect(boldText).toBeInTheDocument();
    expect(boldText.tagName).toBe("STRONG");
  });

  it("handles empty content without inserting nodes", () => {
    const { container } = render(<Markdown content="" />);
    expect(container.firstChild).toBeEmptyDOMElement();
  });

  it("sanitizes dangerous HTML by stripping scripts", () => {
    render(<Markdown content="<script>alert('xss')</script>" />);
    expect(screen.queryByText("alert")).not.toBeInTheDocument();
  });

  it("renders links as target blank with noopener/ noreferrer", () => {
    render(<Markdown content="[link](https://example.com)" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });
});
