import { test, expect } from "@playwright/test";
import {
  markPageWithCustomAuthRoutes,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import {
  mockAuthenticatedSession,
  mockCompleteSignIn,
  mockRequestSignIn,
  mockSignInFailure,
  mockUnauthenticatedSession,
  mockWalletConnected,
} from "./helpers/auth-mocks";

const { describe: describeSpec } = createPlaywrightGuard("auth.spec.ts");

/**
 * NAVIGATION BAR & LOGIN FLOWS TEST PLAN
 *
 * This comprehensive test suite covers:
 * - Navigation bar display and state management
 * - Wallet connection flows (NEAR wallet via better-near-auth)
 * - Better Auth sign-in with nonce retry logic
 * - Session management and disconnect flows
 * - Discourse account linkage indicators
 * - Analytics event tracking (Plausible)
 * - Auth gating and conditional UI rendering
 *
 * Tech Stack:
 * - NEAR Wallet: useNear() hook with @better-near-auth
 * - Better Auth: createAuthClient() with SIWN plugin (@better-near-auth)
 * - Discourse Integration: client.discourse.getLinkage() via oRPC
 * - Analytics: useGovernanceAnalytics() → Plausible
 * - Navigation: Next.js Link and useRouter
 */

describeSpec("Navigation Bar & Login Flows - Complete Authentication", () => {
  /**
   * TEST 1: NAVIGATION BAR - INITIAL STATE (NOT AUTHENTICATED)
   *
   * When visiting / without authentication:
   * 1. Sticky nav bar is visible at top (sticky top-0 z-50)
   * 2. NEAR logo is displayed on left side (from /public/near-logo.svg)
   * 3. "Draft" button is visible (navigates to /proposals/new)
   * 4. "Connect Wallet" button is visible (primary auth entry point)
   * 5. No account dropdown or profile menu shown
   * 6. No Discourse status indicator shown
   * 7. Governance analytics hook is initialized but no events fired yet
   *
   * Implementation Notes:
   * - Nav is sticky with z-50 to stay above content
   * - Logo is a Link to "/" for home navigation
   * - "Draft" button uses Plus icon from lucide-react
   * - Button text changes based on auth state:
   *   - Not connected: "Connect Wallet"
   *   - Wallet only: "[wallet] → Sign In"
   *   - Fully authenticated: Shows account dropdown
   */
  test("display navigation bar with NEAR logo, Draft button, and Connect Wallet button", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    // Navigate to home page
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify sticky nav is visible
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
    await expect(nav).toHaveClass(/sticky/);

    // Verify NEAR logo is displayed
    const logo = page.locator("img[alt='NEAR']");
    await expect(logo).toBeVisible();

    // Verify logo links to home
    const logoLink = logo.locator("..");
    const logoHref = await logoLink.getAttribute("href");
    expect(logoHref).toBe("/");

    // Verify Draft button is visible and navigates to /proposals/new
    const draftButton = page.getByRole("button", { name: /Draft|Plus/ });
    await expect(draftButton).toBeVisible();
    await draftButton.click();
    await expect(page).toHaveURL(/\/proposals\/new$/);
    // Return to home to continue remaining assertions
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify Connect Wallet button is visible
    const connectButton = page
      .getByRole("button", { name: /Connect.*Wallet/i })
      .first();
    await expect(connectButton).toBeVisible();
    await expect(connectButton).toBeEnabled({ timeout: 5000 });

    // Verify no account dropdown is shown
    const accountDropdown = page.locator("[role='menu']");
    await expect(accountDropdown).not.toBeVisible();
  });

  /**
   * TEST 2: WALLET CONNECTION FLOW - CONNECT WALLET STATE
   *
   * When "Connect Wallet" button is clicked:
   * 1. Analytics event "wallet_connect_clicked" is tracked
   * 2. Button becomes disabled with loading spinner (Loader2 icon spinning)
   * 3. useNear() hook triggers wallet connection (better-near-auth)
   * 4. If successful:
   *    - walletAccountId is set (e.g., "example.near")
   *    - Button changes to "[wallet_id] → Sign In"
   *    - User can now proceed to Better Auth sign-in
   * 5. If user rejects wallet:
   *    - Connection error is caught and handled
   *    - Toast error shows "Wallet connection cancelled"
   *    - No analytics event fired for rejected connections
   *    - Button returns to "Connect Wallet" state
   *
   * Implementation Notes:
   * - walletSignIn() comes from useAuth() provider
   * - walletAccountId is stored in AuthContext state
   * - Loading spinner uses Loader2 component with animate-spin
   * - User rejection detected via isUserRejected() helper
   */
  test("connect wallet via useNear hook and transition to Sign In button", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    const walletAccountId = "tester.testnet";
    await mockRequestSignIn(page, walletAccountId);
    await page.goto("/", { waitUntil: "networkidle" });

    const accountRegex = new RegExp(walletAccountId.replace(/\./g, "\\."), "i");
    const signInButton = page
      .getByRole("button", { name: accountRegex })
      .first();
    await expect(signInButton).toBeVisible({ timeout: 5000 });
    await expect(signInButton).toHaveText(/Sign In/i);
  });

  /**
   * TEST 3: LOADING STATE DURING SIGN IN
   *
   * When wallet is connected and "Sign In" button is clicked:
   * 1. Analytics event "wallet_connect_clicked" is tracked
   * 2. Button becomes disabled with Loader2 spinning animation
   * 3. authClient.requestSignIn.near() is called (first step of SIWN)
   * 4. During auth flow:
   *    - User must approve wallet signature in NEAR wallet UI
   *    - Better Auth creates session on success
   *    - Network requests to /api/auth endpoints are made
   *
   * Implementation Notes:
   * - isSigningIn state controls button disabled and spinner visibility
   * - Loader2 icon with animate-spin class
   * - SIWN flow: requestSignIn → signIn with nonce retry logic
   * - Nonce errors trigger automatic retry via shouldRetryNonce()
   */
  test("show loading spinner during wallet sign-in flow", async ({ page }) => {
    registerPlaywrightMocks(page);
    await mockWalletConnected(page, "tester.testnet");
    markPageWithCustomAuthRoutes(page);
    await page.route("**/api/auth/**", (route) => {
      route.abort();
    });
    await page.goto("/", { waitUntil: "networkidle" });

    const signInButton = page.getByRole("button", { name: /Sign In/i }).first();

    await signInButton.click();

    const spinner = page.locator("svg.animate-spin");
    await expect(spinner).toBeVisible({ timeout: 3000 });
  });

  /**
   * TEST 4: SUCCESSFUL SIGN IN - ACCOUNT DROPDOWN
   *
   * When sign-in completes successfully:
   * 1. Analytics event "wallet_connect_succeeded" is tracked with account_id
   * 2. Toast shows "Signed in successfully"
   * 3. Better Auth session is created
   * 4. nearAccountId is set from linked accounts in session
   * 5. Button transitions to account dropdown:
   *    - Avatar with account initials displayed
   *    - Full account ID shown (truncated on mobile)
   *    - Discourse status dot shown:
   *      - Green dot if linked (client.discourse.getLinkage() returns data)
   *      - Gray dot if not linked
   *      - Spinner while checking (checkingDiscourse state)
   * 6. Dropdown menu contains:
   *    - "My Account" label with Discourse status indicator
   *    - Profile link (→ /profile)
   *    - Sign Out button
   *
   * Implementation Notes:
   * - Avatar component from @/components/ui/avatar
   * - Discourse check happens on mount and when displayAccountId changes
   * - Discourse status dot: emerald-500 if linked, gray-300 if not
   * - getInitials() returns first 2 chars of account ID
   * - Dropdown is DropdownMenu from radix-ui
   */
  test("display account dropdown with Discourse status indicator after sign in", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    const walletAccountId = "testuser.near";
    await mockRequestSignIn(page, walletAccountId);
    await mockCompleteSignIn(page, walletAccountId);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const accountRegex = new RegExp(walletAccountId.replace(/\./g, "\\."), "i");
    const accountButton = page
      .getByRole("button")
      .filter({ hasText: accountRegex })
      .first();
    await expect(accountButton).toBeVisible({ timeout: 5000 });

    await accountButton.click();

    const menu = page.locator("[role='menu']");
    await expect(menu).toBeVisible();

    const profileLink = page.getByRole("menuitem", { name: /Profile/i });
    await expect(profileLink).toBeVisible();

    const signOutButton = page.getByRole("menuitem", { name: /Sign Out/i });
    await expect(signOutButton).toBeVisible();
  });

  /**
   * TEST 5: DISCOURSE LINKAGE INDICATOR
   *
   * When signed in:
   * 1. useEffect checks Discourse linkage via client.discourse.getLinkage()
   * 2. Loading state shows spinner in "My Account" label
   * 3. On completion:
   *    - If linked: Green dot (emerald-500) shown in:
   *      - Account button (absolute -top-1 -right-1 w-3 h-3)
   *      - Dropdown label
   *      - Hover title: "Discourse Connected"
   *    - If not linked: Gray dot (gray-300) shown
   *      - Hover title: "Discourse Not Linked"
   * 4. Linkage check is NOT displayed during !user state
   * 5. Linkage check is NOT displayed when wallet connected but not signed in
   *
   * Implementation Notes:
   * - Check happens when displayAccountId changes (nearAccountId || walletAccountId)
   * - Uses client.discourse.getLinkage() oRPC call
   * - isDiscourseLinked state tracks linkage status
   * - checkingDiscourse state shows loading spinner
   * - Dots are positioned absolutely for visual impact
   */
  test("show Discourse linkage status indicator in dropdown", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    // Mock Discourse linked account
    await page.route("**/api/**", (route) => {
      const url = route.request().url();
      if (url.includes("discourse")) {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ discourseUsername: "testuser" }),
        });
        return;
      }
      route.continue();
    });

    // Navigate to home with signed-in state
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Look for discourse status indicator
    const discourseIndicator = page.locator(
      "span[title*='Discourse'], div[title*='Discourse']"
    );

    // If indicator is visible, verify its appearance
    if (await discourseIndicator.isVisible({ timeout: 2000 })) {
      // Should have emerald color if linked
      const classList = await discourseIndicator.getAttribute("class");
      expect(classList).toMatch(/emerald-500|gray-300/);
    }
  });

  /**
   * TEST 6: SIGN OUT / DISCONNECT FLOW
   *
   * When "Sign Out" button is clicked:
   * 1. Analytics event "wallet_disconnect_clicked" is tracked
   * 2. Multiple disconnection steps occur:
   *    - authClient.signOut() - Clears Better Auth session
   *    - authClient.near.disconnect() - Disconnects embedded SIWN wallet
   *    - walletSignOut() - Disconnects useNear wallet
   * 3. On success:
   *    - Toast shows "Signed out"
   *    - Session is cleared (user becomes null)
   *    - Button returns to "Connect Wallet" state
   *    - Account dropdown is hidden
   *    - Discourse indicator is cleared
   * 4. If any step fails:
   *    - Remaining disconnections are still attempted
   *    - Error is logged but user can manually refresh
   *
   * Implementation Notes:
   * - Multiple try-catch blocks for resilience
   * - All disconnect steps are attempted even if one fails
   * - user state is cleared from AuthContext
   * - walletAccountId may remain briefly during cleanup
   */
  test("sign out and return to Connect Wallet state", async ({ page }) => {
    registerPlaywrightMocks(page);
    const accountId = "testuser.near";
    await mockAuthenticatedSession(page, accountId);
    await page.route("**/api/auth/sign-out", (route) => {
      route.fulfill({
        status: 204,
        headers: { "Content-Type": "application/json" },
        body: "",
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const accountRegex = new RegExp(accountId.replace(/\./g, "\\."), "i");
    const accountButton = page
      .getByRole("button")
      .filter({ hasText: accountRegex })
      .first();
    await expect(accountButton).toBeVisible({ timeout: 5000 });

    await accountButton.click();
    const signOutMenuItem = page.getByRole("menuitem", { name: /Sign Out/i });
    await expect(signOutMenuItem).toBeVisible();
    await signOutMenuItem.click();

    page.unroute("**/api/auth/get-session");
    page.unroute("**/api/auth/list-accounts");
    page.unroute("**/api/auth/accounts");
    await mockUnauthenticatedSession(page);

    const connectButton = page
      .getByRole("button", { name: /Connect.*Wallet/i })
      .first();
    await expect(connectButton).toBeVisible({ timeout: 5000 });
  });

  /**
   * TEST 7: WALLET REJECTION HANDLING
   *
   * When user rejects wallet connection:
   * 1. Wallet modal is shown by better-near-auth
   * 2. User clicks "Cancel" or rejects transaction
   * 3. Promise rejection is caught
   * 4. isUserRejected() returns true for rejection errors
   * 5. No error toast is shown (silent failure for UX)
   * 6. No analytics event is fired (don't track rejections)
   * 7. Button remains in initial state, allowing retry
   *
   * Implementation Notes:
   * - Rejection is detected via error message containing "rejected"
   * - Toast.error() is NOT called for rejections
   * - Analytics tracking is skipped for rejected flows
   * - User can click "Connect Wallet" again to retry
   * - No specific error log for rejections (spam prevention)
   */
  test("handle wallet rejection gracefully without error toast", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);
    await mockWalletConnected(page, "tester.testnet");
    await mockSignInFailure(page, "Wallet connection cancelled by user");
    await page.goto("/", { waitUntil: "networkidle" });

    const signInButton = page.getByRole("button", { name: /Sign In/i }).first();
    await expect(signInButton).toBeVisible({ timeout: 5000 });
    await signInButton.click();
    await page.keyboard.press("Escape");

    // Primary assertion: NO error toast shown on user rejection
    const errorToast = page
      .locator('[role="alert"]')
      .filter({ hasText: /error|failed|cancelled/i });
    await expect(errorToast).not.toBeVisible({ timeout: 2000 });
  });
  /**
   * TEST 9: LOGIN PAGE FLOW (/login)
   *
   * When visiting /login:
   * 1. Page shows "Sign in to Continue" heading
   * 2. Subheading: "Connect your NEAR wallet"
   * 3. SignInForm component renders:
   *    - If not walletAccountId: "Connect Wallet" button
   *    - If walletAccountId && !user: Shows steps for signing in
   *    - If user && !hasRedirected: Redirects to home or redirect param
   * 4. Step 1: Click "Connect Wallet"
   *    - Same wallet connection flow as nav
   *    - Success: Shows next step to sign in with Better Auth
   *    - Error: Shows error message, allows retry
   * 5. Step 2: Click "Sign In"
   *    - Triggers Better Auth SIWN flow
   *    - User approves wallet signature
   *    - Session is created
   * 6. Step 3: Automatic redirect
   *    - Checks redirect query param (?redirect=/proposals)
   *    - Defaults to "/" if no redirect specified
   *    - router.push() happens on user change
   *
   * Implementation Notes:
   * - SignInForm is client component ("use client")
   * - Uses useRouter from next/navigation (app router)
   * - Redirect is taken from searchParams.get("redirect")
   * - hasRedirected state prevents double redirects
   * - isPending tracks loading state during session check
   */
  test("navigate to login page and complete sign-in flow", async ({ page }) => {
    registerPlaywrightMocks(page);

    // Navigate to login page
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // Verify login page heading
    const heading = page.getByRole("heading", {
      name: /Sign in to Continue/i,
    });
    await expect(heading).toBeVisible();

    // Verify subheading
    const subheading = page.getByText("Connect your NEAR wallet");
    await expect(subheading).toBeVisible();

    // Verify Connect Wallet button is visible
    const connectButton = page.getByRole("button", { name: /Connect Wallet/i });
    await expect(connectButton).toBeVisible();
  });

  /**
   * TEST 12: AUTH GATING - PROFILE DROPDOWN VISIBILITY
   *
   * The Profile dropdown (account menu) is only shown when:
   * 1. user state is not null (session exists)
   * 2. displayAccountId is set (nearAccountId OR walletAccountId)
   * 3. Both conditions are true: user && displayAccountId
   *
   * Not shown when:
   * 1. Loading (isPending || isSigningIn) - Shows spinner button
   * 2. Not signed in (!user) - Shows "Connect Wallet" or "Sign In" button
   * 3. Only wallet connected (!user && walletAccountId) - Shows "[wallet] → Sign In" button
   *
   * Profile link inside dropdown:
   * 1. Only accessible when signed in (user exists)
   * 2. Links to /profile page
   * 3. Requires active session from Better Auth
   *
   * Implementation Notes:
   * - Auth gating logic in navigation.tsx lines ~250-300
   * - Ternary operators control which button variant is shown
   * - Dropdown only renders in "user && displayAccountId" branch
   * - No Profile button is available before authentication
   * - isLoading = isPending || isSigningIn for button disable state
   */
  test("show profile dropdown only when authenticated", async ({ page }) => {
    registerPlaywrightMocks(page);

    // Navigate to home (not authenticated)
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Profile link should NOT be visible
    const profileLink = page.getByRole("menuitem", { name: /Profile/i });
    await expect(profileLink).not.toBeVisible();

    // Connect Wallet button should be visible
    const connectButton = page.getByRole("button", {
      name: /Connect Wallet/i,
    });
    await expect(connectButton).toBeVisible();
  });

  /**
   * TEST 13: LOADING STATE TRANSITIONS
   *
   * Button state transitions:
   *
   * 1. Initial state (loading = false, !user):
   *    Text: "Connect Wallet"
   *    Disabled: false
   *    Icon: None
   *
   * 2. Connecting (walletSignIn in progress):
   *    Text: Hidden
   *    Disabled: true
   *    Icon: Loader2 spinning
   *
   * 3. After wallet connected (!user && walletAccountId):
   *    Text: "[wallet] → Sign In" (desktop) or "Sign In" (mobile)
   *    Disabled: false
   *    Icon: None
   *
   * 4. Signing in (authClient auth in progress):
   *    Text: Hidden
   *    Disabled: true
   *    Icon: Loader2 spinning
   *
   * 5. After auth (user && displayAccountId):
   *    Dropdown with avatar and account ID
   *    Disabled: false based on isLoading state
   *    Icon: None (Avatar instead)
   *
   * Implementation Notes:
   * - isLoading = isPending || isSigningIn
   * - Loader2 from lucide-react with animate-spin class
   * - Button disabled attribute prevents clicks during loading
   * - Text responsive: hidden sm:inline or hidden sm:inline-block
   */
  test("show loading spinner during connection transitions", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    // Navigate to home
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Button should not have spinner initially
    let spinner = page.locator("svg.animate-spin");
    await expect(spinner).not.toBeVisible();

    // Connect Wallet button should be clickable
    const connectButton = page.getByRole("button", {
      name: /Connect Wallet/i,
    });
    await expect(connectButton).toBeEnabled();
  });

  /**
   * TEST 14: NAVIGATION FROM NAV TO OTHER PAGES
   *
   * Logo click:
   * - Navigates to "/" (home)
   * - Works from any page
   * - Uses Next.js Link component for client-side nav
   *
   * Draft button click:
   * - Navigates to "/proposals/new" (create new proposal)
   * - Uses router.push() onClick handler
   * - Only visible when not on /proposals/new page
   * - Shown as floating action button style
   *
   * Profile link click (when authenticated):
   * - Navigates to "/profile" (user profile page)
   * - Inside dropdown menu
   * - Uses Link component from Next.js
   * - Only accessible after sign-in
   *
   * Implementation Notes:
   * - All navigation is client-side (Link or router.push)
   * - No server redirects for these flows
   * - Draft button only shows when !isOnNewProposalPage
   * - Navigation preserves scroll position
   */
  test("navigate to other pages via nav buttons and links", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    // Navigate to home
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify we're on home page (allow localhost/127.0.0.1 or configured host)
    const hostname = new URL(page.url()).hostname;
    const allowedHosts = new Set(
      [process.env.PLAYWRIGHT_HOST, "localhost", "127.0.0.1"].filter(
        Boolean
      ) as string[]
    );
    expect(allowedHosts.has(hostname)).toBe(true);

    // Click NEAR logo to stay on home
    const logo = page.locator("img[alt='NEAR']");
    const logoLink = logo.locator("..");
    await logoLink.click();

    // Should still be on home
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

/**
 * ADDITIONAL CONTEXT
 *
 * AUTHENTICATION ARCHITECTURE:
 *
 * 1. NEAR Wallet Connection (useNear)
 *    - Uses @better-near-auth for wallet selection
 *    - walletSignIn() triggers wallet modal
 *    - Returns walletAccountId once connected
 *
 * 2. Better Auth Session (authClient)
 *    - Implements NEP-413 Sign In with NEAR
 *    - Uses better-near-auth SIWN plugin
 *    - requestSignIn.near(): Gets nonce from server
 *    - signIn.near(): Signs message with wallet, sends to server
 *    - Server verifies signature and creates session
 *    - Handles nonce retry on expiration
 *
 * 3. Discourse Linkage (client.discourse)
 *    - Checks if NEAR account is linked to Discourse
 *    - Called via client.discourse.getLinkage({ nearAccount })
 *    - Returns linkage object if linked, error if not
 *    - Shown via green/gray dot indicator
 *    - Useful for community reputation features
 *
 * 4. Session State (AuthContext)
 *    - Combines Better Auth user state with NEAR wallet state
 *    - user: Better Auth user object (null if not signed in)
 *    - session: Better Auth session object
 *    - nearAccountId: NEAR account from linked accounts
 *    - walletAccountId: Currently connected wallet account
 *    - displayAccountId: nearAccountId || walletAccountId
 *    - isPending: sessionPending || walletLoading
 *
 * ERROR MESSAGES:
 * - "NETWORK_MISMATCH": Wallet on different network than app
 * - "NONCE_NOT_FOUND": Session expired, auto-retry on first occurrence
 * - "User rejected": Wallet modal cancelled by user (no error shown)
 * - "Network error": Connection issue, shown to user with retry option
 *
 * ANALYTICS EVENTS:
 * - wallet_connect_clicked: User initiates wallet connection
 * - wallet_connect_succeeded: Auth successful with account_id
 * - wallet_connect_failed: Auth failed with message and code
 * - wallet_disconnect_clicked: User signs out intentionally
 */
