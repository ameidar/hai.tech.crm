# HaiTech CRM - Test Plan

## 1. System Overview

### Frontend Pages
| Page | Description | Priority |
|------|-------------|----------|
| Login | Authentication | P0 |
| Dashboard | Main dashboard with stats | P0 |
| Cycles | Cycle list & management | P0 |
| CycleDetail | Single cycle view, meetings, registrations, Zoom | P0 |
| Customers | Customer list & management | P1 |
| CustomerDetail | Single customer view | P1 |
| Students | Student list & management | P1 |
| Instructors | Instructor list & management | P1 |
| Courses | Course catalog | P1 |
| Branches | Branch management | P1 |
| Meetings | Meeting list & management | P1 |
| Reports | Reporting & analytics | P2 |
| AuditLog | Audit trail | P2 |
| InstructorDashboard | Instructor-specific view | P2 |

### Backend Routes
| Route | Endpoints | Priority |
|-------|-----------|----------|
| /api/auth | login, register, me | P0 |
| /api/cycles | CRUD, meetings, registrations | P0 |
| /api/zoom | create/delete meeting, webhooks | P0 |
| /api/customers | CRUD | P1 |
| /api/students | CRUD | P1 |
| /api/instructors | CRUD | P1 |
| /api/courses | CRUD | P1 |
| /api/branches | CRUD | P1 |
| /api/meetings | CRUD, status updates | P1 |
| /api/registrations | CRUD | P1 |
| /api/attendance | tracking | P2 |

---

## 2. Test Suites

### A. Smoke Suite (P0) - ~2 min
Fast validation of critical paths:
1. **Auth**
   - Login with valid credentials
   - Redirect to dashboard after login
   - Protected routes redirect to login

2. **Navigation**
   - All main menu items accessible
   - Page loads without errors

3. **Cycles (Core Flow)**
   - View cycle list
   - Open cycle detail
   - View meetings in cycle

### B. Regression Suite (P0 + P1) - ~15 min

#### Auth Tests
- [ ] Login with valid credentials
- [ ] Login with invalid credentials (negative)
- [ ] Logout
- [ ] Session persistence
- [ ] Role-based access (admin vs instructor)

#### Cycles Tests
- [ ] List cycles with pagination
- [ ] Filter cycles by status
- [ ] Create new cycle (all fields)
- [ ] Edit cycle details
- [ ] Delete cycle (with confirmation)
- [ ] Cycle with online activity type → Zoom section visible
- [ ] Create Zoom meeting for cycle
- [ ] Delete Zoom meeting
- [ ] Schedule fields locked when Zoom exists

#### Meetings Tests
- [ ] View meetings in cycle
- [ ] Update meeting status
- [ ] View meeting details modal
- [ ] Recording/transcript display (if exists)

#### Registrations Tests
- [ ] Add student to cycle
- [ ] Remove registration
- [ ] Payment status update

#### Customers Tests
- [ ] List customers
- [ ] Create customer
- [ ] Edit customer
- [ ] View customer detail with students

#### Students Tests
- [ ] List students
- [ ] Create student
- [ ] Edit student
- [ ] Link to customer

#### Instructors Tests
- [ ] List instructors
- [ ] Create instructor
- [ ] Edit instructor
- [ ] Instructor assignment to cycle

#### Courses Tests
- [ ] List courses
- [ ] Create course
- [ ] Edit course

#### Branches Tests
- [ ] List branches
- [ ] Create branch
- [ ] Edit branch

---

## 3. Technical Setup

### Playwright Configuration
```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
```

### Directory Structure
```
e2e/
├── fixtures/
│   ├── auth.fixture.ts      # Login state
│   ├── data.fixture.ts      # Test data helpers
│   └── index.ts
├── page-objects/
│   ├── login.page.ts
│   ├── dashboard.page.ts
│   ├── cycles.page.ts
│   ├── cycle-detail.page.ts
│   └── base.page.ts
├── tests/
│   ├── smoke/
│   │   └── critical-paths.spec.ts
│   ├── auth/
│   │   └── login.spec.ts
│   ├── cycles/
│   │   ├── cycles-list.spec.ts
│   │   ├── cycle-crud.spec.ts
│   │   └── cycle-zoom.spec.ts
│   ├── meetings/
│   │   └── meetings.spec.ts
│   └── ...
├── utils/
│   ├── api.ts               # API helpers
│   ├── selectors.ts         # Common selectors
│   └── test-data.ts         # Test data generation
└── global-setup.ts
```

### Selector Strategy
1. Prefer `data-testid` attributes
2. Fallback to accessible roles: `getByRole('button', { name: 'שמור' })`
3. Avoid CSS class selectors
4. Use Hebrew text matching where appropriate

### Required data-testid additions
- Login form: `data-testid="login-form"`, `data-testid="email-input"`, `data-testid="password-input"`, `data-testid="login-button"`
- Navigation: `data-testid="nav-cycles"`, `data-testid="nav-customers"`, etc.
- Tables: `data-testid="cycles-table"`, `data-testid="cycle-row-{id}"`
- Modals: `data-testid="edit-cycle-modal"`, `data-testid="create-zoom-button"`

---

## 4. CI Integration

### GitHub Actions - e2e.yml
```yaml
name: E2E Tests

on:
  pull_request:
    branches: [dev, main]
  push:
    branches: [dev]
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM

jobs:
  smoke:
    name: Smoke Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm ci
        working-directory: ./e2e
      - name: Install Playwright
        run: npx playwright install --with-deps chromium
        working-directory: ./e2e
      - name: Run smoke tests
        run: npx playwright test --grep @smoke
        working-directory: ./e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: smoke-results
          path: e2e/test-results/

  regression:
    name: Regression Tests
    if: github.event_name == 'schedule' || contains(github.event.pull_request.labels.*.name, 'run-regression')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm ci
        working-directory: ./e2e
      - name: Install Playwright
        run: npx playwright install --with-deps
        working-directory: ./e2e
      - name: Run regression tests
        run: npx playwright test
        working-directory: ./e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: regression-results
          path: e2e/test-results/
```

---

## 5. Implementation Order

1. ✅ Create TEST_PLAN.md
2. [ ] Setup Playwright in e2e/ folder
3. [ ] Create base fixtures and page objects
4. [ ] Add data-testid to critical UI elements
5. [ ] Implement smoke tests
6. [ ] Implement auth tests
7. [ ] Implement cycles tests
8. [ ] Implement remaining regression tests
9. [ ] Add CI workflow
10. [ ] Run full suite and fix issues
11. [ ] Create PR to dev

---

## 6. Test Data Requirements

### Users
- Admin user (full access)
- Instructor user (limited access)
- Invalid user (for negative tests)

### Seed Data
- At least 1 course
- At least 1 branch
- At least 1 instructor
- At least 1 cycle with meetings
- At least 1 customer with student

### Cleanup Strategy
- Use unique prefixes for test-created data: `[E2E]`
- Clean up test data after suite completion
- API-based setup/teardown preferred over UI

---

## 7. Success Criteria

- [ ] Smoke suite passes in < 2 minutes
- [ ] Regression suite passes in < 15 minutes
- [ ] No flaky tests (< 1% flake rate)
- [ ] All P0 flows covered
- [ ] CI integration working
- [ ] Documentation complete
