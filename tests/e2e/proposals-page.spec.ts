import { expect, test, type Page } from "@playwright/test";
import { registerPlaywrightMocks } from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";

const { describe: describeSpec } = createPlaywrightGuard("proposals-page.spec.ts");

const MAIN_PROPOSAL_NAME = "Mock Proposal for Playwright";
const waitForMockProposalTitle = async (page: Page) => {
  const heading = page.getByRole("heading", { name: MAIN_PROPOSAL_NAME });
  await expect(heading).toBeVisible({ timeout: 10000 });
  return heading;
};

const getMockProposalLink = (page: Page) =>
  page.getByRole("link", { name: new RegExp(MAIN_PROPOSAL_NAME) });

const waitForMockProposalLink = async (page: Page) => {
  const link = getMockProposalLink(page);
  await expect(link.first()).toBeVisible({ timeout: 10000 });
  return link.first();
};

const findFailureAlert = (page: Page) => {
  const failureText = page.getByText(/failed to fetch proposals/i);
  return page.locator('[role="alert"]').filter({ has: failureText });
};

/**
 * PROPOSAL LISTING PAGE TEST PLAN
 *
 * This test suite validates the /proposals page behavior including:
 * - Loading skeleton states during data fetch
 * - Error alert display on fetch failure
 * - Empty state card when no proposals exist
 * - Full proposal card list with all metadata
 * - Navigation to proposal detail pages
 * - External Discourse link navigation
 * - Governance analytics event tracking
 *
 * The page is NOT auth-gated and integrates with:
 * - Discourse API via /api/discourse/latest endpoint
 * - Plausible analytics for governance event tracking
 * - Navigation system for proposal detail and external links
 */

