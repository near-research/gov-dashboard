# Proposal Listing and Filtering Test Plan

## Application Overview

Test the NEAR Governance Dashboard proposal listing page and its filtering/sorting capabilities. The page displays proposals from Discourse with support for pagination, ordering (default, created, activity, views, posts, likes), category filtering, and displays proposal metadata including author, dates, reply counts, and views.

## Test Scenarios

### 1. Proposal Listing and Loading States

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1. Display loading skeletons while fetching proposals

**File:** `tests/e2e/proposals-listing/loading-states.spec.ts`

**Steps:**
  1. Navigate to the proposals page
  2. Verify that loading skeletons are displayed while data is being fetched
  3. Verify that the page heading 'Proposals' is visible
  4. Verify that the subtitle 'Browse and analyze NEAR governance proposals' is visible

**Expected Results:**
  - Three skeleton cards are rendered during loading
  - Each skeleton has placeholder lines for title and excerpt
  - Page heading and subtitle are displayed correctly

#### 1.2. Display empty state when no proposals are available

**File:** `tests/e2e/proposals-listing/empty-state.spec.ts`

**Steps:**
  1. Navigate to the proposals page with mocked empty response
  2. Wait for loading to complete
  3. Verify that loading skeletons are no longer visible
  4. Verify that the empty state message is displayed

**Expected Results:**
  - Empty state card is displayed with message 'No proposals found'
  - Subtitle text 'Check back later for new proposals' is visible
  - No proposal cards are rendered

#### 1.3. Display error state when proposal fetch fails

**File:** `tests/e2e/proposals-listing/error-state.spec.ts`

**Steps:**
  1. Navigate to the proposals page with mocked error response
  2. Wait for the request to complete
  3. Verify that the error alert is displayed
  4. Verify that error message contains relevant information

**Expected Results:**
  - Error alert with red background is visible
  - Error icon is displayed
  - Error message is shown to the user

### 2. Proposal Card Display and Navigation

**Seed:** `tests/e2e/seed.spec.ts`

#### 2.1. Render proposal cards with all metadata

**File:** `tests/e2e/proposals-listing/proposal-cards.spec.ts`

**Steps:**
  1. Navigate to the proposals page
  2. Wait for proposal cards to load
  3. Verify that proposal title is displayed
  4. Verify that proposal author is displayed with @ prefix
  5. Verify that creation date is displayed
  6. Verify that time-since-activity badge is shown
  7. Verify that 'View on Discourse' button is visible

**Expected Results:**
  - Proposal card displays title with proper styling
  - Author name is shown with user icon and @ prefix
  - Date is formatted as 'Mon DD, YYYY'
  - Activity badge shows days since last activity (e.g., '5d ago')
  - 'View on Discourse' button is visible and clickable

#### 2.2. Navigate to proposal detail page on card click

**File:** `tests/e2e/proposals-listing/navigation.spec.ts`

**Steps:**
  1. Navigate to the proposals page
  2. Wait for proposal cards to load
  3. Click on a proposal card
  4. Verify that the page navigates to the proposal detail page
  5. Verify that the URL contains the proposal topic ID

**Expected Results:**
  - Clicking proposal card navigates to /proposals/[topic_id]
  - Proposal detail page loads successfully
  - URL structure is correct (e.g., /proposals/123)

#### 2.3. Open Discourse proposal in new tab

**File:** `tests/e2e/proposals-listing/discourse-navigation.spec.ts`

**Steps:**
  1. Navigate to the proposals page
  2. Wait for proposal cards to load
  3. Click on 'View on Discourse' button
  4. Verify that Discourse URL is opened in new tab
  5. Verify that the URL is properly formatted with topic slug and ID

**Expected Results:**
  - New tab/window opens when button is clicked
  - Discourse URL contains topic slug and ID
  - URL format is correct (e.g., discourse.url/t/proposal-slug/123)

### 3. Proposal Filtering by Order

**Seed:** `tests/e2e/seed.spec.ts`

#### 3.1. Filter proposals by creation date order

**File:** `tests/e2e/proposals-listing/filter-order-created.spec.ts`

**Steps:**
  1. Navigate to the proposals page with order=created parameter
  2. Wait for proposals to load
  3. Verify that proposals are displayed in the order requested
  4. Verify that the API request included the order parameter

