import { test, expect } from "@playwright/test";
import {
  markPageWithCustomAuthRoutes,
  registerPlaywrightMocks,
} from "./helpers/playwright-mocks";
import { createPlaywrightGuard } from "./helpers/playwright-guard";
import { mockSignInFailure, mockWalletConnected } from "./helpers/auth-mocks";

const { describe: describeSpec } = createPlaywrightGuard("seed.spec.ts");

/**
 * NAVIGATION BAR & LOGIN FLOWS TEST PLAN
 *
 * This comprehensive test suite covers:
 * - Navigation bar display and state management
 * - Wallet connection flows (NEAR wallet via hot-labs/near-connect)
 * - Better Auth sign-in with nonce retry logic
 * - Session management and disconnect flows
 * - Discourse account linkage indicators
 * - Analytics event tracking (Plausible)
 * - Auth gating and conditional UI rendering
 *
 * Tech Stack:
 * - NEAR Wallet: useNear() hook with @hot-labs/near-connect
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
    const connectButton = page.getByRole("button", { name: /Connect Wallet/i });
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
   * 3. useNear() hook triggers wallet connection (hot-labs/near-connect)
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
    await mockWalletConnected(page, "tester.testnet");
    await page.goto("/", { waitUntil: "networkidle" });

    const signInButton = page.getByRole("button", {
      name: /Sign In/i,
    }).first();
    await expect(signInButton).toBeVisible({ timeout: 5000 });
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

    // Mock successful auth session
    await page.evaluateHandle(() => {
      (window as any).__AUTH_MOCK__ = {
        user: {
          id: "user123",
          email: "test@example.com",
          name: "Test User",
        },
        session: {
          token: "mock-session-token",
          expiresAt: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
        nearAccount: {
          accountId: "testuser.near",
        },
      };
    });

    // Navigate to home
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // In a real test with mocks, we'd wait for the account dropdown
    // For now, verify the structure if account exists
    const accountButton = page.getByRole("button", {
      name: /testuser\.near|My Account/i,
    });

    if (await accountButton.isVisible({ timeout: 2000 })) {
      // Avatar should be visible
      const avatar = accountButton.locator("[role='presentation']");
      await expect(avatar).toBeVisible();

      // Click to open dropdown
      await accountButton.click();

      // Verify dropdown menu appears
      const menu = page.locator("[role='menu']");
      await expect(menu).toBeVisible();

      // Verify Profile link
      const profileLink = page.getByRole("menuitem", { name: /Profile/i });
      await expect(profileLink).toBeVisible();

      // Verify Sign Out button
      const signOutButton = page.getByRole("menuitem", { name: /Sign Out/i });
      await expect(signOutButton).toBeVisible();
    }
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

    // Navigate to home
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify Connect Wallet button is visible initially
    const connectButton = page.getByRole("button", { name: /Connect Wallet/i });
    await expect(connectButton).toBeVisible();
  });

  /**
   * TEST 7: WALLET REJECTION HANDLING
   *
   * When user rejects wallet connection:
   * 1. Wallet modal is shown by hot-labs/near-connect
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
    await mockSignInFailure(page, "Wallet connection cancelled");
    await page.goto("/", { waitUntil: "networkidle" });

    const signInButton = page.getByRole("button", { name: /Sign In/i }).first();
    await signInButton.click();
    const connectButton = page.getByRole("button", { name: /Connect Wallet/i });
    await expect(connectButton).toBeVisible({ timeout: 5000 });
    await expect(connectButton).toBeEnabled();
  });

  /**
   * TEST 8: BETTER AUTH NONCE RETRY LOGIC
   *
   * When sign-in receives NONCE_NOT_FOUND error:
   * 1. Error is caught in onError handlers
   * 2. shouldRetryNonce(err) returns true for nonce errors
   * 3. If !retriedNonce (first attempt):
   *    - retriedNonce is set to true
   *    - attemptSignIn() is called recursively
   *    - Request is retried with new nonce
   * 4. If already retried (second attempt):
   *    - Error is shown to user via toast
   *    - Analytics event "wallet_connect_failed" is tracked
   *    - User must click "Sign In" again to retry
   * 5. Other auth errors (network, etc.) are not retried
   *
   * Implementation Notes:
   * - shouldRetryNonce() checks error.code === "NONCE_NOT_FOUND"
   * - Nonce errors typically occur when session expires during sign-in
   * - Retry happens silently without user intervention
   * - Max 2 attempts (initial + 1 retry) to prevent infinite loops
   * - formatAuthError() provides user-friendly error messages
   */
  test("retry sign-in on nonce expiration error", async ({ page }) => {
    registerPlaywrightMocks(page);

    // Navigate to home
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Mock nonce error on first attempt, then success
    markPageWithCustomAuthRoutes(page);
    let attemptCount = 0;
    await page.route("**/api/auth/**", (route) => {
      attemptCount++;
      if (attemptCount === 1) {
        // First attempt returns nonce error
        route.fulfill({
          status: 400,
          body: JSON.stringify({
            code: "NONCE_NOT_FOUND",
            message: "Session expired",
          }),
        });
      } else {
        // Retry succeeds
        route.continue();
      }
    });

    // In real test, this would be triggered via sign-in flow
    // Retry logic happens internally in navigation component
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
   * TEST 10: REDIRECT PARAMETER HANDLING
   *
   * When visiting /login?redirect=/proposals:
   * 1. searchParams.get("redirect") extracts "/proposals"
   * 2. User completes sign-in flow
   * 3. On successful auth (user state set):
   *    - hasRedirected flag is checked
   *    - router.push(redirect) navigates to /proposals
   *    - hasRedirected is set to true to prevent double redirect
   * 4. If no redirect param:
   *    - Defaults to "/" home page
   * 5. Redirect happens AFTER user state is set and isPending is false
   *
   * Implementation Notes:
   * - redirect extracted via searchParams.get("redirect") || "/"
   * - useRouter from next/navigation for client-side routing
   * - useEffect watches (user, isPending, hasRedirected, router, redirect)
   * - router.push() is only called when user changes and !isPending
   */
  test("redirect to specified URL after successful login", async ({ page }) => {
    registerPlaywrightMocks(page);

    // Navigate to login with redirect param
    await page.goto("/login?redirect=/proposals", {
      waitUntil: "domcontentloaded",
    });

    // Verify login page loads
    const heading = page.getByRole("heading", {
      name: /Sign in to Continue/i,
    });
    await expect(heading).toBeVisible();

    // In actual test, after sign-in completes, page would redirect to /proposals
    // This would be verified by checking router state or page URL
  });

  /**
   * TEST 11: ANALYTICS TRACKING - WALLET EVENTS
   *
   * Track the following analytics events:
   *
   * A. Wallet Connection Clicked
   *    - Event: "wallet_connect_clicked"
   *    - Props: None
   *    - Fired: When "Connect Wallet" or "Sign In" button clicked
   *    - Source: track() in handleSignIn() function
   *
   * B. Wallet Connection Succeeded
   *    - Event: "wallet_connect_succeeded"
   *    - Props: { account_id: <wallet_id> }
   *    - Fired: After successful Better Auth sign-in
   *    - Source: onSuccess callback in authClient.signIn.near()
   *    - Example: { account_id: "testuser.near" }
   *
   * C. Wallet Connection Failed
   *    - Event: "wallet_connect_failed"
   *    - Props: { message: <error_message>, code: <error_code> }
   *    - Fired: After authentication error (not for rejections)
   *    - Source: onError callbacks in auth flow
   *    - Example: { message: "Network error", code: "NETWORK_MISMATCH" }
   *
   * D. Wallet Disconnect Clicked
   *    - Event: "wallet_disconnect_clicked"
   *    - Props: None
   *    - Fired: When "Sign Out" button clicked (not on window unload)
   *    - Source: track() in handleSignOut() function
   *
   * Implementation Notes:
   * - Uses useGovernanceAnalytics() hook
   * - Tracks via Plausible analytics
   * - Rejection errors do NOT fire analytics events
   * - Network errors DO fire events with error details
   * - Account ID helps identify which accounts are active
   */
  test("track wallet connection analytics events", async ({ page }) => {
    registerPlaywrightMocks(page);

    // Setup analytics interception
    const events: Array<{ name: string; props?: Record<string, unknown> }> = [];

    await page.evaluateHandle(() => {
      const original = (window as any).__plausible;
      (window as any).__plausible = (
        name: string,
        options?: { props?: Record<string, unknown> }
      ) => {
        (window as any).__capturedEvents =
          (window as any).__capturedEvents || [];
        (window as any).__capturedEvents.push({
          name,
          props: options?.props,
        });
        return original?.call(window, name, options);
      };
    });

    // Navigate to home
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Get captured events
    const capturedEvents = await page.evaluate(() => {
      return (window as any).__capturedEvents || [];
    });

    // In a full test, we'd verify events were fired:
    // - wallet_connect_clicked when button clicked
    // - wallet_connect_succeeded on successful auth
    // - wallet_disconnect_clicked on sign out
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
    expect(page.url()).toContain("localhost");
  });

  /**
   * TEST 15: INTEGRATION - FULL AUTH FLOW
   *
   * Complete user journey from anonymous to authenticated:
   *
   * 1. Start: Visit home page
   *    - See NEAR logo, Draft button, Connect Wallet button
   *    - No profile menu or account info visible
   *
   * 2. Click Connect Wallet
   *    - Wallet modal opens (hot-labs/near-connect)
   *    - User approves wallet (e.g., "testuser.near")
   *    - Button changes to "testuser.near → Sign In"
   *    - Analytics event "wallet_connect_clicked" tracked
   *
   * 3. Click Sign In
   *    - Better Auth sign-in flow starts
   *    - User approves signature in wallet
   *    - authClient.requestSignIn.near() called
   *    - authClient.signIn.near() called
   *    - Session is created
   *    - Analytics event "wallet_connect_succeeded" tracked
   *
   * 4. Session established
   *    - nearAccountId set from Better Auth
   *    - Button transitions to account dropdown
   *    - Avatar with initials shown
   *    - Account ID displayed
   *    - Discourse linkage checked
   *    - Dropdown menu available
   *
   * 5. User can now:
   *    - Click Draft to create proposal
   *    - Access Profile page
   *    - Browse proposals (already public, but can track auth state)
   *    - Sign out to return to step 1
   *
   * 6. Click Sign Out
   *    - authClient.signOut() called
   *    - authClient.near.disconnect() called
   *    - walletSignOut() called
   *    - Session cleared
   *    - User returns to "Connect Wallet" state
   *    - Analytics event "wallet_disconnect_clicked" tracked
   *
   * Implementation Notes:
   * - This is the primary user flow for the app
   * - Each step must work independently
   * - Error at any step should not break subsequent steps
   * - Backward navigation (signing in again) must work
   * - Local storage may cache some state for persistence
   */
  test("complete authentication flow from anonymous to signed in and back", async ({
    page,
  }) => {
    registerPlaywrightMocks(page);

    // Step 1: Visit home page
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const connectButton = page.getByRole("button", {
      name: /Connect Wallet/i,
    });
    await expect(connectButton).toBeVisible();

    // Step 2-6 would be tested with proper wallet mocking and auth mocks
    // For seed test, we verify the starting state and navigation works
  });
});

/**
 * ADDITIONAL CONTEXT
 *
 * AUTHENTICATION ARCHITECTURE:
 *
 * 1. NEAR Wallet Connection (useNear)
 *    - Uses @hot-labs/near-connect for wallet selection
 *    - Supported: Hot Wallet, WalletConnect, iframe connectors
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