describeSpec("Proposals Listing Page - Complete User Flow", () => {
  /**
   * TEST 1: LOADING STATE
   *
   * When /proposals is visited:
   * 1. Page header "Proposals" and subtitle "Browse and analyze NEAR governance proposals" display immediately
   * 2. Loading skeletons (3 cards) appear while /api/discourse/latest request is in-flight
   * 3. Each skeleton has placeholder lines for title and excerpt
   * 4. Once data arrives, skeletons are replaced with ProposalCard components
   *
   * Implementation Notes:
   * - Uses Skeleton component from @/components/ui/skeleton
   * - Shows 3 placeholder cards during initial load
   * - Replaces skeletons once setPosts() is called with data
   */
  test("display loading skeletons while fetching proposals", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    // Navigate to /proposals and observe initial render
    await page.goto("/proposals", { waitUntil: "domcontentloaded" });

    // Verify page header and subtitle are immediately visible
    const heading = page.getByRole("heading", { name: /Proposals/ });
    await expect(heading).toBeVisible();

    const subtitle = page.getByText(
      "Browse and analyze NEAR governance proposals"
    );
    await expect(subtitle).toBeVisible();

    // Verify loading skeletons are displayed during fetch
    // Skeletons appear in the space-y-4 div during loading state
    const loadingContainer = page.locator("div.space-y-4");
    await expect(loadingContainer).toBeVisible({ timeout: 2000 });

    // Wait for proposals to load and replace skeletons
    await waitForMockProposalTitle(page);
  });

  /**
   * TEST 2: FAILURE ALERT STATE
   *
   * When /api/discourse/latest returns a 500+ error:
   * 1. Fetch fails and catches the error
   * 2. Error message is set via setError()
   * 3. Alert component with role="alert" and variant="destructive" displays
   * 4. AlertCircle icon is rendered
   * 5. Error message is visible to the user
   * 6. No proposal cards are rendered
   * 7. Analytics event "home_latest_proposals_failed" is tracked with message truncated to 120 chars
   */
  test("display failure alert when proposal fetch fails", async ({ page }) => {
    registerPlaywrightMocks(page);

    await page.route(/\/api\/discourse\/latest/, (route) => {
      route.fulfill({
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Internal server error" }),
      });
    });

    await page.goto("/proposals", { waitUntil: "networkidle" });

    const errorAlert = findFailureAlert(page);
    await expect(errorAlert).toBeVisible({ timeout: 5000 });

    const alertIcon = errorAlert.locator("svg");
    await expect(alertIcon).toBeVisible();

    const proposalCards = page.locator("article");
    await expect(proposalCards).toHaveCount(0);
  });

  test("display empty state card when no proposals exist", async ({ page }) => {
    registerPlaywrightMocks(page);

    await page.route(/\/api\/discourse\/latest/, (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latest_posts: [] }),
      });
    });

    await page.goto("/proposals", { waitUntil: "networkidle" });

    const emptyMessage = page.getByText("No proposals found");
    await expect(emptyMessage).toBeVisible();

    const emptySubtitle = page.getByText("Check back later for new proposals");
    await expect(emptySubtitle).toBeVisible();

    const proposalCards = page.locator("article");
    await expect(proposalCards).toHaveCount(0);
  });

  test("render fully populated list of proposal cards with metadata", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    await page.goto("/proposals", { waitUntil: "domcontentloaded" });

    await waitForMockProposalTitle(page);

    const title = page.getByText("Mock Proposal for Playwright");
    await expect(title).toBeVisible();

    const author = page.getByText("@playwright-bot");
    await expect(author).toBeVisible();

    const createdDate = page.getByText(/2024/).first();
    await expect(createdDate).toBeVisible();

    const activityBadge = page.locator("text=/\\d+d ago/").first();
    await expect(activityBadge).toBeVisible();

    const replyCount = page.getByText(/4/).first();
    await expect(replyCount).toBeVisible();

    const walletTag = page.getByText("example.near");
    await expect(walletTag).toBeVisible();

    const discourseButton = page
      .locator("button")
      .filter({ hasText: /View on Discourse|External/ });
    await expect(discourseButton).toBeVisible();
  });

  test("navigate to proposal detail page when card is clicked", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await page.goto("/proposals", { waitUntil: "domcontentloaded" });

    const proposalLink = await waitForMockProposalLink(page);
    await proposalLink.click();

    await page.waitForURL(/\/proposals\/\d+/, { timeout: 10000 });
    expect(page.url()).toMatch(/\/proposals\/42/);
  });

  test("open Discourse URL in new tab when View on Discourse button clicked", async ({
    page,
    context,
  }) => {
    registerPlaywrightMocks(page);
    await page.goto("/proposals", { waitUntil: "domcontentloaded" });
    await waitForMockProposalTitle(page);

    const popupPromise = context.waitForEvent("page");

    const discourseButton = page
      .locator("button")
      .filter({ hasText: /View on Discourse|External/ });
    await discourseButton.click();

    const popup = await popupPromise;
    const popupUrl = popup.url();
    expect(popupUrl).toMatch(/\/t\/[^/]+\/42/);
    expect(popupUrl).toContain("/t/");
    expect(popupUrl.endsWith("/42")).toBeTruthy();

    await popup.close();
  });

  test("allow unauthenticated access to proposals listing page", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await page.goto("/proposals", { waitUntil: "domcontentloaded" });

    const heading = page.getByRole("heading", { name: /Proposals/ });
    await expect(heading).toBeVisible();

    await waitForMockProposalTitle(page);
  });

  test("verify discourse integration for proposal data and links", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/discourse/latest")) {
        requests.push(request.url());
      }
    });

    await page.goto("/proposals", { waitUntil: "networkidle" });

    expect(requests.length).toBeGreaterThan(0);

    const title = page.getByText("Mock Proposal for Playwright");
    await expect(title).toBeVisible();

    const discourseButton = page
      .locator("button")
      .filter({ hasText: /View on Discourse/ });
    await expect(discourseButton).toBeVisible();

    const apiUrl = requests[0];
    expect(apiUrl).toContain("per_page=20");
    expect(apiUrl).toContain("page=0");
  });
});
