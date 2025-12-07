# Proposal Listing and Filtering Tests

This directory contains comprehensive Playwright E2E tests for the proposal listing and filtering functionality based on the test plan in `specs/proposal-listing-test-plan.md`.

## Test Structure

All tests follow the standard Playwright pattern with:
- `registerPlaywrightMocks()` - Sets up API mocks
- `createPlaywrightGuard()` - Ensures tests only run when `PLAYWRIGHT_TEST=true`

## Test Suites

### Suite 1: Proposal Listing and Loading States (3 tests)
- **loading-states.spec.ts** - Verifies loading skeleton display
- **empty-state.spec.ts** - Tests empty state when no proposals exist
- **error-state.spec.ts** - Tests error handling and display

### Suite 2: Proposal Card Display and Navigation (3 tests)
- **proposal-cards.spec.ts** - Validates card metadata rendering
- **navigation.spec.ts** - Tests navigation to proposal detail pages
- **discourse-navigation.spec.ts** - Tests Discourse link opening in new tab

### Suite 3: Proposal Filtering by Order (5 tests)
- **filter-order-created.spec.ts** - Sort by creation date
- **filter-order-activity.spec.ts** - Sort by activity (recent)
- **filter-order-views.spec.ts** - Sort by view count
- **filter-order-posts.spec.ts** - Sort by post/reply count
- **filter-order-likes.spec.ts** - Sort by like count

### Suite 4: Proposal Filtering by Category (2 tests)
- **filter-category.spec.ts** - Tests category-specific filtering
- **filter-category-default.spec.ts** - Tests default category (ID: 168)

### Suite 5: Proposal Pagination (3 tests)
- **pagination-per-page.spec.ts** - Tests custom per_page limits
- **pagination-default.spec.ts** - Tests default pagination (20 items)
- **pagination-page.spec.ts** - Tests page navigation

### Suite 6: API Parameter Validation (5 tests)
- **validation-per-page.spec.ts** - Rejects invalid per_page values
- **validation-page.spec.ts** - Rejects invalid page values
- **validation-order.spec.ts** - Rejects invalid order values
- **validation-category.spec.ts** - Rejects invalid category_id values
- **validation-unsupported.spec.ts** - Rejects unsupported parameters

### Suite 7: User Interaction and Analytics (3 tests)
- **analytics-request.spec.ts** - Tracks proposal listing requests
- **analytics-success.spec.ts** - Tracks successful loads with count
- **analytics-failure.spec.ts** - Tracks failures with error messages

## Running the Tests

Run all proposal listing tests:
```bash
PLAYWRIGHT_TEST=true bun run test:e2e -- tests/e2e/proposals-listing
```

Run a specific test suite:
```bash
PLAYWRIGHT_TEST=true bun run test:e2e -- tests/e2e/proposals-listing/loading-states.spec.ts
```

Run with headless browser:
```bash
PLAYWRIGHT_TEST=true bun run test:e2e -- tests/e2e/proposals-listing --project=chromium
```

## Supported Query Parameters

The tests validate the following API parameters:
- **per_page** - Number of proposals per page (1-30)
- **page** - Page number (0+)
- **order** - Sort order: `default`, `created`, `activity`, `views`, `posts`, `likes`
- **category_id** - Category ID for filtering (default: 168)
- **userApiKey** - Optional user API key for authenticated requests

## Mock Data

Tests use mock fixtures from `tests/fixtures/playwright/proposals-latest.json` containing:
- Mock proposal with ID 12
- Title: "Mock Proposal for Playwright"
- Author: "playwright-bot"
- Created: 2024-04-01
- 4 replies, 256 views
- Last activity: 2024-04-05

## Test Coverage

- ✅ Loading states (skeletons, empty, error)
- ✅ Proposal card rendering (title, author, date, activity, metadata)
- ✅ Navigation (detail page, external links)
- ✅ Filtering (5 sort orders + category)
- ✅ Pagination (per_page, page, defaults)
- ✅ Parameter validation (5 error scenarios)
- ✅ Analytics tracking (request, success, failure)

**Total: 23 Test Cases**
