import "../../vi-compat";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProposalCard from "@/components/proposal/ProposalCard";

const { render, screen, fireEvent } = await import("@testing-library/react");

vi.mock("@/config/services", () => ({
  servicesConfig: { discourseBaseUrl: "https://gov.test" },
}));

const baseProps = () => ({
  id: 1,
  title: "Test proposal title",
  created_at: "2024-01-01T00:00:00.000Z",
  username: "alice",
  topic_id: 42,
  topic_slug: "hello-world",
});

describe("ProposalCard", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders minimal data without optional fields", () => {
    const { container } = render(<ProposalCard {...baseProps()} />);

    expect(screen.getByText("Test proposal title")).toBeInTheDocument();
    expect(screen.getByText(/@alice/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /view on discourse/i })
    ).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // default reply count
    expect(container.querySelector(".line-clamp-2")).toBeNull(); // no excerpt rendered
    expect(screen.queryByText(/d ago/)).toBeNull(); // no last activity badge
  });

  it("shows days-since badge when last_posted_at provided", () => {
    const now = new Date();
    const twoDaysAgo = new Date(
      now.getTime() - 2 * 24 * 60 * 60 * 1000
    ).toISOString();

    render(<ProposalCard {...baseProps()} last_posted_at={twoDaysAgo} />);

    expect(screen.getByText("2d ago")).toBeInTheDocument();
  });

  it("renders excerpt and formats large reply count", () => {
    render(
      <ProposalCard
        {...baseProps()}
        excerpt="A very long explanation that should be clamped."
        reply_count={1200}
      />
    );

    expect(screen.getByText(/very long explanation/i)).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("shows near wallet when provided", () => {
    render(<ProposalCard {...baseProps()} near_wallet="alice.near" />);

    expect(screen.getByText("alice.near")).toBeInTheDocument();
  });

  it("opens discourse link with full URL when CTA is clicked", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null as any);

    render(<ProposalCard {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /view on discourse/i }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://gov.test/t/hello-world/42",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