**Expected Results:**
  - Proposals are sorted by creation date
  - Newest proposals appear first (if descending) or oldest first (if ascending)
  - API call includes order=created parameter

#### 3.2. Filter proposals by activity order

**File:** `tests/e2e/proposals-listing/filter-order-activity.spec.ts`

**Steps:**
  1. Navigate to the proposals page with order=activity parameter
  2. Wait for proposals to load
  3. Verify that proposals with recent activity appear first
  4. Verify that last_posted_at dates determine the order

**Expected Results:**
  - Proposals with most recent activity appear at top
  - Proposals are sorted by last_posted_at timestamp
  - API call includes order=activity parameter

#### 3.3. Filter proposals by views

**File:** `tests/e2e/proposals-listing/filter-order-views.spec.ts`

**Steps:**
  1. Navigate to the proposals page with order=views parameter
  2. Wait for proposals to load
  3. Verify that proposals with most views appear first
  4. Verify that view counts are displayed on cards

**Expected Results:**
  - Proposals are sorted by view count in descending order
  - Proposals with highest views appear first
  - API call includes order=views parameter

#### 3.4. Filter proposals by post count

**File:** `tests/e2e/proposals-listing/filter-order-posts.spec.ts`

**Steps:**
  1. Navigate to the proposals page with order=posts parameter
  2. Wait for proposals to load
  3. Verify that proposals with most posts appear first
  4. Verify that reply counts are displayed correctly

**Expected Results:**
  - Proposals are sorted by post/reply count in descending order
  - Proposals with highest engagement appear first
  - API call includes order=posts parameter

#### 3.5. Filter proposals by likes

**File:** `tests/e2e/proposals-listing/filter-order-likes.spec.ts`

**Steps:**
  1. Navigate to the proposals page with order=likes parameter
  2. Wait for proposals to load
  3. Verify that proposals with most likes appear first

**Expected Results:**
  - Proposals are sorted by like count in descending order
  - Proposals with highest engagement appear first
  - API call includes order=likes parameter

### 4. Proposal Filtering by Category

**Seed:** `tests/e2e/seed.spec.ts`

#### 4.1. Filter proposals by category ID

**File:** `tests/e2e/proposals-listing/filter-category.spec.ts`

**Steps:**
  1. Navigate to the proposals page with category_id parameter
  2. Wait for proposals to load
  3. Verify that only proposals from the selected category are displayed
  4. Verify that the API request includes the category_id parameter

**Expected Results:**
  - Only proposals from the specified category are shown
  - API call includes category_id parameter with correct value
  - Proposals from other categories are filtered out

#### 4.2. Load default category when no category specified

**File:** `tests/e2e/proposals-listing/filter-category-default.spec.ts`

**Steps:**
  1. Navigate to the proposals page without category_id parameter
  2. Wait for proposals to load
  3. Verify that proposals are loaded from the default category
  4. Verify that default category ID is used in API call

**Expected Results:**
  - Default category (ID: 168) is used when not specified
  - Proposals from default category are displayed
  - API call uses default category_id value

### 5. Proposal Pagination

**Seed:** `tests/e2e/seed.spec.ts`

#### 5.1. Display correct number of proposals per page

**File:** `tests/e2e/proposals-listing/pagination-per-page.spec.ts`

**Steps:**
  1. Navigate to the proposals page with per_page=10 parameter
  2. Wait for proposals to load
  3. Count the number of proposal cards displayed
  4. Verify that no more than 10 proposals are shown

**Expected Results:**
  - Exactly 10 proposal cards are displayed
  - Clamping respects maximum per_page limit
  - API request includes per_page=10 parameter

#### 5.2. Render correct number of cards for default pagination

**File:** `tests/e2e/proposals-listing/pagination-default.spec.ts`

**Steps:**
  1. Navigate to the proposals page without per_page parameter
  2. Wait for proposals to load
  3. Count the number of proposal cards displayed
  4. Verify that up to 20 proposals are rendered

**Expected Results:**
  - Up to 20 proposal cards are rendered by default
  - Page display is not overloaded
  - All proposals are visible without excessive scrolling

#### 5.3. Handle page parameter for navigation

**File:** `tests/e2e/proposals-listing/pagination-page.spec.ts`

**Steps:**
  1. Navigate to the proposals page with page=1 parameter
  2. Wait for proposals to load
  3. Verify that proposals from page 1 are displayed
  4. Navigate to page=2 parameter
  5. Verify that different proposals are displayed

**Expected Results:**
  - Correct proposals are shown for the specified page
  - Different proposals appear on different pages
  - API request includes correct page parameter

### 6. API Parameter Validation

**Seed:** `tests/e2e/seed.spec.ts`

#### 6.1. Reject invalid per_page parameter

**File:** `tests/e2e/proposals-listing/validation-per-page.spec.ts`

**Steps:**
  1. Navigate to proposals page with invalid per_page parameter (negative, zero, or non-numeric)
  2. Verify that error response is received
  3. Verify that error message indicates invalid parameter

**Expected Results:**
  - API returns 400 error for invalid per_page
  - Error message states 'Invalid `per_page` parameter'
  - No proposals are displayed

#### 6.2. Reject invalid page parameter

**File:** `tests/e2e/proposals-listing/validation-page.spec.ts`

**Steps:**
  1. Navigate to proposals page with invalid page parameter (negative or non-numeric)
  2. Verify that error response is received
  3. Verify that error message indicates invalid parameter

**Expected Results:**
  - API returns 400 error for invalid page
  - Error message states 'Invalid `page` parameter'
  - No proposals are displayed

#### 6.3. Reject invalid order parameter

**File:** `tests/e2e/proposals-listing/validation-order.spec.ts`

**Steps:**
  1. Navigate to proposals page with invalid order parameter (unsupported value)
  2. Verify that error response is received
  3. Verify that error message lists supported order values

**Expected Results:**
  - API returns 400 error for invalid order
  - Error message lists supported values: default, created, activity, views, posts, likes
  - No proposals are displayed

#### 6.4. Reject invalid category_id parameter

**File:** `tests/e2e/proposals-listing/validation-category.spec.ts`

**Steps:**
  1. Navigate to proposals page with invalid category_id parameter (negative or non-numeric)
  2. Verify that error response is received
  3. Verify that error message indicates invalid parameter

**Expected Results:**
  - API returns 400 error for invalid category_id
  - Error message states 'Invalid `category_id` parameter'
  - No proposals are displayed

#### 6.5. Reject unsupported parameters

**File:** `tests/e2e/proposals-listing/validation-unsupported.spec.ts`

**Steps:**
  1. Navigate to proposals page with unknown parameter (e.g., ?search=test)
  2. Verify that error response is received
  3. Verify that error message identifies unsupported parameters

**Expected Results:**
  - API returns 400 error for unsupported parameters
  - Error message lists the unsupported parameter names
  - No proposals are displayed

### 7. User Interaction and Analytics

**Seed:** `tests/e2e/seed.spec.ts`

#### 7.1. Track proposal listing request

**File:** `tests/e2e/proposals-listing/analytics-request.spec.ts`

**Steps:**
  1. Navigate to the proposals page
  2. Monitor analytics events
  3. Verify that 'home_latest_proposals_requested' event is tracked

**Expected Results:**
  - Analytics event 'home_latest_proposals_requested' is sent
  - Event is sent at the start of the fetch operation

#### 7.2. Track successful proposal load

**File:** `tests/e2e/proposals-listing/analytics-success.spec.ts`

**Steps:**
  1. Navigate to the proposals page
  2. Wait for proposals to load successfully
  3. Monitor analytics events
  4. Verify that 'home_latest_proposals_succeeded' event is tracked with proposal count

**Expected Results:**
  - Analytics event 'home_latest_proposals_succeeded' is sent
  - Event includes count property with number of loaded proposals
  - Event is sent after successful API response

#### 7.3. Track failed proposal load

**File:** `tests/e2e/proposals-listing/analytics-failure.spec.ts`

**Steps:**
  1. Navigate to the proposals page with mocked API failure
  2. Wait for error to be handled
  3. Monitor analytics events
  4. Verify that 'home_latest_proposals_failed' event is tracked with error message

**Expected Results:**
  - Analytics event 'home_latest_proposals_failed' is sent
  - Event includes message property with truncated error text
  - Error message is limited to 120 characters
  - Event is sent after failed API response
